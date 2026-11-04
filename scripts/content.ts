// Builds content/ from source/, on the library release kit.yaml names.
//
//   pnpm content:build     write each package whose source changed, at its next version
//   pnpm content:check     fail if content/ is behind source/, writing nothing
//   pnpm content:publish   build, then freeze the release in published.json
//
// Your packages are released together, as one version, like the library's.
// A release is published once it's on origin/main or in published.json, and
// never changes after that. A release built since then is a draft, rebuilt in
// place until it's pushed or frozen. A package.yaml builds on the library's
// packages by their folder names in library/packages/, such as common or
// federal-oig.
//
// Each checks your release as it will be published, the way the site does:
// each package against its schema and the packages it builds on, yours and
// the library's. A problem stops the build before anything is written.
//
// published.json holds each frozen version's SHA-256 digest, by package, for a
// copy with no Git remote to tell it what's out there. The digests also catch
// a published file that changed, which a copy with no Git history can't undo.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { plan, readSources, SourceError, type Resolved } from '../src/lib/compile.ts';
import { validatePackage, type BlueprintPackage } from '../src/lib/package.ts';

const mode = process.argv[2];
if (mode !== 'build' && mode !== 'check' && mode !== 'publish') {
  console.error('Usage: content.ts build | check | publish');
  process.exit(2);
}

const release = String((parse(readFileSync('kit.yaml', 'utf8')) as { library: { release: string } }).library.release);
const read = (path: string): BlueprintPackage => JSON.parse(readFileSync(path, 'utf8'));
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

// The library's packages at the release, by folder name, and every version kept, for checking against.
const external: Record<string, Resolved> = {};
const libraryPackages = folders(join('library', 'packages')).flatMap((name) =>
  folders(join('library', 'packages', name)).map((version) => read(join('library', 'packages', name, version, 'blueprint.json'))),
);
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

const recordFile = 'published.json';
const packageFile = (name: string, version: string) => join('content', name, version, 'blueprint.json');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const record: Record<string, Record<string, string>> = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : {};
const saveRecord = () => writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
const inRecord = (name: string, version: string) => Boolean(record[name]?.[version]);

// A published version never changes, here or anywhere it was shared.
const altered = Object.entries(record).flatMap(([name, versions]) =>
  Object.entries(versions).flatMap(([version, sha256]) => {
    const path = packageFile(name, version);
    return !existsSync(path) ? [`${path} is missing`] : digest(path) !== sha256 ? [`${path} has changed`] : [];
  }),
);
if (altered.length) {
  console.error(`A published version never changes, so put these back as they were:\n  ${altered.join('\n  ')}\nChanges to source/ go in the next release.`);
  process.exit(1);
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let hasRemote = false;
try {
  hasRemote = git('remote').split('\n').includes('origin');
} catch {
  // This copy isn't in Git, or Git isn't here.
}

// Checking reads every version in content/ as published; the others ask Git and the record which are.
let isPublished = (_name: string, _version: string) => true;
if (mode !== 'check') {
  let listed = '';
  try {
    listed = git('ls-tree', '-r', '--name-only', 'origin/main', '--', 'content');
  } catch {
    // Nothing is pushed yet, so only the record says what's published.
  }
  const live = new Set(listed.split('\n').filter((p) => p.endsWith('/blueprint.json')));
  isPublished = (name, version) => live.has(`content/${name}/${version}/blueprint.json`) || inRecord(name, version);

  // With nothing to say what's out there, the versions already here stay as they are.
  if (!hasRemote && !existsSync(recordFile)) {
    for (const [name, versions] of Object.entries(content)) {
      record[name] = Object.fromEntries(Object.keys(versions).map((v) => [v, digest(packageFile(name, v))]));
    }
    saveRecord();
    const kept = Object.values(record).flatMap((versions) => Object.keys(versions)).length;
    console.log(`No Git remote, so ${recordFile} keeps track of what's published${kept ? `, starting with the ${kept} package files in content/` : ''}.\n`);
  }
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

// The release as it will be: what's written, and what stays.
const written = steps.flatMap((s) => (s.write ? [s.write] : []));
const known = [...written, ...Object.values(content).flatMap((versions) => Object.values(versions)), ...libraryPackages];
const resolve = (packageId: string, version: string) => known.find((p) => p.packageId === packageId && p.version === version);
const problems = steps
  .filter((s) => !s.retired)
  .flatMap((s) => validatePackage(s.write ?? content[s.name][s.version], resolve).map((p) => `${s.name} ${s.version}: ${p}`));
if (problems.length) {
  console.error(`The release has problems, so nothing was written:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const behind = steps.filter((s) => s.write || s.remove.length);
for (const s of steps) {
  const what = s.retired ? 'retired' : s.write ? (content[s.name]?.[s.version] ? 'rebuilt' : 'new') : 'stays on';
  console.log(`${s.name.padEnd(22)} ${what.padEnd(8)} ${s.version.padEnd(7)} ${s.reason}`);
}

const inRelease = steps.filter((s) => !s.retired);
const version = inRelease[0]?.version;
const draftNote = `\nRelease ${version} is a draft, so it can still change. Run pnpm content:publish when it's ready to share.`;
const isDraft = () => !hasRemote && inRelease.some((s) => !inRecord(s.name, s.version));

if (mode === 'check') {
  if (behind.length) {
    console.error(`\ncontent/ is behind source/ for ${behind.map((s) => s.name).join(', ')}. Run pnpm content:build.`);
    process.exit(1);
  }
  if (isDraft()) console.log(draftNote);
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
if (mode === 'publish') {
  const fresh = inRelease.filter((s) => !inRecord(s.name, s.version));
  for (const s of fresh) (record[s.name] ??= {})[s.version] = digest(packageFile(s.name, s.version));
  if (fresh.length) saveRecord();
  console.log(fresh.length ? `\nPublished release ${version}. It won't change from here; your next changes go in the release after it.` : `\nRelease ${version} is already published.`);
  console.log('Run pnpm verify to check everything and build the site.');
} else {
  if (behind.length) console.log('\nNow run pnpm verify to check everything and build the site.');
  if (isDraft()) console.log(draftNote);
}
