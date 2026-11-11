# syntax=docker/dockerfile:1
FROM node:22.12.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder
WORKDIR /app

COPY tsconfig.json tsconfig.build.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY shared ./shared
COPY api ./api
COPY worker ./worker

RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run db:generate

RUN npm run build && npm prune --omit=dev

FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# Ensure non-root ownership and execution
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/api/server.js"]