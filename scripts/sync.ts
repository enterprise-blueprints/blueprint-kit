// Brings the library into the kit.
//
//   pnpm sync                 the release kit.yaml names: its packages, which
//                             yours build on, its vocabulary, and every schema
//   pnpm sync --tools [from]  also the library's engine: the compiler, the
//                             validator, and the pages this site shares with
//                             the library's, as its engine.json lists them,
//                             from its repository at a Git ref (main by
//                             default) or from a local checkout's folder
//
// Each package is checked against the digest in the library's catalog. Earlier
// releases stay in library/, since your published versions build on them.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const kit = parse(readFileSync('kit.yaml', 'utf8')) as { library: { url: string; release: string } };
const base = kit.library.url.endsWith('/') ? kit.library.url : `${kit.library.url}/`;
const release = String(kit.library.release);

async function get(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}
function save(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const catalogUrl = new URL('catalog.json', base);
const catalog = JSON.parse(await get(catalogUrl.href)) as {
  release: string;
  vocabulary: string;
  schemas: string[];
  packages: { packageId: string; version: string; href: string; sha256: string }[];
};
const wanted = catalog.packages.filter((p) => p.version === release);
if (!wanted.length) {
  const releases = [...new Set(catalog.packages.map((p) => p.version))].join(', ');
  console.error(`The library has no release ${release}. It has ${releases}, and its current release is ${catalog.release}.`);
  process.exit(1);
}

for (const p of wanted) {
  // The catalog's href is packages/<name>/<version>/blueprint.json.
  const [, name] = p.href.split('/');
  const path = join('library', 'packages', name, p.version, 'blueprint.json');
  const text = await get(new URL(p.href, catalogUrl).href);
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  if (digest !== p.sha256) throw new Error(`${p.packageId} ${p.version} doesn't match the catalog's digest.`);
  if (existsSync(path) && readFileSync(path, 'utf8') !== text) throw new Error(`${path} differs from the published package, which never changes.`);
  save(path, text);
  console.log(`${name.padEnd(22)} ${p.version}`);
}
save(join('library', 'vocabulary.json'), await get(new URL(catalog.vocabulary, catalogUrl).href));
for (const href of catalog.schemas) save(join('schemas', href.split('/').at(-1)!), await get(new URL(href, catalogUrl).href));
console.log(`vocabulary and ${catalog.schemas.length} schemas`);

const tools = process.argv.indexOf('--tools');
if (tools !== -1) {
  const from = process.argv[tools + 1] ?? 'main';
  const read = (path: string) =>
    existsSync(from)
      ? Promise.resolve(readFileSync(join(from, path), 'utf8'))
      : get(`https://raw.githubusercontent.com/enterprise-blueprints/enterprise-blueprints.github.io/${from}/${path}`);
  const { files } = JSON.parse(await read('engine.json')) as { files: string[] };
  for (const file of files) save(file, await read(file));
  console.log(`${files.length} engine files from ${from}`);
}
console.log('\nNow run pnpm content:build, then pnpm verify.');
