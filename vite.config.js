import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command }) => {
  const backend = process.env.BETTERVIVA_BACKEND_URL || "http://127.0.0.1:8000";
  return {
    base: command === "build" ? "/static/build/" : "/",
    plugins: [vue()],
    publicDir: false,
    server: {
      proxy: {
        "/api": backend,
        "/static": backend,
        "/sw.js": backend,
      },
    },
    build: {
      outDir: "static/build",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "assets/app.js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  };
});
