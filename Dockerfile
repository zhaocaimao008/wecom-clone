FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY server/package*.json ./
RUN cd server && npm ci --omit=dev && cd ..
COPY admin/package*.json ./
RUN cd admin && npm ci --omit=dev && cd ..

# Copy source
COPY . .

# Build Next.js client (if applicable)
# RUN cd client && npm run build

EXPOSE 3001 3002

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["sh", "-c", "node server/index.js & node admin/server.js & wait"]
