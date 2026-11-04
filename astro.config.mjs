import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import { parse } from 'yaml';

// Where the site lives: site.url in kit.yaml, for a site you host yourself.
// GitHub Pages serves a project site from /<repo>/, so the deploy workflow
// passes SITE_URL and BASE_PATH, which win. Every internal link goes through
// href() in src/lib/paths.ts.
const url = parse(readFileSync('kit.yaml', 'utf8')).site?.url;
const address = url ? new URL(url) : undefined;

export default defineConfig({
  site: process.env.SITE_URL || address?.origin || 'https://example.github.io',
  base: process.env.BASE_PATH || address?.pathname || '/',
  outDir: process.env.OUT_DIR || 'dist',
  vite: {
    server: { strictPort: true },
    preview: { strictPort: true },
  },
});
