"""Encryption at rest for secrets kept in the database (TOTP seeds, private keys)."""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    """Fernet (AES-128-CBC + HMAC-SHA256) with a master key stored in the data folder."""

    def __init__(self, key_path: Path):
        key_path = Path(key_path)
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if not key_path.exists():
            key = Fernet.generate_key()
            # Create the file with owner-only permissions where the OS supports it.
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(key)
        self._fernet = Fernet(key_path.read_bytes().strip())

    def encrypt(self, plaintext: str | bytes) -> str:
        data = plaintext.encode() if isinstance(plaintext, str) else plaintext
        return self._fernet.encrypt(data).decode()

    def decrypt(self, token: str) -> bytes:
        try:
            return self._fernet.decrypt(token.encode())
        except InvalidToken as exc:  # pragma: no cover - only if the key file was replaced
            raise ValueError("Stored secret could not be decrypted (was data/keys/master.key changed?)") from exc

    def decrypt_text(self, token: str) -> str:
        return self.decrypt(token).decode()
