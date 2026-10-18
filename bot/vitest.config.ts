import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Workspace packages resolve to this checkout's sources (like site/vite.config.ts), so a git worktree that shares
// another checkout's node_modules still tests its own core and synth.
export default defineConfig({
  resolve: {
    alias: {
      "@swarm-sequencer/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@swarm-sequencer/synth": fileURLToPath(new URL("../packages/synth/src/index.ts", import.meta.url)),
    },
  },
});
