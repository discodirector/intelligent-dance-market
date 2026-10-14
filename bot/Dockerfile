# Build context: repository root (needs packages/core + bot).
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DRY_RUN=true \
    OUT_DIR=/app/out

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN echo '{"name":"swarm-sequencer","private":true,"workspaces":["packages/core","bot"]}' > package.json
COPY packages/core/package.json packages/core/
COPY bot/package.json bot/
RUN npm install --omit=dev --no-audit --no-fund \
 && npx playwright install --with-deps chromium-headless-shell \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY packages/core/src packages/core/src
COPY bot/src bot/src
COPY bot/data bot/data

WORKDIR /app/bot
CMD ["npx", "tsx", "src/scheduler.ts"]
