# Casproof x402 verify server.
# Runs the agents HTTP gate (GET /verify?hash=<outputHash>) via tsx.
FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    X402_PORT=4021

WORKDIR /app

# Install deps first for layer caching. tsx is a devDependency that runs the
# server directly, so dev deps are needed at runtime — include them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 4021

# Drop root.
USER node

CMD ["npm", "run", "x402:server"]
