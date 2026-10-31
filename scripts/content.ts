// Builds content/ from source/, on the library release kit.yaml names.
//
//   pnpm content:build   write each package whose source changed, at its next version
//   pnpm content:check   fail if content/ is behind source/, writing nothing
//
// Your packages are released together, as one version, like the library's.
// A release is published once it's on origin/main, and never changes after
// that. A release built since then is rebuilt in place until it's pushed.
// A package.yaml builds on the library's packages by their folder names in
// library/packages/, such as common or federal-oig.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { plan, readSources, SourceError, type Resolved } from '../src/lib/compile.ts';
import type { BlueprintPackage } from '../src/lib/package.ts';

const mode = process.argv[2];
if (mode !== 'build' && mode !== 'check') {
  console.error('Usage: content.ts build | check');
  process.exit(2);
}

const release = String((parse(readFileSync('kit.yaml', 'utf8')) as { library: { release: string } }).library.release);
const read = (path: string): BlueprintPackage => JSON.parse(readFileSync(path, 'utf8'));
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

// The library's packages at the release, by folder name.
const external: Record<string, Resolved> = {};
for (const name of folders(join('library', 'packages'))) {
  const path = join('library', 'packages', name, release, 'blueprint.json');
  if (!existsSync(path)) continue;
  const pkg = read(path);
  external[name] = { packageId: pkg.packageId, version: pkg.version, idPrefix: pkg.idPrefix ?? 'eb' };
}
if (!Object.keys(external).length) {
  console.error(`library/ doesn't have release ${release} yet. Run pnpm sync first.`);
  process.exit(1);
}

mkdirSync('content', { recursive: true });
const content: Record<string, Record<string, BlueprintPackage>> = Object.fromEntries(
  folders('content').map((name) => {
    const dir = join('content', name);
    const versions = readdirSync(dir).filter((v) => existsSync(join(dir, v, 'blueprint.json')));
    return [name, Object.fromEntries(versions.map((v) => [v, read(join(dir, v, 'blueprint.json'))]))];
  }),
);

// Checking reads every version in content/ as published; building asks Git which are.
let isPublished = (_name: string, _version: string) => true;
if (mode === 'build') {
  let listed = '';
  try {
    listed = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'content'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // Nothing is pushed yet, so nothing is published.
  }
  const live = new Set(listed.split('\n').filter((p) => p.endsWith('/blueprint.json')));
  isPublished = (name, version) => live.has(`content/${name}/${version}/blueprint.json`);
}

const today = new Date().toLocaleDateString('en-CA');
let steps;
try {
  steps = plan(readSources('source'), content, isPublished, today, external);
} catch (e) {
  if (e instanceof SourceError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const behind = steps.filter((s) => s.write || s.remove.length);
for (const s of steps) {
  const what = s.retired ? 'retired' : s.write ? (content[s.name]?.[s.version] ? 'rebuilt' : 'new') : 'stays on';
  console.log(`${s.name.padEnd(22)} ${what.padEnd(8)} ${s.version.padEnd(7)} ${s.reason}`);
}

if (mode === 'check') {
  if (behind.length) {
    console.error(`\ncontent/ is behind source/ for ${behind.map((s) => s.name).join(', ')}. Run pnpm content:build.`);
    process.exit(1);
  }
  process.exit(0);
}

for (const s of behind) {
  for (const v of s.remove) {
    rmSync(join('content', s.name, v), { recursive: true });
    console.log(`removed content/${s.name}/${v}/, which was never published`);
  }
  if (s.write) {
    const dir = join('content', s.name, s.version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'blueprint.json'), JSON.stringify(s.write, null, 2) + '\n');
  }
}
if (behind.length) console.log('\nNow run pnpm verify to check everything and build the site.');
