# Build context: repository root (needs packages/core + bot, and packages/synth + site + web/src/timeline.ts
# + contracts/deployments for the render page).

# Stage 1: the site build, whose bot.html is the render page (IDM-16 module, synth with eras and arrangement).
FROM node:22-bookworm-slim AS site
WORKDIR /src
RUN echo '{"name":"swarm-sequencer-site","private":true,"workspaces":["packages/core","packages/synth","site"]}' > package.json
COPY packages/core/package.json packages/core/
COPY packages/synth/package.json packages/synth/
COPY site/package.json site/
RUN npm install --no-audit --no-fund
COPY packages/core/src packages/core/src
COPY packages/synth/src packages/synth/src
COPY web/src/timeline.ts web/src/timeline.ts
COPY contracts/deployments contracts/deployments
COPY site/index.html site/bot.html site/vite.config.ts site/tsconfig.json site/
COPY site/src site/src
COPY site/public site/public
RUN cd site && npx vite build

# Stage 2: the bot.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DRY_RUN=true \
    OUT_DIR=/app/out \
    RENDER_SITE_DIR=/app/site/dist

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
COPY --from=site /src/site/dist /app/site/dist

WORKDIR /app/bot
CMD ["npx", "tsx", "src/scheduler.ts"]
