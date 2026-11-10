// Saves a solution into one of your packages from a file another tool wrote,
// such as Solution Studio: the same way the editor saves one, with the same
// checks, then builds your next release. A change the build refuses is put back.
//
//   pnpm kit:save-solution <file.json> [--build]
//
// The file holds the solution as the editor's form does, with links by full ID:
//
//   { "package": "offerings", "id": "case-intake-on-power-pages", "title": "…",
//     "description": "…", "approach": "platform", "hostedBy": "vendor",
//     "url": "https://…", "by": "…", "implements": ["eb:implementationPattern:…"],
//     "dependsOn": ["eb:implementationPattern:agency-sign-on"],
//     "components": [{ "key": "intake", "title": "…", "tier": "front",
//       "technology": "…", "exposure": "public", "sendsTo": ["records"] }] }
//
// With an id that's already in the package, it changes that solution; without
// one, or with a new one, it adds it. --build also builds the site, so tools that
// read the built copy, such as Studio, see it. The last line it prints is
// RESULT followed by what was saved, as JSON.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { EditError, packageList, readElements, readTargets, saveElement, type ComponentFields, type ElementFields } from '../editor/store.ts';

interface Handoff {
  package?: string;
  id?: string;
  title: string;
  description: string;
  approach: string;
  hostedBy?: string;
  url?: string;
  by?: string;
  implements: string[];
  dependsOn?: string[];
  components?: ComponentFields[];
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const build = args.includes('--build');
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
if (!file) fail('Give the file to save from: pnpm kit:save-solution <file.json> [--build]');

const root = process.cwd();
const node = (...rest: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...rest], { cwd: root, encoding: 'utf8' });

let handoff: Handoff;
try {
  handoff = JSON.parse(readFileSync(file!, 'utf8')) as Handoff;
} catch {
  fail(`${file} isn’t a solution file this command can read.`);
}
if (!handoff!.title?.trim() || !handoff!.description?.trim() || !handoff!.approach) fail('A solution needs a title, a description, and an approach.');
if (!handoff!.implements?.length) fail('A solution needs at least one of the library’s patterns that it implements.');

const packages = packageList(root).map((p) => p.name);
const pkg = handoff!.package ?? packages[0];
if (!pkg || !packages.includes(pkg)) fail(`There’s no package called ${pkg} here. This copy has ${packages.join(', ') || 'none'}.`);

const release = String((parse(readFileSync('kit.yaml', 'utf8')) as { library: { release: string } }).library.release);
const targets = readTargets(root, release);
const existing = handoff!.id ? readElements(root, targets).find((e) => e.type === 'solution' && e.package === pkg && e.id === handoff!.id) : undefined;
const today = new Date().toLocaleDateString('en-CA');

const input: ElementFields & { id?: string } = {
  package: pkg,
  type: 'solution',
  // A changed one keeps its status; a new one is reference, as the library's are.
  status: existing?.status ?? 'reference',
  title: handoff!.title,
  description: handoff!.description,
  ...(existing ? { id: existing.id } : handoff!.id ? { chosenId: handoff!.id } : {}),
  values: {
    approach: handoff!.approach,
    ...(handoff!.hostedBy && { hostedBy: handoff!.hostedBy }),
    ...(handoff!.url && { url: handoff!.url, lastReviewedAt: today }),
    ...(handoff!.by && { by: handoff!.by }),
  },
  // What the editor's form keeps of its own, such as strengths, stays as it is.
  ...(existing?.pattern && { pattern: existing.pattern }),
  components: handoff!.components ?? [],
  links: {
    implements: handoff!.implements.map((to) => ({ to })),
    depends_on: (handoff!.dependsOn ?? []).map((to) => ({ to })),
  },
};

let saved: { id: string; undo: () => void };
try {
  saved = saveElement(root, input, targets);
} catch (error) {
  if (error instanceof EditError) fail(error.message);
  throw error;
}

const built = node(join('scripts', 'content.ts'), 'build');
if (built.status !== 0) {
  saved!.undo();
  fail(`The release didn’t build with it, so nothing was saved:\n${built.stderr || built.stdout}`);
}
console.log(built.stdout.trim());

if (build) {
  const { SITE_EDITOR: _editor, ...env } = process.env;
  const site = spawnSync(process.execPath, [join('node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], { cwd: root, encoding: 'utf8', env });
  if (site.status !== 0) fail(`It’s saved, and content/ is built, but the site didn’t build:\n${site.stderr || site.stdout}`);
  console.log('The site is built in dist/.');
}

const status = JSON.parse(node(join('scripts', 'content.ts'), 'status').stdout.trim() || '{}') as { release?: string; draft?: boolean };
const elementId = readElements(root, readTargets(root, release)).find((e) => e.type === 'solution' && e.package === pkg && e.id === saved!.id)?.elementId;
console.log(`RESULT ${JSON.stringify({ package: pkg, id: saved!.id, elementId, release: status.release, built: build, updated: Boolean(existing) })}`);
