# ============================================
# RenAIssance OCR — Frontend Dockerfile
# Multi-stage: Node 20 build → Nginx alpine serve
# ============================================

# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

# Do NOT set NODE_ENV=production here — vite and other build tools
# live in devDependencies and must be installed for the build to succeed.
# NODE_ENV=production is set only in the runtime stage.

WORKDIR /app

# Copy manifests first — layer cache for npm install
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps) needed for the build
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy source and build
COPY . .

RUN npm run build


# ---- Stage 2: Serve ----
FROM nginx:1.27-alpine AS runtime

ENV NODE_ENV=production

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx SPA config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy only the built static assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Non-root nginx
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
