FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV DOCKER_DEMO=1
EXPOSE 8888
CMD ["sh", "-c", "node scripts/migrate-local.mjs && node scripts/local-demo.mjs"]
