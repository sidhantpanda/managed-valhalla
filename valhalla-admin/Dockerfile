# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS node

# Install dependencies (dev ones are needed to build).
FROM node AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.cache/pnpm pnpm install --frozen-lockfile

# Build the standalone Next.js server.
FROM node AS builder
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Runtime: Valhalla's own image provides the tile build tools, plus osmium to merge regions and Node to run the app.
FROM ghcr.io/valhalla/valhalla-scripted:latest AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends osmium-tool \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
# The base image's entrypoint builds Valhalla tiles; this container runs the admin server instead.
ENTRYPOINT []
CMD ["node", "server.js"]
