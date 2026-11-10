// Brings the library, and the kit's updates, into your copy.
//
//   pnpm sync                 the library release kit.yaml names: its packages,
//                             which yours build on, its vocabulary, and every schema
//   pnpm sync --latest        moves kit.yaml to the library's current release first
//   pnpm sync --tools         also brings the files your copy shares with the kit up
//                             to date: the library's engine (the pages and the code
//                             behind them) at the version the kit's main branch
//                             uses, and the kit's own files its kit.json lists,
//                             such as these scripts, the data pages, the workflows,
//                             and the tests. package.json takes the kit's scripts
//                             and versions and keeps what you added.
//   pnpm sync --tools <from>  the engine alone, from a library checkout's folder or
//                             a Git ref, for working on the kit or the engine
//   pnpm sync --from <where>  the library from somewhere other than its published
//                             site, for this run only: a library dev server, such as
//                             http://localhost:4321/, or a folder with a built copy.
//                             For trying a release before it's published; the next
//                             sync from the published site replaces what it took.
//
// Your own files are never touched: kit.yaml (but for the release and engine
// version it names), source/, content/, your home page, and src/kit/. Each
// package is checked against the digest in the library's catalog. Earlier
// releases stay in library/, since your published versions build on them.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

// Where the library's and the kit's files are, by Git ref. The variables are for trying out a change to this script.
const LIBRARY_REPO = process.env.LIBRARY_REPO_RAW ?? 'https://raw.githubusercontent.com/enterprise-blueprints/enterprise-blueprints.github.io';
const KIT_REPO = process.env.KIT_REPO_RAW ?? 'https://raw.githubusercontent.com/enterprise-blueprints/blueprint-kit';

const args = process.argv.slice(2);
const latest = args.includes('--latest');
const toolsAt = args.indexOf('--tools');
const tools = toolsAt !== -1;
const from = tools && args[toolsAt + 1] && !args[toolsAt + 1].startsWith('--') ? args[toolsAt + 1] : undefined;
const sourceAt = args.indexOf('--from');
const source = sourceAt === -1 ? undefined : args[sourceAt + 1];
if (sourceAt !== -1 && (!source || source.startsWith('--'))) {
  console.error('--from needs where to read the library: a dev server, such as http://localhost:4321/, or a folder with a built copy of it.');
  process.exit(1);
}

type Kit = { library: { url: string; release: string; engine?: string } };
const readKit = () => parse(readFileSync('kit.yaml', 'utf8')) as Kit;

async function get(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}
function save(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Sets a field under library: in kit.yaml, keeping its comments and everything else as it is. */
function setLibraryField(key: 'release' | 'engine', value: string, comment: string) {
  const text = readFileSync('kit.yaml', 'utf8');
  const line = new RegExp(`^(\\s+${key}:).*$`, 'm');
  const next = line.test(text) ? text.replace(line, `$1 ${value}`) : text.replace(/^(\s+release:.*)$/m, `$1\n${comment}\n  ${key}: ${value}`);
  if (next !== text) writeFileSync('kit.yaml', next);
}

const base = (url: string) => (url.endsWith('/') ? url : `${url}/`);
// Where the library's files are read from this time: its published site, or what --from names.
const root = source ?? readKit().library.url;
const isWeb = /^https?:\/\//i.test(root);
/** A file of the library's site, by its path there, such as catalog.json. */
async function read(relative: string): Promise<string> {
  if (isWeb) return get(new URL(relative, base(root)).href);
  const path = join(root, ...relative.split('/'));
  if (!existsSync(path)) throw new Error(`${path} isn't there. Is ${root} a built copy of the library, such as its dist folder?`);
  return readFileSync(path, 'utf8');
}

// What an earlier --from took, which the published site may replace.
const LOCAL = join('library', 'local.json');
const local = existsSync(LOCAL) ? (JSON.parse(readFileSync(LOCAL, 'utf8')) as { from: string; release: string; files: string[] }) : undefined;

const catalog = JSON.parse(await read('catalog.json')) as {
  release: string;
  vocabulary: string;
  schemas: string[];
  packages: { packageId: string; version: string; href: string; sha256: string }[];
};

if (latest && String(readKit().library.release) !== catalog.release) {
  console.log(`release ${readKit().library.release} → ${catalog.release}`);
  setLibraryField('release', catalog.release, '');
}
const release = String(readKit().library.release);

const wanted = catalog.packages.filter((p) => p.version === release);
if (!wanted.length) {
  const releases = [...new Set(catalog.packages.map((p) => p.version))].join(', ');
  console.error(`The library has no release ${release}. It has ${releases}, and its current release is ${catalog.release}.`);
  process.exit(1);
}

const taken: string[] = [];
for (const p of wanted) {
  // The catalog's href is packages/<name>/<version>/blueprint.json.
  const [, name] = p.href.split('/');
  const path = join('library', 'packages', name, p.version, 'blueprint.json');
  const record = `library/packages/${name}/${p.version}/blueprint.json`;
  const text = await read(p.href);
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  if (digest !== p.sha256) throw new Error(`${p.packageId} ${p.version} doesn't match the catalog's digest.`);
  const changed = existsSync(path) && readFileSync(path, 'utf8') !== text;
  // A package taken with --from wasn't published yet, so it may change; a published one never does.
  if (changed && !local?.files.includes(record)) throw new Error(`${path} differs from the published package, which never changes.`);
  save(path, text);
  taken.push(record);
  console.log(`${name.padEnd(22)} ${p.version}${changed ? `, replacing what was taken from ${local!.from}` : ''}`);
}
save(join('library', 'vocabulary.json'), await read(catalog.vocabulary));
for (const href of catalog.schemas) save(join('schemas', href.split('/').at(-1)!), await read(href));
console.log(`vocabulary and ${catalog.schemas.length} schemas`);

if (source) {
  save(LOCAL, `${JSON.stringify({ from: source, release, files: taken }, null, 2)}\n`);
  console.log(
    `\nTaken from ${source}, not from ${readKit().library.url}. If release ${release} isn't published there yet, ` +
      `your packages build on a release others can't get yet. Run pnpm sync once it is, which replaces these files.`,
  );
} else if (local && local.release === release) {
  rmSync(LOCAL);
  console.log(`release ${release} now comes from the published library, in place of what was taken from ${local.from}`);
}

let installNeeded = false;
if (tools) {
  // The engine: from a folder or ref when one is named, or else at the version the kit's main branch uses.
  const kitMain = from ? undefined : (parse(await get(`${KIT_REPO}/main/kit.yaml`)) as Kit);
  const ref = from ?? `engine-v${kitMain!.library.engine}`;
  const read = (path: string) => (existsSync(ref) ? Promise.resolve(readFileSync(join(ref, path), 'utf8')) : get(`${LIBRARY_REPO}/${ref}/${path}`));
  const engine = JSON.parse(await read('engine.json')) as { version: string; files: string[] };
  for (const file of engine.files) save(file, await read(file));
  console.log(`engine ${engine.version}: ${engine.files.length} files from ${ref}`);
  setLibraryField('engine', engine.version, '  # The version of the library\'s engine, its pages and the code behind them. pnpm sync --tools sets it.');

  // The kit's own shared files, from its main branch, unless this is the kit itself or the engine came from elsewhere.
  if (!from && !isTheKit()) {
    const shared = JSON.parse(await get(`${KIT_REPO}/main/kit.json`)) as { files: string[]; merged: string[] };
    for (const file of shared.files) save(file, await get(`${KIT_REPO}/main/${file}`));
    console.log(`${shared.files.length} of the kit's files from its main branch`);
    if (shared.merged.includes('package.json')) installNeeded = mergePackageJson(JSON.parse(await get(`${KIT_REPO}/main/package.json`)));
  }
}
console.log(`\nNow run ${installNeeded ? 'pnpm install, then ' : ''}pnpm content:build, then pnpm verify.`);

/** Whether this is the kit's own repository, where its shared files are made rather than brought in. */
function isTheKit(): boolean {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).includes('enterprise-blueprints/blueprint-kit');
  } catch {
    return false;
  }
}

/** Takes the kit's scripts, dependencies, and settings into package.json, keeping your name and anything you added. Returns whether it changed. */
function mergePackageJson(kit: Record<string, any>): boolean {
  const text = readFileSync('package.json', 'utf8');
  const mine = JSON.parse(text) as Record<string, any>;
  const merged = {
    ...mine,
    packageManager: kit.packageManager ?? mine.packageManager,
    engines: kit.engines ?? mine.engines,
    scripts: { ...mine.scripts, ...kit.scripts },
    pnpm: kit.pnpm ?? mine.pnpm,
    dependencies: { ...mine.dependencies, ...kit.dependencies },
    devDependencies: { ...mine.devDependencies, ...kit.devDependencies },
  };
  const next = `${JSON.stringify(merged, null, 2)}\n`;
  if (next === text) return false;
  writeFileSync('package.json', next);
  console.log('package.json takes the kit\'s scripts and versions');
  return true;
}
