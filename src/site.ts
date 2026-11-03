import { parse } from 'yaml';
import kitText from '../kit.yaml?raw';
import type { SiteConfig } from './lib/config';

// This site, as kit.yaml describes it. The pages are the library's, and this
// is what makes them yours: your name and color, and the library release your
// packages build on, whose packages they use get pages here too.

const kit = parse(kitText) as {
  site: { title: string; description: string; accent?: string };
  library: { url: string; release: string };
};

// Your About page, while you keep one.
const hasAbout = Object.keys(import.meta.glob('./pages/about.astro')).length > 0;

export const site: SiteConfig = {
  title: kit.site.title,
  description: kit.site.description,
  accent: kit.site.accent,
  nav: [...(hasAbout ? [{ label: 'About', path: 'about/' }] : []), { label: 'The library', url: kit.library.url }],
  upstream: { title: 'Enterprise Blueprints', url: kit.library.url, release: String(kit.library.release) },
};
