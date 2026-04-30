# ── Stage 1: dependencies ───────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev=false

# ── Stage 2: build ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next.config.ts must have output: "standalone" for this to produce
# the self-contained server bundle under .next/standalone/
RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Azure App Service forwards traffic to WEBSITES_PORT (set in App Service
# config). We default to 3000 and tell Node to bind all interfaces.
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone bundle and static assets produced by the builder.
COPY --from=builder /app/public                         ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

USER nextjs

EXPOSE 3000

# next/standalone generates server.js at the bundle root
CMD ["node", "server.js"]
