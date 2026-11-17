FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:20-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY portfolio-gateway.mjs ./
COPY telemetry.cjs ./
USER node
EXPOSE 8080
CMD ["node", "portfolio-gateway.mjs"]
