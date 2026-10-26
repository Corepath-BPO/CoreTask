# =============================================================================
# CoreTask marketing site — production image
# =============================================================================
# Next.js exports the site as static files; nginx serves them. The runtime
# carries no Node.js and no build tooling.
#
# Build context is the repository root.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — build the static export
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

RUN apk add --no-cache libc6-compat

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json      ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY website/package.json                ./website/

RUN pnpm install --frozen-lockfile --filter "@coretask/website..."

# Only the shared packages the site depends on. Neither has a build step: one
# is JSON, the other plain JavaScript.
COPY packages/tsconfig      ./packages/tsconfig
COPY packages/eslint-config ./packages/eslint-config
COPY website ./website

# Next inlines NEXT_PUBLIC_* variables at build time, so the domains and the
# contact address are baked into the HTML here rather than read at run time.
# The defaults match website/src/content/site.ts: an empty value would not fall
# back to them, because the code uses `??`.
ARG NEXT_PUBLIC_SITE_URL=https://coretask.org
ARG NEXT_PUBLIC_APP_URL=https://app.coretask.org
ARG NEXT_PUBLIC_CONTACT_EMAIL=hello@coretask.org
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL

RUN pnpm --filter @coretask/website build

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# -----------------------------------------------------------------------------
# The unprivileged image runs as uid 101 and listens on 8080, so no capability
# is needed to bind the port.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY --chown=nginx:nginx infrastructure/nginx/website.conf /etc/nginx/conf.d/default.conf
# Not under conf.d/: nginx auto-loads every conf.d/*.conf into the http context,
# which would apply these at http level as well as inside each location.
COPY --chown=nginx:nginx infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder --chown=nginx:nginx /app/website/out /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
