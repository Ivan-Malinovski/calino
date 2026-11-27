FROM node:22-alpine

WORKDIR /app
COPY server.mjs .

ENV PORT=8081
EXPOSE 8081

# Lets registries and container managers link the image to its source and
# release notes. Release CI adds the version, revision and build date.
LABEL org.opencontainers.image.title="Calino CalDAV Proxy" \
    org.opencontainers.image.description="Optional CORS proxy for using Calino with CalDAV servers" \
    org.opencontainers.image.url="https://calino.io" \
    org.opencontainers.image.source="https://github.com/Ivan-Malinovski/calino" \
    org.opencontainers.image.documentation="https://github.com/Ivan-Malinovski/calino/blob/main/docs/DOCKER.md#caldav-cors-proxy-optional" \
    org.opencontainers.image.vendor="Ivan Malinovski" \
    org.opencontainers.image.licenses="MIT"

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8081/health || exit 1

CMD ["node", "server.mjs"]
