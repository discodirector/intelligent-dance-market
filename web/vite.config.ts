import { createReadStream } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Connect, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const synthEntry = fileURLToPath(new URL("../packages/synth/src/index.ts", import.meta.url));
const realTimeline = fileURLToPath(new URL("../bot/data/imd-eth-7d.timeline.json", import.meta.url));

/** Dev and preview serve W3's committed 7-day tape without copying it into public/. */
function serveRealTimeline(): Plugin {
  const mount: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/timelines/imd-eth-7d.timeline.json") {
      next();
      return;
    }
    res.setHeader("content-type", "application/json");
    createReadStream(realTimeline)
      .on("error", () => {
        res.statusCode = 404;
        res.end("timeline missing");
      })
      .pipe(res);
  };
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(mount);
  };
  return {
    name: "w3-timeline",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [serveRealTimeline()],
  resolve: {
    alias: {
      "@swarm-sequencer/synth": synthEntry,
    },
  },
  optimizeDeps: {
    exclude: ["@swarm-sequencer/synth"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        render: fileURLToPath(new URL("./render.html", import.meta.url)),
      },
    },
  },
});
