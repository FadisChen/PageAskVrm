import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDirectory, "..");

await build({
  root: projectRoot,
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: resolve(projectRoot, "dist"),
    target: "es2022",
    rollupOptions: {
      input: resolve(projectRoot, "src/content/content-bridge.ts"),
      output: {
        format: "iife",
        name: "PageAskVrmContentBridge",
        inlineDynamicImports: true,
        entryFileNames: "content-bridge.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
