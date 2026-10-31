# Engineering-HUB API + web image.
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

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_ROOT=/app/apps/web/dist
# The reviewed SQL lives outside the bundle; the one-shot `migrate` service runs it by name.
ENV EH_MIGRATIONS_DIR=/app/migrations
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/db/src/migrations ./migrations
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
