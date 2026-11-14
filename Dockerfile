
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

FROM source AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM source AS builder
# The prisma.config.ts file will parse it, satisfy its env() check, and successfully generate the client.
# When the container eventually starts via Docker Compose, this dummy value is discarded, and the application
# will correctly ingest the real DATABASE_URL defined in your Compose file.
RUN DATABASE_URL="postgresql://dummy:dummy@localhost/dummy" npm run build && npm prune --omit=dev

FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# Ensure Prisma's C-engine dependencies are present in the final runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma

USER node
EXPOSE 8080

# Default to API, but allow Compose/K8s to easily override CMD to ["node", "dist/worker/main.js"]
CMD ["node", "dist/api/server.js"]
