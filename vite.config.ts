import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(__dirname, "src"),
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, "src/overlay.html"),
        options: resolve(__dirname, "src/options.html"),
        content: resolve(__dirname, "src/content/content-bridge.ts"),
        serviceWorker: resolve(__dirname, "src/background/service-worker.ts"),
        audioWorklet: resolve(__dirname, "src/audio/pcm-capture.worklet.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "content") return "content-bridge.js";
          if (chunk.name === "serviceWorker") return "service-worker.js";
          if (chunk.name === "audioWorklet") return "pcm-capture.worklet.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    root: resolve(__dirname),
    include: ["tests/**/*.test.ts"],
  },
});
