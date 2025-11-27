# Shared base image
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat bash
WORKDIR /app

# 1) Prune monorepo down to the api + deps
FROM base AS builder
RUN yarn global add turbo
COPY . .
# Creates /app/out with pruned workspace for "api"
RUN turbo prune --scope=api --docker

# 2) Install dependencies in pruned workspace + Prisma client
FROM base AS installer
WORKDIR /app

# Minimal package.json tree and lockfile
COPY --from=builder /app/out/json/ ./
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/turbo.json ./turbo.json

# Prisma schema for the API
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

RUN yarn install --frozen-lockfile

# Prisma generate – uses the schema, no DB connection required
RUN cd apps/api && npx prisma generate

# 3) Copy full pruned source and build the api with Turbo
FROM base AS sourcer
WORKDIR /app

COPY --from=installer /app/ ./
COPY --from=builder /app/out/full/ ./
COPY .gitignore .gitignore

# Build only the api (and whatever it depends on)
RUN yarn turbo run build --scope=api --include-dependencies --no-deps

# 4) Runtime image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts + node_modules from sourcer
COPY --from=sourcer /app/ ./

# API listens on 5002 in main.ts
ENV PORT=5002
EXPOSE 5002

CMD ["node", "apps/api/dist/main.js"]
