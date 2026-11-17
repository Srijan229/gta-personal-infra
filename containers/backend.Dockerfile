FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev --no-audit --no-fund
COPY src ./src
COPY backend-bootstrap.cjs scenario.cjs expire.cjs ./
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001 3002
CMD ["node", "backend-bootstrap.cjs"]
