FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
