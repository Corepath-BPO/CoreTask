# =============================================================================
# CoreTask API — production image
# =============================================================================
# Multi-stage: the toolchain stays in the builder, the runtime carries compiled
# JavaScript, production dependencies and the generated Prisma client only.
#
# Build context is the repository root.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — install, build, then prune to production dependencies
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

RUN apk add --no-cache openssl libc6-compat

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
COPY api/package.json                    ./api/

RUN pnpm install --frozen-lockfile --filter "@coretask/api..."

COPY packages ./packages
COPY api ./api

RUN pnpm --filter "./packages/*" build \
 && pnpm --filter @coretask/api exec prisma generate \
 && pnpm --filter @coretask/api exec nest build

# `pnpm deploy` — not `install --prod`. Pruning in place leaves every package in
# pnpm's virtual store (`node_modules/.pnpm`), so typescript, jest and eslint
# still ship. `deploy` writes a fresh self-contained tree containing production
# dependencies only, with workspace packages copied in rather than symlinked.
#
# The Prisma client is regenerated afterwards because the deployed tree has its
# own node_modules and does not carry the builder's generated output.
RUN pnpm --filter @coretask/api --prod --legacy deploy /deploy \
 && cd /deploy \
 && ./node_modules/.bin/prisma generate

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache openssl libc6-compat tini

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate

WORKDIR /app

# The deployed tree is already self-contained: dist, prisma, package.json and a
# flat production node_modules with no workspace symlinks to resolve.
COPY --from=builder --chown=node:node /deploy ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
