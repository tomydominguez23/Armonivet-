import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // En el servidor propio usá VITE_BASE=/ . En GitHub Pages queda /Armonivet-/
  base: process.env.VITE_BASE || (process.env.GITHUB_ACTIONS ? "/Armonivet-/" : "/"),
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        about: resolve(import.meta.dirname, "about.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
        login: resolve(import.meta.dirname, "admin/login.html"),
      },
    },
  },
});
