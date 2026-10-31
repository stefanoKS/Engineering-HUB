# Engineering-HUB worker image (outbox, notifications, backups, exports).
#
# The worker bundle is self-contained (internal `@eh/*` workspaces are compiled into `dist`),
# so the runtime image only needs the production dependencies and the PostgreSQL client tools.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
COPY tsconfig.base.json ./
RUN npm ci --no-audit --no-fund
RUN npm run build --workspace @eh/worker

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY tools/benchmark/package.json tools/benchmark/package.json
COPY tools/migration/package.json tools/migration/package.json
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

FROM node:24-alpine AS runtime
# The worker runs pg_dump/pg_restore for the verified custom-format backup path.
RUN apk add --no-cache postgresql18-client
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY package.json ./
USER node
CMD ["node", "apps/worker/dist/main.js"]
