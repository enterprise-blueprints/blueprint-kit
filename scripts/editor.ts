// Starts the site with the editor on, for you alone: it listens only on this
// computer, and what you change goes into source/. The built site never has it.
//
//   pnpm editor                 at http://127.0.0.1:4322
//   pnpm editor --port 5000     at another port

import { spawn } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const child = spawn(
  process.execPath,
  // The editor's server is TypeScript, which Node reads with this flag, the way it does the scripts here.
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join('node_modules', 'astro', 'bin', 'astro.mjs'), 'dev', '--host', '127.0.0.1', ...(args.includes('--port') ? [] : ['--port', '4322']), ...args],
  { stdio: 'inherit', env: { ...process.env, KIT_EDITOR: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
