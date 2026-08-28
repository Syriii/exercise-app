ARG NODE_BASE_IMAGE=node:24.19.0-bookworm-slim

FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

ARG APP_BUILD_REVISION=local
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ENV VITE_APP_BUILD_REVISION=$APP_BUILD_REVISION

RUN sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR%/}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends build-essential gosu python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build

FROM build AS verification

ENV NODE_ENV=test

FROM build AS production-dependencies

RUN npm prune --omit=dev

FROM ${NODE_BASE_IMAGE} AS runtime

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  WEB_DIST_DIR=/app/apps/web/dist \
  TEMP_MEDIA_ROOT=/app/.runtime/media

WORKDIR /app

COPY --from=production-dependencies /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/server/package.json apps/server/package.json
COPY --from=production-dependencies /app/apps/server/dist apps/server/dist
COPY --from=production-dependencies /app/apps/server/drizzle apps/server/drizzle
COPY --from=production-dependencies /app/apps/web/package.json apps/web/package.json
COPY --from=production-dependencies /app/apps/web/dist apps/web/dist
COPY --from=build /usr/sbin/gosu /usr/local/bin/gosu
COPY deployment/container-entrypoint.sh /usr/local/bin/exercise-app-entrypoint

RUN mkdir -p /app/.runtime/media \
  && chown -R node:node /app/.runtime \
  && chmod 0755 /usr/local/bin/exercise-app-entrypoint \
  && /usr/local/bin/gosu node:node true

USER root
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/usr/local/bin/gosu", "node:node", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/exercise-app-entrypoint"]
CMD ["node", "apps/server/dist/entrypoints/api.js"]
