// The editor's part of the dev server, which only `pnpm editor` loads, so
// nothing here reaches a built site. It answers the pages' requests under
// /__editor/, writes source/ through store.ts, and runs the content script,
// whose compiler and validator decide whether a change is good. Anything they
// refuse is put back as it was.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { parse } from 'yaml';
import { resourceKinds } from '../src/lib/vocabulary.ts';
import { deleteResource, EditError, packageList, readResources, readTargets, saveResource, type ResourceFields } from './store.ts';

const root = process.cwd();

/** What the editor uses from Astro's dev server. */
interface DevServer {
  middlewares: { use(path: string, handle: (req: IncomingMessage, res: ServerResponse) => void): void };
  environments: Record<string, { moduleGraph: { invalidateAll(): void } }>;
  ws: { send(...args: unknown[]): void };
}

/**
 * Whether to answer a request. The server listens only on this computer, but
 * any site open in its browser can still try to reach it, so writing takes a
 * request from these pages themselves. The host check stops a site pointing
 * its own name at this computer, and a JSON body can't be sent from a plain form.
 */
export function allowed(headers: IncomingHttpHeaders, method: string | undefined): boolean {
  const host = headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  if (method === 'GET') return true;
  return headers.origin === `http://${host}` && String(headers['content-type']).startsWith('application/json');
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: root, env, maxBuffer: 1 << 24 }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
  });
}

const content = (mode: string) => run(['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join('scripts', 'content.ts'), mode]);

/** The problems in the content script's output, one to a line. */
const problemsIn = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(Source problems:|The release has problems)/.test(line));

const libraryRelease = () => String((parse(readFileSync(join(root, 'kit.yaml'), 'utf8')) as { library: { release: string } }).library.release);

async function state() {
  const targets = readTargets(root, libraryRelease());
  const status = await content('status');
  return {
    ...(status.ok ? (JSON.parse(status.stdout) as { release: string; draft: boolean }) : { problems: problemsIn(status.stderr) }),
    today: new Date().toLocaleDateString('en-CA'),
    packages: packageList(root),
    kinds: Object.entries(resourceKinds.groups).map(([id, g]) => ({ id, label: g.label })),
    resources: readResources(root, targets),
    targets,
  };
}

/**
 * While the editor changes content/ itself, the dev server doesn't tell the
 * pages to reload, so a page doesn't reload halfway through a build or before
 * it hears how the save went. It reloads itself once it has. The dev server
 * still clears what it has cached, and hears about files a moment late, so
 * this lasts a little past the end of the work.
 */
let writingUntil = 0;
function holdReloads(server: DevServer) {
  const send = server.ws.send.bind(server.ws);
  server.ws.send = (...args) => {
    if (Date.now() < writingUntil && (args[0] as { type?: string } | undefined)?.type === 'full-reload') return;
    send(...args);
  };
}
const ownWrites = async <T>(work: () => Promise<T>): Promise<T> => {
  writingUntil = Infinity;
  try {
    return await work();
  } finally {
    writingUntil = Date.now() + 2000;
  }
};

/** Makes a change to source/, then builds, putting the change back if the build refuses it. */
async function change<T extends { undo: () => void }>(server: DevServer, make: () => T): Promise<Omit<T, 'undo'>> {
  return ownWrites(async () => {
    const { undo, ...result } = make();
    const built = await content('build');
    if (!built.ok) {
      undo();
      throw new EditError(problemsIn(built.stderr).join('\n'));
    }
    refresh(server);
    return result;
  });
}

/** The pages read content/ when they load, so the next page view reads it afresh. */
function refresh(server: DevServer) {
  for (const environment of Object.values(server.environments)) environment.moduleGraph.invalidateAll();
}

async function publish(server: DevServer) {
  const published = await ownWrites(() => content('publish'));
  if (!published.ok) throw new EditError(problemsIn(published.stderr).join('\n'));
  refresh(server);
  // The built site is the one to host, so it's built the way `pnpm build` does, without the editor.
  const { KIT_EDITOR: _editor, ...env } = process.env;
  const built = await run([join('node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], env);
  if (!built.ok) throw new EditError(`The release is published, but the site didn't build:\n${built.stderr || built.stdout}`);
  return { message: 'Published, and the site is built in dist/. Copy what’s in that folder to where you host it.' };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 1 << 20) reject(new EditError('That’s too much to save at once.'));
    });
    req.on('end', () => {
      try {
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new EditError('That didn’t arrive as it should.'));
      }
    });
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function routes(server: DevServer) {
  // One change at a time, since each reads and rewrites the same files.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowed(req.headers, req.method)) return reply(res, 403, { problems: ['This isn’t for other sites.'] });
    const path = req.url?.split('?')[0];
    try {
      if (req.method === 'GET' && path === '/state') return reply(res, 200, await state());
      if (req.method !== 'POST') return reply(res, 404, {});
      const body = await readBody(req);
      if (path === '/save') {
        const targets = readTargets(root, libraryRelease());
        return reply(res, 200, await inTurn(() => change(server, () => saveResource(root, body as unknown as ResourceFields & { package: string; id?: string }, targets))));
      }
      if (path === '/delete') return reply(res, 200, await inTurn(() => change(server, () => deleteResource(root, String(body.package), String(body.id)))));
      if (path === '/publish') return reply(res, 200, await inTurn(() => publish(server)));
      return reply(res, 404, {});
    } catch (e) {
      if (e instanceof EditError) return reply(res, 400, { problems: e.message.split('\n').filter(Boolean) });
      console.error(e);
      return reply(res, 500, { problems: [e instanceof Error ? e.message : String(e)] });
    }
  };
}

export default function editor(): AstroIntegration {
  return {
    name: 'kit-editor',
    hooks: {
      'astro:config:setup': ({ command, injectScript, updateConfig }) => {
        if (command !== 'dev') return;
        injectScript('page', `import ${JSON.stringify(fileURLToPath(new URL('./client.ts', import.meta.url)))};`);
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'kit-editor',
                configureServer(server: DevServer) {
                  holdReloads(server);
                  const handle = routes(server);
                  server.middlewares.use('/__editor', (req, res) => void handle(req, res));
                },
              },
            ],
          },
        });
      },
    },
  };
}
