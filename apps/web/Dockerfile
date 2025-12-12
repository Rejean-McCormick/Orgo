# Shared base
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat bash
WORKDIR /app

# 1) Prune monorepo down to web + deps
FROM base AS builder
RUN yarn global add turbo
COPY . .
RUN turbo prune --scope=web --docker

# 2) Install dependencies for pruned workspace
FROM base AS installer
WORKDIR /app

COPY --from=builder /app/out/json/ ./
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/turbo.json ./turbo.json

RUN yarn install --frozen-lockfile

# 3) Copy full pruned source and build web (no turbo run here)
FROM base AS sourcer
WORKDIR /app

COPY --from=installer /app/ ./
COPY --from=builder /app/out/full/ ./

# Build only web app and its dependencies
RUN cd apps/web && yarn build

# 4) Runtime image: Next.js production server
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=sourcer /app/ ./

# Next will read PORT; default 3000
ENV PORT=3000
EXPOSE 3000

# Use workspace-aware start script from apps/web/package.json
CMD ["yarn", "workspace", "web", "start"]
