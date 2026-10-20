"""Signed access tokens (RS256 JWT with key rotation) and rotating refresh tokens."""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from ..db import Database, dumps, iso, loads, new_id, now_iso, one, parse_iso, rows
from .crypto import SecretBox

ISSUER = "learnly"
AUDIENCE = "learnly-api"


class TokenError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class KeyStore:
    """RSA signing keys. A new key is made every `rotation_days`; retired keys still verify for a while."""

    def __init__(self, db: Database, box: SecretBox, rotation_days: int, grace_s: int):
        self.db = db
        self.box = box
        self.rotation_days = rotation_days
        self.grace_s = grace_s
        self._lock = threading.Lock()
        self._current: tuple[str, object, datetime] | None = None
        self._public: dict[str, object] = {}
        self._loaded_at = 0.0

    def _load(self) -> None:
        with self.db.read() as con:
            keys = rows(con, "SELECT * FROM signing_keys ORDER BY created_at DESC")
        now = datetime.now(timezone.utc)
        public: dict[str, object] = {}
        current = None
        for key in keys:
            retired = parse_iso(key["retired_at"])
            if retired is None and current is None:
                private = serialization.load_pem_private_key(self.box.decrypt(key["private_pem_enc"]), password=None)
                current = (key["kid"], private, parse_iso(key["created_at"]))
            if retired is None or (now - retired).total_seconds() < self.grace_s:
                public[key["kid"]] = serialization.load_pem_public_key(key["public_pem"].encode())
        self._current = current
        self._public = public
        self._loaded_at = time.monotonic()

    def rotate(self) -> str:
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        public_pem = private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()
        kid = "k_" + secrets.token_hex(6)
        now = now_iso()
        with self.db.write() as con:
            con.execute("UPDATE signing_keys SET retired_at = ? WHERE retired_at IS NULL", (now,))
            con.execute(
                "INSERT INTO signing_keys(kid, private_pem_enc, public_pem, created_at) VALUES (?,?,?,?)",
                (kid, self.box.encrypt(private_pem), public_pem, now),
            )
        with self._lock:
            self._load()
        return kid

    def rotate_if_due(self) -> str | None:
        with self._lock:
            if self._current is None or time.monotonic() - self._loaded_at > 300:
                self._load()
            current = self._current
        if current is None:
            return self.rotate()
        age = datetime.now(timezone.utc) - current[2]
        if age > timedelta(days=self.rotation_days):
            return self.rotate()
        return None

    def signing_key(self) -> tuple[str, object]:
        self.rotate_if_due()
        assert self._current is not None
        return self._current[0], self._current[1]

    def public_key(self, kid: str):
        key = self._public.get(kid)
        if key is None:
            with self._lock:
                self._load()
            key = self._public.get(kid)
        return key

    def jwks(self) -> dict:
        self.rotate_if_due()
        keys = []
        for kid, key in self._public.items():
            numbers = key.public_numbers()

            def b64(n: int) -> str:
                raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
                return jwt.utils.base64url_encode(raw).decode()

            keys.append({"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": b64(numbers.n), "e": b64(numbers.e)})
        return {"keys": keys}


@dataclass
class RefreshOutcome:
    ok: bool
    user: dict | None = None
    raw_token: str = ""
    family_id: str = ""
    amr: list | None = None
    reuse_detected: bool = False


class TokenService:
    def __init__(self, db: Database, keys: KeyStore, access_ttl_s: int, refresh_ttl_s: int):
        self.db = db
        self.keys = keys
        self.access_ttl_s = access_ttl_s
        self.refresh_ttl_s = refresh_ttl_s

    # -- signed tokens -------------------------------------------------
    def _sign(self, claims: dict) -> str:
        kid, private = self.keys.signing_key()
        return jwt.encode(claims, private, algorithm="RS256", headers={"kid": kid})

    def issue_access(self, user: dict, amr: list[str], family_id: str) -> str:
        now = int(time.time())
        return self._sign(
            {
                "iss": ISSUER,
                "aud": AUDIENCE,
                "sub": user["id"],
                "email": user["email"],
                "role": user["role"],
                "amr": amr,
                "sid": family_id,
                "typ": "access",
                "iat": now,
                "exp": now + self.access_ttl_s,
                "jti": secrets.token_hex(8),
            }
        )

    def issue_purpose(self, user_id: str, purpose: str, ttl_s: int, **extra) -> str:
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": AUDIENCE, "sub": user_id, "typ": purpose, "iat": now, "exp": now + ttl_s}
        claims.update(extra)
        return self._sign(claims)

    def decode(self, token: str, purpose: str = "access") -> dict:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise TokenError("INVALID_TOKEN", "The sign-in token is not valid.") from exc
        if header.get("alg") != "RS256":
            raise TokenError("INVALID_TOKEN", "The sign-in token is not valid.")
        key = self.keys.public_key(header.get("kid", ""))
        if key is None:
            raise TokenError("INVALID_TOKEN", "The sign-in token was signed with an unknown key.")
        try:
            claims = jwt.decode(token, key, algorithms=["RS256"], audience=AUDIENCE, issuer=ISSUER)
        except jwt.ExpiredSignatureError as exc:
            raise TokenError("TOKEN_EXPIRED", "The session expired. Refreshing…") from exc
        except jwt.PyJWTError as exc:
            raise TokenError("INVALID_TOKEN", "The sign-in token is not valid.") from exc
        if claims.get("typ") != purpose:
            raise TokenError("INVALID_TOKEN", "The token can't be used for this.")
        return claims

    # -- refresh tokens --------------------------------------------------
    def create_refresh(self, con, user_id: str, amr: list[str], user_agent: str, ip: str, family_id: str | None = None) -> tuple[str, str]:
        raw = secrets.token_urlsafe(32)
        family_id = family_id or new_id("fam")
        expires = iso(datetime.now(timezone.utc) + timedelta(seconds=self.refresh_ttl_s))
        con.execute(
            "INSERT INTO refresh_tokens(id, user_id, family_id, token_hash, amr, expires_at, created_at, user_agent, ip)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (new_id("rt"), user_id, family_id, hash_token(raw), dumps(amr), expires, now_iso(), user_agent[:200], ip),
        )
        return raw, family_id

    def rotate_refresh(self, con, raw: str, user_agent: str, ip: str) -> RefreshOutcome:
        token = one(con, "SELECT * FROM refresh_tokens WHERE token_hash = ?", (hash_token(raw or ""),))
        if token is None:
            return RefreshOutcome(ok=False)
        if token["revoked_at"] is not None:
            # A used or revoked token came back: assume it was stolen and end the whole session family.
            self.revoke_family(con, token["family_id"])
            return RefreshOutcome(ok=False, reuse_detected=True, family_id=token["family_id"],
                                  user=one(con, "SELECT * FROM users WHERE id = ?", (token["user_id"],)))
        if parse_iso(token["expires_at"]) <= datetime.now(timezone.utc):
            return RefreshOutcome(ok=False)
        user = one(con, "SELECT * FROM users WHERE id = ?", (token["user_id"],))
        if user is None:
            return RefreshOutcome(ok=False)
        amr = loads(token["amr"], ["pwd"])
        new_raw, _ = self.create_refresh(con, user["id"], amr, user_agent, ip, family_id=token["family_id"])
        con.execute(
            "UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?",
            (now_iso(), hash_token(new_raw)[:16], token["id"]),
        )
        return RefreshOutcome(ok=True, user=user, raw_token=new_raw, family_id=token["family_id"], amr=amr)

    def revoke_family(self, con, family_id: str) -> None:
        con.execute(
            "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?",
            (now_iso(), family_id),
        )

    def revoke_user(self, con, user_id: str) -> None:
        con.execute(
            "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
            (now_iso(), user_id),
        )
