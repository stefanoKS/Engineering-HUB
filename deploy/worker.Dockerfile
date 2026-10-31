# Engineering-HUB worker image (outbox, notifications, backups, exports).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
RUN npm ci --no-audit --no-fund
RUN npm run build --workspace @eh/worker

FROM node:24-alpine AS runtime
# The worker runs pg_dump for the custom-format backup path.
RUN apk add --no-cache postgresql18-client
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY package.json ./
USER node
CMD ["node", "apps/worker/dist/main.js"]
