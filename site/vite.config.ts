import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Both packages ship TypeScript source.
      "@swarm-sequencer/synth": fileURLToPath(new URL("../packages/synth/src/index.ts", import.meta.url)),
      "@swarm-sequencer/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      // Deployment records live with the contracts; switching chains = adding a file + a config entry.
      "@deployments": fileURLToPath(new URL("../contracts/deployments", import.meta.url)),
      // Station registry, shared with the bot: adding a station = adding an entry there.
      "@stations": fileURLToPath(new URL("../stations", import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ["@swarm-sequencer/synth", "@swarm-sequencer/core"] },
  server: { host: "127.0.0.1", port: 5180, fs: { allow: [repoRoot] } },
  preview: { host: "127.0.0.1", port: 4180 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
    // bot.html is the bot's render page (bot/src/render), stream.html the YouTube radio's audio source (sim/stream/live);
    // index.html, docs.html and stations.html are the public site; lab.html the style lab (prototype).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        docs: fileURLToPath(new URL("docs.html", import.meta.url)),
        stations: fileURLToPath(new URL("stations.html", import.meta.url)),
        bot: fileURLToPath(new URL("bot.html", import.meta.url)),
        stream: fileURLToPath(new URL("stream.html", import.meta.url)),
        listen: fileURLToPath(new URL("listen.html", import.meta.url)),
        lab: fileURLToPath(new URL("lab.html", import.meta.url)),
      },
    },
  },
});
