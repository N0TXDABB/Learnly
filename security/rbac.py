"""Roles and what each one may do."""

from __future__ import annotations

from ..config import ROLE_RATE_LIMITS

ROLES = ("guest", "student", "admin", "auditor")

# Guests can only see the front page and sign in: everything else uses the AI or saved work.
_GUEST: set[str] = set()
_STUDENT = _GUEST | {
    "solve:use",  # homework solver, step questions, practice problems
    "study:use",  # documents, outlines, flashcards, quizzes, mock exams
    "tutor:use",  # tutor chat
}
_ADMIN = _STUDENT | {
    "admin:read",
    "admin:settings",
    "admin:system",
    "admin:users",
    "audit:read",
    "audit:verify",
}
_AUDITOR = _GUEST | {"admin:read", "audit:read", "audit:verify", "audit:export"}

PERMISSIONS: dict[str, frozenset[str]] = {
    "guest": frozenset(_GUEST),
    "student": frozenset(_STUDENT),
    "admin": frozenset(_ADMIN),
    "auditor": frozenset(_AUDITOR),
}

# Actions that also need a code from an authenticator app (when require_admin_mfa is on).
MFA_REQUIRED = frozenset({"admin:users"})

ROLE_LABELS = {
    "guest": "Guest",
    "student": "Student",
    "admin": "Administrator",
    "auditor": "Auditor",
}


def can(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, frozenset())


def rate_limit(role: str) -> int:
    return ROLE_RATE_LIMITS.get(role, ROLE_RATE_LIMITS["guest"])


def matrix() -> list[dict]:
    """The access matrix as rows, for the Account and Admin pages."""
    every = sorted(set().union(*PERMISSIONS.values()))
    return [
        {"permission": perm, **{role: perm in PERMISSIONS[role] for role in ROLES}, "mfa": perm in MFA_REQUIRED}
        for perm in every
    ]
