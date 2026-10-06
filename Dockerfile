# One image runs the whole demo: the web app (public) and the API (private), side by side.
FROM node:22-bookworm-slim

# Prisma needs OpenSSL at runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable
WORKDIR /app

# Install with dev dependencies too: the API runs TypeScript directly through tsx.
COPY . .
RUN pnpm install --frozen-lockfile --prod=false \
 && pnpm --filter @kairo/db exec prisma generate \
 && pnpm --filter @kairo/web build

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "--import", "tsx", "scripts/render-start.ts"]
