# Engineering-HUB API + web image.
#
# The API and worker bundles are self-contained: the internal `@eh/*` workspaces are compiled
# into `dist`, so the runtime image needs neither the TypeScript sources nor the workspace links.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
COPY shared ./shared
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.mts ./
RUN npm ci --no-audit --no-fund
RUN npm run build --workspace @eh/web && npm run build --workspace @eh/api

# Production dependencies only. Only workspace manifests are required here; npm creates the
# workspace links itself and the bundle never imports them.
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
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_ROOT=/app/apps/web/dist
# The reviewed SQL lives outside the bundle; the one-shot `migrate` service runs it by name.
ENV EH_MIGRATIONS_DIR=/app/migrations
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/db/src/migrations ./migrations
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
