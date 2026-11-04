// Starts the site with the editor on, for you alone: it listens only on this
// computer, and what you change goes into source/. The built site never has it.
//
//   pnpm editor                 at http://127.0.0.1:4322, or 4323 for the library, so both can run
//   pnpm editor --port 5000     at another port
//
// The site needs a package to show, so with none in source/ it starts one first,
// asking who you are here, since there's no page to ask on yet.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { addPackage, EditError, sourcePackages } from '../editor/store.ts';

const strip = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

async function startFirstPackage() {
  console.log("You don't have any packages in source/ yet, so let's start one.\n");
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const ask = async (question: string) => {
    process.stdout.write(`${question} `);
    return String((await lines.next()).value ?? '').trim();
  };
  try {
    addPackage(process.cwd(), {
      title: await ask('What will it hold, such as "Our Services" or a mission\'s name?'),
      description: await ask('Describe it in a sentence:'),
      publisher: await ask("Your organization's name:"),
      prefix: await ask('A short prefix for your IDs, in lowercase letters and numbers, such as acme:'),
    });
  } catch (e) {
    if (!(e instanceof EditError)) throw e;
    console.error(`\n${e.message}\nRun pnpm editor to try again.`);
    process.exit(1);
  }
  execFileSync(process.execPath, [...strip, join('scripts', 'content.ts'), 'build'], { stdio: 'inherit' });
}

if (!sourcePackages(process.cwd()).length) await startFirstPackage();

const args = process.argv.slice(2);
const child = spawn(
  process.execPath,
  // The editor's server is TypeScript, which Node reads with this flag, the way it does the scripts here.
  [...strip, join('node_modules', 'astro', 'bin', 'astro.mjs'), 'dev', '--host', '127.0.0.1', ...(args.includes('--port') ? [] : ['--port', existsSync('kit.yaml') ? '4322' : '4323']), ...args],
  { stdio: 'inherit', env: { ...process.env, SITE_EDITOR: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
