import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { elements, libraryRelease, linksOf, packages, release, resources } from '../src/kit';
import { plan, readSources, type Resolved } from '../src/lib/compile';
import type { BlueprintPackage } from '../src/lib/package';

const read = (path: string): BlueprintPackage => JSON.parse(readFileSync(path, 'utf8'));

describe('your packages', () => {
  it('are built from the current source, on the library release kit.yaml names', () => {
    const external: Record<string, Resolved> = {};
    for (const name of readdirSync('library/packages')) {
      const path = join('library', 'packages', name, libraryRelease, 'blueprint.json');
      if (existsSync(path)) external[name] = { packageId: read(path).packageId, version: libraryRelease, idPrefix: 'eb' };
    }
    const content = Object.fromEntries(
      readdirSync('content').map((name) => [name, Object.fromEntries(readdirSync(join('content', name)).map((v) => [v, read(join('content', name, v, 'blueprint.json'))]))]),
    );
    const steps = plan(readSources('source'), content, () => true, '2026-01-01', external);
    for (const s of steps.filter((x) => !x.retired)) expect([s.name, s.version, s.reason], 'run pnpm content:build').toEqual([s.name, release, 'unchanged']);
  });

  // Loading the site checks every package against its schema and the library's packages it builds on.
  it('are valid, and build on the library at its release', () => {
    expect(packages.length).toBeGreaterThan(0);
    for (const p of packages) {
      expect(p.idPrefix, p.packageId).not.toBe('eb');
      for (const d of p.dependencies ?? []) if (d.packageId.startsWith('org.enterprise-blueprints.')) expect(d.version, p.packageId).toBe(libraryRelease);
    }
  });

  it('give every resource a link, a review date, and something it helps with', () => {
    for (const r of resources) {
      expect(r.attributes, r.id).toEqual(expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//), lastReviewedAt: expect.any(String) }));
      expect(linksOf(r)[0]?.links.length, r.id).toBeGreaterThan(0);
    }
  });

  it('name every element with your prefix', () => {
    for (const e of elements) expect(e.id.split(':')[0], e.id).toBe(e.package.idPrefix);
  });
});
