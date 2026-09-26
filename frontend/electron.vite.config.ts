import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, "electron/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, "electron/preload.ts")
      }
    }
  },
  renderer: {
    root,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: Number(process.env.PAPER_HELPER_FRONTEND_PORT ?? 5173),
      strictPort: true
    },
    build: {
      rollupOptions: {
        input: resolve(root, "index.html")
      }
    }
  }
});
