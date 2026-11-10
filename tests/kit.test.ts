import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
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
    const own = ownPackages.map((p) => p.packageId);
    const wanted = new Set(ownPackages.flatMap((p) => (p.dependencies ?? []).map((d) => d.packageId)).filter((id) => !own.includes(id)));
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
    // It says why the changes start a new release.
    expect(run('build').stdout).toContain('Release 0.1.0 is published, and a published version never changes, so your changes start release 0.2.0.');
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

// Only a copy that still has the sample can be made someone's own.
const isSample = existsSync('source/offerings/package.yaml') && readFileSync('source/offerings/package.yaml', 'utf8').includes('packageId: com.example.offerings');
describe.runIf(isSample)('making a copy yours', () => {
  let dir: string;
  const node = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...args], { cwd: dir, encoding: 'utf8' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kit-'));
    for (const path of ['kit.yaml', 'package.json', 'source', 'content', 'library', 'schemas', 'scripts', 'src/lib', 'src/pages/about.astro']) cpSync(path, join(dir, path), { recursive: true });
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'junction');
  });
  afterEach(() => {
    unlinkSync(join(dir, 'node_modules'));
    rmSync(dir, { recursive: true });
  });

  it('puts your site and package in place of the sample’s, ready to build, and only once', { timeout: 60_000 }, () => {
    const init = node('scripts/init.ts', '--org', 'Example Co', '--url', 'https://www.example.co', '--prefix', 'exco', '--package', 'exco-offerings');
    expect(init.status, init.stderr).toBe(0);
    expect(init.stdout).toContain('source/exco-offerings/ is your package, co.example.exco-offerings');
    expect(readFileSync(join(dir, 'kit.yaml'), 'utf8')).toContain('title: "Example Co Blueprints"');
    expect(readdirSync(join(dir, 'source'))).toEqual(['exco-offerings']);
    const pkg = readFileSync(join(dir, 'source', 'exco-offerings', 'package.yaml'), 'utf8');
    expect(pkg).toContain('packageId: co.example.exco-offerings');
    expect(pkg).toContain('idPrefix: exco');
    expect(existsSync(join(dir, 'content'))).toBe(false);
    expect(readFileSync(join(dir, 'src', 'pages', 'about.astro'), 'utf8')).not.toContain('make-it-yours');

    // Your package builds as it is, empty, ready for your first solution or resource.
    const build = node('scripts/content.ts', 'build');
    expect(build.status, build.stderr).toBe(0);
    expect(readdirSync(join(dir, 'content'))).toEqual(['exco-offerings']);

    // And kit:init leaves a copy that's yours alone.
    const again = node('scripts/init.ts', '--org', 'Other', '--url', 'https://other.org', '--prefix', 'other');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('already yours');
  });

  it('refuses a prefix that isn’t yours', { timeout: 60_000 }, () => {
    const init = node('scripts/init.ts', '--org', 'Example Co', '--url', 'https://example.co', '--prefix', 'eb');
    expect(init.status).toBe(1);
    expect(init.stderr).toContain('"eb" is the library’s');
  });
});

// Saving a solution another tool designed, such as Solution Studio's, into a copy's package.
describe('saving a solution from a file', () => {
  let dir: string;
  const node = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...args], { cwd: dir, encoding: 'utf8' });
  const pkg = readdirSync('source').sort()[0];
  const solutions = () => readFileSync(join(dir, 'source', pkg, 'solutions.yaml'), 'utf8');
  const save = (handoff: object) => {
    writeFileSync(join(dir, 'handoff.json'), JSON.stringify({ package: pkg, ...handoff }));
    return node('scripts/save-solution.ts', 'handoff.json');
  };
  const hotline = {
    id: 'hotline-on-our-platform',
    title: 'Hotline on our platform',
    description: 'A reporting form and a hotline queue on the case platform.',
    approach: 'platform',
    implements: ['eb:implementationPattern:confidential-hotline-intake'],
    components: [
      { key: 'form', title: 'Reporting form', tier: 'front', exposure: 'public', sendsTo: ['queue'] },
      { key: 'queue', title: 'Hotline queue', tier: 'service', technology: 'Our workflow' },
    ],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kit-'));
    for (const path of ['kit.yaml', 'package.json', 'source', 'content', 'published.json', 'library', 'schemas', 'scripts', 'editor', 'src/lib']) {
      if (existsSync(path)) cpSync(path, join(dir, path), { recursive: true });
    }
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'junction');
  });
  afterEach(() => {
    unlinkSync(join(dir, 'node_modules'));
    rmSync(dir, { recursive: true });
  });

  it('adds it, with its parts connected, changes it when saved again, and refuses one the release won’t take', { timeout: 120_000 }, () => {
    const first = save(hotline);
    expect(first.status, first.stderr).toBe(0);
    const result = JSON.parse(first.stdout.split('\n').find((l) => l.startsWith('RESULT '))!.slice(7));
    expect(result).toMatchObject({ package: pkg, id: 'hotline-on-our-platform', updated: false });
    expect(result.elementId).toMatch(/:solution:hotline-on-our-platform$/);
    expect(solutions()).toContain('title: Hotline on our platform');
    // Parts get IDs from their names, and what each sends to follows.
    const saved = (parse(solutions()) as { id: string; components?: { id: string; sendsTo?: string[]; exposure?: string }[] }[]).find((x) => x.id === 'hotline-on-our-platform')!;
    expect(saved.components!.map((c) => [c.id, c.sendsTo ?? [], c.exposure ?? null])).toEqual([
      ['reporting-form', ['hotline-queue'], 'public'],
      ['hotline-queue', [], null],
    ]);

    // The same ID again changes it, rather than adding another.
    const again = save({ ...hotline, title: 'Hotline on the agency platform' });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('"updated":true');
    expect(solutions().match(/id: hotline-on-our-platform/g)).toHaveLength(1);
    expect(solutions()).toContain('Hotline on the agency platform');

    // A pattern the library doesn't have: nothing is saved.
    const before = solutions();
    const refused = save({ ...hotline, id: 'nowhere', title: 'Nowhere', implements: ['eb:implementationPattern:no-such-pattern'] });
    expect(refused.status).toBe(1);
    expect(solutions()).toBe(before);
  });
});
