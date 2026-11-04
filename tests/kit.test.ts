import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { elements, elementsOfType, helpsWith, inUse, isOwn, ownPackages, packages, release, upstream } from '../src/lib/library';
import { plan, readSources, type Resolved } from '../src/lib/compile';
import type { BlueprintPackage } from '../src/lib/package';

const read = (path: string): BlueprintPackage => JSON.parse(readFileSync(path, 'utf8'));
const libraryRelease = upstream!.release;

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
    expect(ownPackages.length).toBeGreaterThan(0);
    for (const p of ownPackages) {
      expect(p.idPrefix, p.packageId).not.toBe('eb');
      for (const d of p.dependencies ?? []) if (d.packageId.startsWith('org.enterprise-blueprints.')) expect(d.version, p.packageId).toBe(libraryRelease);
    }
  });

  it('give every resource a link, a review date, and something it helps with', () => {
    for (const r of elementsOfType('resource').filter((e) => isOwn(e.package))) {
      expect(r.attributes, r.id).toEqual(expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//), lastReviewedAt: expect.any(String) }));
      expect(helpsWith(r).length, r.id).toBeGreaterThan(0);
    }
  });

  it('name every element with your prefix', () => {
    for (const e of elements.filter((e) => isOwn(e.package))) expect(e.id.split(':')[0], e.id).toBe(e.package.idPrefix);
  });
});

describe('the library on your site', () => {
  const shown = packages.filter((p) => !isOwn(p));

  it('uses the library packages yours build on, and the ones those build on', () => {
    const used = shown.filter(inUse);
    const wanted = new Set(ownPackages.flatMap((p) => (p.dependencies ?? []).map((d) => d.packageId)));
    for (const id of wanted) expect(used.map((p) => p.packageId), id).toContain(id);
    for (const p of used) {
      const needed = wanted.has(p.packageId) || used.some((q) => q.dependencies?.some((d) => d.packageId === p.packageId));
      expect(needed, p.packageId).toBe(true);
    }
  });

  it('shows the whole release when kit.yaml asks for it, and only what yours use when not', () => {
    const release = readdirSync('library/packages').filter((name) => existsSync(join('library', 'packages', name, libraryRelease, 'blueprint.json')));
    expect(shown.length).toBe(upstream!.showAll ? release.length : shown.filter(inUse).length);
    for (const p of shown) expect(p.version, p.packageId).toBe(libraryRelease);
  });

  it('gives library elements pages under library/ that link to the library’s own', () => {
    for (const e of elements.filter((e) => !isOwn(e.package))) {
      expect(e.url, e.id).toContain(`/library/${e.typeInfo.section}/${e.slug}/`);
      expect(e.canonicalUrl, e.id).toBe(new URL(`${e.typeInfo.section}/${e.slug}/`, upstream!.base).href);
    }
  });
});
