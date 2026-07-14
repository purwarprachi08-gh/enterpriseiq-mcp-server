# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm install

# Copy source code and compile TypeScript → JavaScript
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy package manifest and install production deps only
COPY package.json ./
RUN npm install --omit=dev

# Copy compiled output from builder stage
COPY --from=builder /app/build ./build

# Runtime environment variables — injected by IBM Code Engine
ENV PORT=3000
ENV NODE_ENV=production

# Expose the HTTP port that the MCP server listens on
EXPOSE 3000

# Health check — IBM Code Engine uses this to confirm the app is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the MCP server
CMD ["node", "build/index.js"]
