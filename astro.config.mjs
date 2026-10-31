import { defineConfig } from 'astro/config';

// GitHub Pages serves a project site from /<repo>/. The deploy workflow passes
// the base path in BASE_PATH, and every internal link goes through href() in
// src/lib/paths.ts.
export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  base: process.env.BASE_PATH || '/',
  outDir: process.env.OUT_DIR || 'dist',
  vite: {
    server: { strictPort: true },
    preview: { strictPort: true },
  },
});
