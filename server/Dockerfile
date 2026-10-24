# ==============================================================================
# Production Dockerfile for Trinova Integration & Signing Service
# Lean, multi-stage, hardened Node.js 22 runtime image
# ==============================================================================

# Build & Dependency Stage
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install package manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Production Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=4000
ENV LOG_LEVEL=info

# Create directory for persistent document storage and audit records
RUN mkdir -p /var/data/trinova/documents && \
    chown -R node:node /var/data/trinova

# Copy dependencies and application from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/src ./src

# Use unprivileged node user
USER node

# Expose Trinova API server port
EXPOSE 4000

# Volume mount for separate document storage
VOLUME ["/var/data/trinova"]

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1

# Start server
CMD ["node", "src/server.js"]
