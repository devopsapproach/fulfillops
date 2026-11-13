
FROM node:22.12.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS source
WORKDIR /app
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY shared ./shared
COPY api ./api
COPY worker ./worker
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run db:generate

FROM source AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM source AS builder
RUN npm run build && npm prune --omit=dev

FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/api/server.js"]
