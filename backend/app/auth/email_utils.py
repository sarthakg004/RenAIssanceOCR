"""Graceful verification email.

If SMTP is configured (SMTP_HOST set) a real email is sent. If it is NOT
configured — the normal case for local dev — we simply log the verification
link to the backend console so the flow is still testable, and the caller
treats the account as auto-verifiable. Nothing here ever blocks signup.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from urllib.parse import urlencode

from ..core.config import (
    PUBLIC_BASE_URL,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_USER,
)

logger = logging.getLogger("renaissance.auth.email")


def email_enabled() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def build_verification_link(token: str) -> str:
    # Points at the backend route, which marks the account verified and then
    # redirects the browser back to the frontend.
    return f"{PUBLIC_BASE_URL.rstrip('/')}/api/auth/verify-email?" + urlencode({"token": token})


def send_verification_email(to_email: str, name: str, token: str) -> bool:
    """Send the verification email. Returns True if actually emailed.

    When SMTP is not configured, logs the link and returns False (the caller
    then auto-verifies the account so local dev works with zero email setup).
    """
    link = build_verification_link(token)

    if not email_enabled():
        logger.warning(
            "[auth] SMTP not configured — auto-verifying. Verification link "
            "for %s: %s",
            to_email,
            link,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = "Verify your RenAIssance account"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(
        f"Hi {name},\n\n"
        f"Please verify your RenAIssance account by opening this link:\n\n"
        f"{link}\n\n"
        f"If you did not sign up, you can ignore this email.\n"
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        logger.info("[auth] Verification email sent to %s", to_email)
        return True
    except Exception as exc:  # noqa: BLE001 — never let email break signup
        logger.error("[auth] Failed to send verification email to %s: %s", to_email, exc)
        return False
