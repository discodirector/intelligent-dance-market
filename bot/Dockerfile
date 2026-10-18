# Build context: repository root. Ignore file: bot/Dockerfile.dockerignore.
# Stages: site (bot.html, the clip render page), web (render.html, the release page), then the bot image.
# One image runs both services in bot/docker-compose.yml: the scheduler (default CMD) and the pulse keeper.

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

# Stage 2: the web build, whose render.html?release=1 renders track releases (bot/src/release, produceRelease).
# web/ needs packages/core and packages/synth (imported by relative path / aliased in web/vite.config.ts) and its own
# sources; tsc runs first, as in `npm run build`.
FROM node:22-bookworm-slim AS web
WORKDIR /src
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN echo '{"name":"swarm-sequencer-web","private":true,"workspaces":["packages/core","packages/synth","web"]}' > package.json
COPY packages/core/package.json packages/core/
COPY packages/synth/package.json packages/synth/
COPY web/package.json web/
RUN npm install --no-audit --no-fund
COPY packages/core/src packages/core/src
COPY packages/synth/src packages/synth/src
COPY web/index.html web/render.html web/vite.config.ts web/tsconfig.json web/
COPY web/src web/src
COPY web/public web/public
RUN cd web && npm run build

# Stage 3: the bot.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DRY_RUN=true \
    OUT_DIR=/app/out \
    RENDER_SITE_DIR=/app/site/dist \
    RENDER_WEB_DIR=/app/web/dist

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
# bot/src/lib/release.ts imports web/src/trackSelect.ts (import-free) at runtime; the scheduler loads it too.
COPY web/src/trackSelect.ts web/src/trackSelect.ts
# Default tape of the release CLI and `pipeline.ts release` (synthetic, three completed v2 tracks).
COPY web/public/release-test.timeline.json web/public/release-test.timeline.json
COPY --from=site /src/site/dist /app/site/dist
COPY --from=web /src/web/dist /app/web/dist

WORKDIR /app/bot
CMD ["npx", "tsx", "src/scheduler.ts"]
