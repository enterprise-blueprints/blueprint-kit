import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The site finds packages with import.meta.glob, and a cached module
    // would miss a package folder added since the last run.
    fsModuleCache: false,
  },
});
