# Build the SDK + dashboard, then run the backend (tsx runs the TypeScript directly).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY sdk/package.json sdk/
COPY backend/package.json backend/
COPY dashboard/package.json dashboard/
COPY mcp-server/package.json mcp-server/
COPY e2e/package.json e2e/
# Deliberately NOT setting NODE_ENV=production here: npm would skip devDependencies,
# and vite/esbuild (needed to build) plus tsx (needed at RUNTIME) all live there.
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    MIGRATE_ON_BOOT=true \
    HOME=/home/node
# STORAGE_DIR, created and owned by `node` so that when Docker first mounts an
# empty named volume over it, the volume inherits this ownership.
RUN mkdir -p /data/uploads && chown -R node:node /data
# --chown during the copy; a later `RUN chown -R /app` would duplicate the tree
# into a second layer.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
# node is PID 1 so SIGTERM reaches the shutdown handler directly — no npm or
# tsx-CLI process in between to swallow it. Migrations run in-process on boot
# (MIGRATE_ON_BOOT), before the port opens.
CMD ["node", "--import", "tsx", "backend/src/server.ts"]
