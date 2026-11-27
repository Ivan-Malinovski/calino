# ── Stage 1: Build ───────────────────────────────────────────────
FROM docker.io/library/node:25-alpine3.21 AS build

RUN npm install -g corepack@latest --force && corepack enable && corepack prepare pnpm@10 --activate

# Build-time env vars (overridable via --build-arg)
ARG VITE_SITE_URL=https://calino.io
# Serve the app under a subpath, e.g. /cal/. Leave "/" for the site root.
ARG CALINO_BASE_PATH=/
ARG CALINO_ENABLE_SW=false
ARG CALINO_GITHUB_REPO=ivan-malinovski/Calino
ARG CALINO_CONTACT_EMAIL=calendar@malinov.ski
ARG CALINO_SELF_HOSTED=true
ENV VITE_SITE_URL=$VITE_SITE_URL \
    CALINO_BASE_PATH=$CALINO_BASE_PATH \
    CALINO_ENABLE_SW=$CALINO_ENABLE_SW \
    CALINO_GITHUB_REPO=$CALINO_GITHUB_REPO \
    CALINO_CONTACT_EMAIL=$CALINO_CONTACT_EMAIL \
    CALINO_SELF_HOSTED=$CALINO_SELF_HOSTED

WORKDIR /app

# Install deps first (layer caching). The cache mount keeps pnpm's content
# store between builds, so a changed lockfile only downloads what is new.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=calino-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

# Copy source and build. `pnpm build` also runs `tsc -b`; typechecking is the
# release gate's job (and CI's), so the image build only bundles.
COPY . .
RUN node scripts/update-sample-events.mjs && pnpm exec vite build

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM docker.io/library/caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile

# Copy built assets from build stage
COPY --from=build /app/dist /srv

EXPOSE 8080

# The base image carries Caddy's OCI labels; override every one, or registries
# and container managers identify this image as Caddy. Release builds set the
# version with --label (a build arg here would go stale in Podman's cache).
LABEL org.opencontainers.image.title="Calino" \
    org.opencontainers.image.description="A beautiful CalDAV client for the web" \
    org.opencontainers.image.url="https://calino.io" \
    org.opencontainers.image.source="https://github.com/Ivan-Malinovski/calino" \
    org.opencontainers.image.documentation="https://github.com/Ivan-Malinovski/calino/blob/main/docs/DOCKER.md" \
    org.opencontainers.image.vendor="Ivan Malinovski" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.version=""

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
