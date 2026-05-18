/**
 * Backend API origin.
 *
 * Empty string => same-origin requests (e.g. `/api/health`). In production the
 * nginx container reverse-proxies `/api/` to the FastAPI backend; in local
 * development the Vite dev-server proxy (see vite.config.js) forwards it to
 * http://localhost:8000. This keeps a single code path for both environments
 * and removes the hardcoded `http://localhost:8000` that broke the dockerized
 * app. Override with VITE_API_URL only for non-standard deployments.
 */
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? '';
