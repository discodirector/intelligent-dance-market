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
    },
  },
  optimizeDeps: { exclude: ["@swarm-sequencer/synth", "@swarm-sequencer/core"] },
  server: { host: "127.0.0.1", port: 5180, fs: { allow: [repoRoot] } },
  preview: { host: "127.0.0.1", port: 4180 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
    // bot.html is the bot's render page (bot/src/render); index.html is the public site.
    rollupOptions: { input: { main: fileURLToPath(new URL("index.html", import.meta.url)), bot: fileURLToPath(new URL("bot.html", import.meta.url)) } },
  },
});
