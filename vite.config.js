import { defineConfig } from "vite";

export default defineConfig({
  // Repo name for GitHub Pages project site
  base: process.env.GITHUB_ACTIONS ? "/Armonivet-/" : "/",
});
