import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// Runs the content script in a copy with no Git remote, the way an organization
// hosting its own site does, so what it keeps and rewrites is what's tested. It
// uses whatever packages are in source/, since every copy of the kit runs these.
describe('publishing without a Git remote', () => {
  let dir: string;
  const packagesHere = readdirSync('source').sort();
  const name = packagesHere[0];
  const run = (mode: string) =>
    spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/content.ts', mode], { cwd: dir, encoding: 'utf8' });
  const versions = () => readdirSync(join(dir, 'content', name)).sort();
  const packageText = (version: string) => readFileSync(join(dir, 'content', name, version, 'blueprint.json'), 'utf8');
  const record = () => JSON.parse(readFileSync(join(dir, 'published.json'), 'utf8'));
  const edit = (title: string) => {
    const path = join(dir, 'source', name, 'package.yaml');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^title: .*$/m, `title: ${title}`));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kit-'));
    for (const path of ['kit.yaml', 'package.json', 'source', 'library', 'schemas', 'scripts', 'src/lib']) cpSync(path, join(dir, path), { recursive: true });
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'junction');
  });
  afterEach(() => {
    unlinkSync(join(dir, 'node_modules'));
    rmSync(dir, { recursive: true });
  });

  it('rebuilds a draft in place, freezes it on publishing, and starts the next release after that', { timeout: 60_000 }, () => {
    expect(run('build').stdout).toContain('Release 0.1.0 is a draft');
    edit('First draft');
    expect(run('build').status).toBe(0);
    expect(versions()).toEqual(['0.1.0']);
    expect(packageText('0.1.0')).toContain('First draft');

    expect(run('publish').stdout).toContain('Published release 0.1.0');
    const frozen = packageText('0.1.0');
    expect(Object.keys(record()).sort()).toEqual(packagesHere);
    expect(run('publish').stdout).toContain('Release 0.1.0 is already published');

    edit('Second');
    run('build');
    edit('Third');
    run('build');
    expect(versions()).toEqual(['0.1.0', '0.2.0']);
    expect(packageText('0.1.0')).toBe(frozen);
    expect(packageText('0.2.0')).toContain('Third');

    // Back to what's published, the draft is no longer needed.
    edit('First draft');
    run('build');
    expect(versions()).toEqual(['0.1.0']);
  });

  it('refuses to go on when a published version has changed', { timeout: 60_000 }, () => {
    run('publish');
    const path = join(dir, 'content', name, '0.1.0', 'blueprint.json');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`);
    for (const mode of ['check', 'build', 'publish']) {
      const result = run(mode);
      expect(result.status, mode).toBe(1);
      expect(result.stderr, mode).toContain('A published version never changes');
    }
  });

  it('keeps the versions already in content/ the first time it runs', { timeout: 60_000 }, () => {
    cpSync('content', join(dir, 'content'), { recursive: true });
    const before = versions();
    const texts = before.map(packageText);
    edit('Edited');
    expect(run('build').status).toBe(0);
    expect(versions()).toEqual(expect.arrayContaining(before));
    expect(versions()).toHaveLength(before.length + 1);
    expect(before.map(packageText)).toEqual(texts);
    expect(Object.keys(record()[name]).sort()).toEqual(before);
  });
});
