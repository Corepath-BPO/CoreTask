# =============================================================================
# CoreTask web client — production image
# =============================================================================
# Vite builds a static bundle; nginx serves it. The runtime carries no Node.js
# and no build tooling.
#
# Build context is the repository root.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — build the static bundle
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

RUN apk add --no-cache libc6-compat

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json      ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/contracts/package.json     ./packages/contracts/
COPY packages/types/package.json         ./packages/types/
COPY packages/validation/package.json    ./packages/validation/
COPY web/package.json                    ./web/

RUN pnpm install --frozen-lockfile --filter "@coretask/web..."

COPY packages ./packages
COPY web ./web

# Vite inlines VITE_* variables at build time, so the API origin is baked into
# the bundle here rather than read at run time.
ARG VITE_API_URL=/api/v1
ARG VITE_WS_URL=/
ARG VITE_APP_NAME=CoreTask
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_APP_NAME=$VITE_APP_NAME

RUN pnpm --filter "./packages/*" build \
 && pnpm --filter @coretask/web build

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# -----------------------------------------------------------------------------
# The unprivileged image runs as uid 101 and listens on 8080, so no capability
# is needed to bind the port.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY --chown=nginx:nginx infrastructure/nginx/web.conf /etc/nginx/conf.d/default.conf
# Not under conf.d/: nginx auto-loads every conf.d/*.conf into the http context,
# which would apply these at http level as well as inside each location.
COPY --chown=nginx:nginx infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder --chown=nginx:nginx /app/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
