import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Repo name for GitHub Pages project site
  base: process.env.GITHUB_ACTIONS ? "/Armonivet-/" : "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
      },
    },
  },
});
