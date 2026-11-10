// Makes a fresh copy of the kit your own: your site's name and color, and one
// package of your own in place of the sample's, ready for your solutions and
// resources.
//
//   pnpm kit:init                      asks for what it needs
//   pnpm kit:init --org "Example Co" --url https://example.co --prefix exco \
//     [--name "Example Co Blueprints"] [--package offerings] [--color "#0b6e69"]
//
// It changes kit.yaml's site, replaces source/ with your package, removes the
// sample's built content/ and published.json, and takes the setup notice off
// the About page. It only runs on a copy that still has the sample, so it can't
// undo work of your own.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const SAMPLE = join('source', 'offerings');
if (!existsSync(join(SAMPLE, 'package.yaml')) || !readFileSync(join(SAMPLE, 'package.yaml'), 'utf8').includes('packageId: com.example.offerings')) {
  console.error('This copy is already yours: source/offerings isn’t the kit’s sample any more, so kit:init leaves it alone.');
  process.exit(1);
}

async function ask(): Promise<Record<'org' | 'url' | 'prefix' | 'name' | 'package' | 'color', string>> {
  const given = { org: flag('org'), url: flag('url'), prefix: flag('prefix'), name: flag('name'), package: flag('package'), color: flag('color') };
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const get = async (key: keyof typeof given, question: string, fallback?: string): Promise<string> => {
    if (given[key]) return given[key]!;
    if (!prompt) {
      if (fallback !== undefined) return fallback;
      console.error(`Give --${key}: ${question}`);
      process.exit(1);
    }
    const answer = (await prompt.question(`${question}${fallback ? ` (${fallback})` : ''} `)).trim();
    return answer || fallback || get(key, question, fallback);
  };
  const org = await get('org', 'Your organization’s name?');
  const url = await get('url', 'Its website, such as https://example.com?');
  const prefix = await get('prefix', 'A short word of your own for your items’ IDs, such as exco?', org.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || undefined);
  const name = await get('name', 'Your site’s name?', `${org} Blueprints`);
  const pkg = await get('package', 'Your package’s folder name?', 'offerings');
  const color = await get('color', 'Your site’s main color, as a hex color?', '#0b6e69');
  prompt?.close();
  return { org, url, prefix, name, package: pkg, color };
}

const answers = await ask();
const problems = [
  !/^https?:\/\/[^\s/]+/i.test(answers.url) && 'The website needs to be an address that starts with http:// or https://.',
  !/^[a-z][a-z0-9]{1,15}$/.test(answers.prefix) && 'The prefix is a short word of lowercase letters and digits, starting with a letter.',
  answers.prefix === 'eb' && 'The prefix "eb" is the library’s; choose one of your own.',
  !/^[a-z0-9][a-z0-9-]*$/.test(answers.package) && 'The package’s folder name is lowercase letters, digits, and hyphens.',
  !/^#[0-9a-fA-F]{6}$/.test(answers.color) && 'The color is a hex color, such as #0b6e69.',
].filter(Boolean);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// A package ID you own: your site's domain, reversed, then the package's name.
const host = new URL(answers.url).hostname.replace(/^www\./, '');
const packageId = `${host.split('.').reverse().join('.')}.${answers.package}`;
const yaml = (text: string) => JSON.stringify(text);

// kit.yaml: your site, keeping its comments and the library it builds on.
let kit = readFileSync('kit.yaml', 'utf8');
kit = kit
  .replace(/^(\s+title:).*$/m, `$1 ${yaml(answers.name)}`)
  .replace(/^(\s+description:).*$/m, `$1 ${yaml(`${answers.org}’s work for public-sector missions, mapped to the Enterprise Blueprints library.`)}`)
  .replace(/^(\s+accent:).*$/m, `$1 "${answers.color}"`);
writeFileSync('kit.yaml', kit);

// source/: your package in place of the sample's, and no sample mission.
rmSync(join('source', 'local-audit'), { recursive: true, force: true });
const mine = join('source', answers.package);
const shown = `source/${answers.package}`;
if (mine !== SAMPLE) renameSync(SAMPLE, mine);
const release = String(kit.match(/^\s+release:\s*(\S+)/m)?.[1] ?? '');
writeFileSync(
  join(mine, 'package.yaml'),
  `# Your package. Its version and date are set when it is built (pnpm content:build).

schemaVersion: 0.8.0
packageId: ${packageId}
# The first part of every element ID in your packages; "eb" is the library's.
idPrefix: ${answers.prefix}
title: ${yaml(`${answers.org} Offerings`)}
description: ${yaml(`${answers.org}’s products, services, and resources for public-sector missions, each linked to the library’s missions, capabilities, and patterns they help with.`)}
publisher:
  name: ${yaml(answers.org)}
  url: ${answers.url}
license: CC-BY-4.0
domain: public-sector
jurisdictions:
  - United States — federal agencies
# The library's packages this one points into, by their folder names under library/packages/.
# Add a mission's when your solutions implement its patterns, such as federal-oig.
dependencies: [ common ]
`,
);
const solutions = readFileSync(join(mine, 'solutions.yaml'), 'utf8');
writeFileSync(join(mine, 'solutions.yaml'), `${solutions.slice(0, solutions.search(/^- id:/m)).trimEnd()}\n\n[]\n`);
const resources = join(mine, 'resources.yaml');
if (existsSync(resources)) {
  const text = readFileSync(resources, 'utf8');
  const first = text.search(/^- id:/m);
  writeFileSync(resources, `${(first === -1 ? text : text.slice(0, first)).trimEnd()}\n\n[]\n`);
}

// The sample's built packages and its record of what's published.
rmSync('content', { recursive: true, force: true });
rmSync('published.json', { force: true });

// The About page's notice for whoever sets the site up.
const about = join('src', 'pages', 'about.astro');
if (existsSync(about)) {
  writeFileSync(
    about,
    readFileSync(about, 'utf8')
      .replace(/\n\s*<section class="notice make-it-yours"[\s\S]*?<\/section>\n/, '\n')
      .replace(/\n<style>\n\s*\.make-it-yours[\s\S]*?<\/style>\n/, '\n'),
  );
}

console.log(`${answers.name} is yours: ${shown}/ is your package, ${packageId}, with the prefix ${answers.prefix}${release ? `, on library release ${release}` : ''}.

Next:
  1. Add your first solution or resource, in the browser with pnpm editor, or in ${shown}/ (the README shows how).
  2. pnpm content:build
  3. pnpm verify`);
