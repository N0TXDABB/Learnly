"""Who is making a request, and what they may do."""

from __future__ import annotations

from dataclasses import dataclass, field

from .security import rbac


@dataclass
class Principal:
    user: dict | None = None
    claims: dict = field(default_factory=dict)
    ip: str = ""

    @property
    def role(self) -> str:
        return self.user["role"] if self.user else "guest"

    @property
    def is_guest(self) -> bool:
        return self.user is None

    @property
    def mfa(self) -> bool:
        return "otp" in (self.claims.get("amr") or [])

    def can(self, permission: str) -> bool:
        return rbac.can(self.role, permission)

    @classmethod
    def for_user(cls, user: dict) -> "Principal":
        return cls(user=user, claims={"amr": ["system"]})


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "role_label": rbac.ROLE_LABELS.get(user["role"], user["role"]),
        "mfa_enabled": bool(user["mfa_enabled"]),
        "created_at": user["created_at"],
        "last_login_at": user.get("last_login_at"),
        "permissions": sorted(rbac.PERMISSIONS.get(user["role"], frozenset())),
        "rate_limit_per_min": rbac.rate_limit(user["role"]),
    }
