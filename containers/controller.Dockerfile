FROM node:20-bookworm-slim
WORKDIR /app
COPY controller ./controller
USER node
EXPOSE 8081
CMD ["node", "controller/main.mjs"]
