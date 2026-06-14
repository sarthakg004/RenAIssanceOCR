"""Health endpoint + full app-import smoke.

Importing app.main exercises the entire router/service import graph (a real
regression guard), and the route must be registered and return the healthy
payload. Real end-to-end HTTP health is covered by the CI container smoke job
(curl against the running container) — kept here as a portable unit check that
doesn't couple to the TestClient/httpx version interplay.
"""

import asyncio

from app.api.health import health_check
from app.main import app


def test_app_registers_health_route():
    paths = {getattr(route, "path", None) for route in app.routes}
    assert "/api/health" in paths


def test_health_payload_is_healthy():
    body = asyncio.run(health_check())
    assert body["status"] == "healthy"
    assert "timestamp" in body
