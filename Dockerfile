# Build the SDK + dashboard, then run the backend (tsx runs the TS directly).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY sdk/package.json sdk/
COPY backend/package.json backend/
COPY dashboard/package.json dashboard/
COPY mcp-server/package.json mcp-server/
COPY e2e/package.json e2e/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "backend"]
