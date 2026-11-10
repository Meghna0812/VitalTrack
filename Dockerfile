# VitalTrack – one image that contains the API, the background worker and the built React app.
#
# "Multi-stage" build: the first stages do the heavy building (installing every package,
# compiling React). The final stage copies only what's needed to RUN the app, so the
# image stays small and contains no build tools or source maps.

# ---- Stage 1: build the React frontend into static files (client/dist) ----
FROM node:22-slim AS client-build
WORKDIR /app/client
# Copy only package files first: Docker caches this layer, so `npm ci` re-runs only when
# dependencies change – not on every code edit. Big speed-up for rebuilds.
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: install the server's production dependencies only ----
FROM node:22-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: the image that actually runs ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ ./
# The API serves these files (see src/index.js), so the whole app lives at one address.
COPY --from=client-build /app/client/dist ./public

# Don't run as root: if the app were ever compromised, the attacker gets a limited user.
RUN mkdir -p uploads && chown node:node uploads
USER node

EXPOSE 4000
# Waits for nothing fancy: `npm start` = run database migrations, then start the API.
CMD ["npm", "start"]
