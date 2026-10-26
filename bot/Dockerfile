# Build context: repository root. Ignore file: bot/Dockerfile.dockerignore.
# Stages: site (bot.html, the clip render page), web (render.html, the release page), then the bot image.
# One image runs every service in bot/docker-compose.yml: the scheduler (default CMD), the pulse keeper, the stations
# API and the stations pipeline worker (its gate renders in the same Chromium headless shell as the releases).

# Stage 1: the site build, whose bot.html is the render page (IDM-16 module, synth with eras and arrangement).
FROM node:22-bookworm-slim AS site
WORKDIR /src
RUN echo '{"name":"swarm-sequencer-site","private":true,"workspaces":["packages/core","packages/synth","site"]}' > package.json
COPY packages/core/package.json packages/core/
COPY packages/synth/package.json packages/synth/
COPY site/package.json site/
RUN npm install --no-audit --no-fund
COPY packages/core/src packages/core/src
# The Credit rating table (core credittable.ts): the site bundles it as a lazily fetched asset.
COPY packages/core/data packages/core/data
COPY packages/synth/src packages/synth/src
# bot.ts also plans releases (web/src/release.ts, the same plan web/render.html renders the WAV from).
COPY web/src/timeline.ts web/src/release.ts web/src/trackSelect.ts web/src/build.d.ts web/src/
COPY contracts/deployments contracts/deployments
# The station registry (site alias @stations), its rules (validate.mjs: runtime stations, site/src/runtime.ts) and
# stations.html: vite.config.ts builds every page.
COPY stations/registry.json stations/validate.mjs stations/validate.d.mts stations/
COPY site/index.html site/docs.html site/stations.html site/bot.html site/stream.html site/vite.config.ts site/tsconfig.json site/
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
# gate.html: the style pack gate the stations pipeline runs (src/gatePage.ts, bot/src/stations/gate.ts), with the
# gate's fixed tape windows baked in.
COPY web/index.html web/render.html web/gate.html web/vite.config.ts web/tsconfig.json web/
COPY web/scripts/station-gate-windows.json web/scripts/station-gate-windows.json
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
RUN echo '{"name":"swarm-sequencer","private":true,"workspaces":["packages/core","packages/synth","bot"]}' > package.json
COPY packages/core/package.json packages/core/
COPY packages/synth/package.json packages/synth/
COPY bot/package.json bot/
RUN npm install --omit=dev --no-audit --no-fund \
 && npx playwright install --with-deps chromium-headless-shell \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY packages/synth/src packages/synth/src
COPY packages/core/src packages/core/src
# The Credit rating table: the credits station tags its sales with it (bot/src/station.ts ratingsFor).
COPY packages/core/data packages/core/data
COPY bot/src bot/src
COPY bot/data bot/data
# The station registry (bot/src/station.ts loadRegistry: ../../stations/registry.json) and its rules (validate.mjs,
# merging the pipeline's runtime stations): checkpoints, subscription status, the API and the stations worker read
# them. A baked registry edit needs an image rebuild; runtime stations (OUT_DIR/stations-data) do not.
COPY stations/registry.json stations/validate.mjs stations/validate.d.mts stations/
# The owner's application tool (docs/STATIONS.md "Applications and payment"): `docker compose exec api npx tsx
# scripts/station-apps.ts list` reads OUT_DIR/applications where the API writes it.
COPY bot/scripts/station-apps.ts bot/scripts/station-apps.ts
# Dry render of a station's track post from its cache: `docker exec swarm-sequencer-bot npx tsx scripts/station-release.ts credits`.
COPY bot/scripts/station-release.ts bot/scripts/station-release.ts
# bot/src/lib/release.ts imports web/src/trackSelect.ts (import-free) at runtime; the scheduler loads it too.
COPY web/src/trackSelect.ts web/src/trackSelect.ts
# Default tape of the release CLI and `pipeline.ts release` (synthetic, three completed v2 tracks).
COPY web/public/release-test.timeline.json web/public/release-test.timeline.json
COPY --from=site /src/site/dist /app/site/dist
COPY --from=web /src/web/dist /app/web/dist

WORKDIR /app/bot
CMD ["npx", "tsx", "src/scheduler.ts"]
