# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:25-alpine3.21 AS build

RUN npm install -g corepack@latest --force && corepack enable && corepack prepare pnpm@10 --activate

# Build-time env vars (overridable via --build-arg)
ARG VITE_SITE_URL=https://calino.io
ARG CALINO_ENABLE_SW=false
ARG CALINO_GITHUB_REPO=ivan-malinovski/Calino
ARG CALINO_CONTACT_EMAIL=calendar@malinov.ski
ARG CALINO_SELF_HOSTED=true
ENV VITE_SITE_URL=$VITE_SITE_URL \
    CALINO_ENABLE_SW=$CALINO_ENABLE_SW \
    CALINO_GITHUB_REPO=$CALINO_GITHUB_REPO \
    CALINO_CONTACT_EMAIL=$CALINO_CONTACT_EMAIL \
    CALINO_SELF_HOSTED=$CALINO_SELF_HOSTED

WORKDIR /app

# Install deps first (layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM caddy:2-alpine

# Inline Caddy config — no separate file needed
RUN printf ':8080 {\n\troot * /srv\n\ttry_files {path} /index.html\n\tfile_server\n\n\trequest_body {\n\t\tmax_size 1mb\n\t}\n\n\tencode gzip\n\n\theader {\n\t\tX-Frame-Options "SAMEORIGIN"\n\t\tX-Content-Type-Options "nosniff"\n\t\tReferrer-Policy "strict-origin-when-cross-origin"\n\t\tPermissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"\n\t\t-Server\n\t}\n\n\t@assets path /assets/*\n\theader @assets Cache-Control "public, immutable"\n\n\t@sw path /sw.js\n\theader @sw Cache-Control "no-store, no-cache, must-revalidate"\n\theader @sw Service-Worker-Allowed "/"\n\n\tlog {\n\t\toutput stdout\n\t\tformat console\n\t}\n}\n' > /etc/caddy/Caddyfile

# Copy built assets from build stage
COPY --from=build /app/dist /srv

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
