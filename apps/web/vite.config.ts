import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const runnerPort = Number(process.env.RUBIK_PORT ?? 8787);
const tokenFile = resolve(import.meta.dirname, "../../data/.runner-token");

export default defineConfig({
  plugins: [
    react(),
    {
      // cubejs/lib/solve.js reads `this.Cube` (CommonJS top-level `this`), which is undefined in ESM bundles.
      name: "cubejs-this-fix",
      enforce: "pre",
      transform(code, id) {
        if (!/cubejs[\\/]lib[\\/]solve\.js$/.test(id)) return null;
        return code.replace("Cube = this.Cube || require('./cube');", "Cube = require('./cube');");
      },
    },
  ],
  // Relative asset paths so the same build works from the runner and from GitHub Pages (demo mode).
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${runnerPort}`,
        changeOrigin: true,
        // Dev convenience: inject the runner token from the local token file so the dev page needs no #token.
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (!req.getHeader("authorization") && existsSync(tokenFile)) {
              req.setHeader("authorization", `Bearer ${readFileSync(tokenFile, "utf8").trim()}`);
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
