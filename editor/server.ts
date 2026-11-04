// The editor's part of the dev server, which only `pnpm editor` loads, so
// nothing here reaches a built site. It answers the pages' requests under
// /__editor/, writes source/ through store.ts, and runs the content script,
// whose compiler and validator decide whether a change is good. Anything they
// refuse is put back as it was.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { parse } from 'yaml';
import { elementTypes, groupings, patternApproaches, patternFields, patternLayers, sourceKinds, statuses } from '../src/lib/vocabulary.ts';
import {
  addPackage, capabilitiesProviding, deleteElement, deleteQuestion, deleteSet, deleteSource, EditError, forms, packageList, questionKinds, readDiscovery, readElements, readSources, readTargets,
  saveElement, saveQuestion, saveSet, saveSource, type ElementFields, type PackageFields, type QuestionFields, type SetFields, type SourceFields, type Target,
} from './store.ts';

const root = process.cwd();

/** Whether this is a publisher's site, on a release of the library, rather than the library itself. */
const publisher = existsSync(join(root, 'kit.yaml'));

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

/**
 * A pattern can need another, which a mission has to have too. What you can add
 * to a mission is a capability, so a problem naming a missing pattern says
 * which capabilities would bring it in.
 */
function whatWouldFix(line: string, targets: Target[]) {
  const missing = line.match(/needs ([a-z0-9-]+:implementationPattern:[a-z0-9-]+), but none of the mission's capabilities points to it/)?.[1];
  if (!missing) return line;
  const titles = capabilitiesProviding(root, libraryRelease(), missing, targets).slice(0, 3).map((c) => `“${c.title}”`);
  return titles.length ? `${line}. Add ${new Intl.ListFormat('en', { type: 'disjunction' }).format(titles)} to the mission's capabilities, which brings it in.` : `${line}. Add it to one of the mission's capabilities.`;
}

/** The problems in the content script's output, one to a line, in words, with the items they name by their titles. */
const problemsIn = (text: string, targets: Target[] = []) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(Source problems:|The release has problems)/.test(line))
    .map((line) => whatWouldFix(line.replace(/^[a-z0-9-]+ \d+\.\d+\.\d+: /, '').replace(/^mission /, 'Mission '), targets))
    .map((line) => line.replace(/[a-z0-9-]+:[A-Za-z]+:[a-z0-9-]+/g, (id) => {
      const target = targets.find((t) => t.id === id);
      return target ? `“${target.title}”` : id;
    }));

const libraryRelease = () => (publisher ? String((parse(readFileSync(join(root, 'kit.yaml'), 'utf8')) as { library: { release: string } }).library.release) : '');

async function state() {
  const targets = readTargets(root, libraryRelease());
  const status = await content('status');
  return {
    ...(status.ok ? (JSON.parse(status.stdout) as { release: string; draft: boolean }) : { problems: problemsIn(status.stderr) }),
    publisher,
    today: new Date().toLocaleDateString('en-CA'),
    packages: packageList(root),
    groups: {
      ...Object.fromEntries(Object.keys(forms).filter((t) => groupings[t]).map((t) => [t, Object.entries(groupings[t].groups).map(([id, g]) => ({ id, label: g.label, hint: g.hint }))])),
      // The library's own resources are free ones; services and products belong in other organizations' packages.
      resource: Object.entries(groupings.resource.groups).filter(([id]) => publisher || !['service', 'product'].includes(id)).map(([id, g]) => ({ id, label: g.label, hint: g.hint })),
      layer: Object.entries(patternLayers).map(([id, l]) => ({ id, label: l.label, hint: l.hint })),
      approach: Object.entries(patternApproaches).map(([id, label]) => ({ id, label })),
      source: Object.entries(sourceKinds).map(([id, label]) => ({ id, label })),
      question: Object.entries(questionKinds).map(([id, label]) => ({ id, label })),
    },
    patternFields: Object.entries(patternFields).map(([id, f]) => ({ id, label: f.label, hint: f.definition })),
    statuses: Object.entries(statuses).map(([id, label]) => ({ id, label })),
    sections: Object.fromEntries(Object.keys(forms).map((t) => [t, elementTypes[t].section])),
    elements: readElements(root, targets),
    sources: readSources(root),
    discovery: readDiscovery(root, targets),
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
async function change<T extends { undo: () => void }>(server: DevServer, make: (targets: Target[]) => T): Promise<Omit<T, 'undo'>> {
  return ownWrites(async () => {
    const targets = readTargets(root, libraryRelease());
    const { undo, ...result } = make(targets);
    const built = await content('build');
    if (!built.ok) {
      undo();
      throw new EditError(problemsIn(built.stderr, targets).join('\n'));
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
  const { SITE_EDITOR: _editor, ...env } = process.env;
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
      const changes: Record<string, (targets: Target[]) => { undo: () => void }> = {
        '/save': (targets) => saveElement(root, body as unknown as ElementFields & { id?: string }, targets),
        '/delete': (targets) => deleteElement(root, String(body.package), String(body.type), String(body.id), targets),
        '/source': () => saveSource(root, body as unknown as SourceFields),
        '/delete-source': () => deleteSource(root, String(body.package), String(body.id)),
        '/question': (targets) => saveQuestion(root, body as unknown as QuestionFields, targets),
        '/delete-question': () => deleteQuestion(root, String(body.package), String(body.set), String(body.id)),
        '/set': () => saveSet(root, body as unknown as SetFields),
        '/delete-set': () => deleteSet(root, String(body.package), String(body.id)),
        '/package': () => addPackage(root, body as unknown as PackageFields),
      };
      const make = changes[path ?? ''];
      if (make) return reply(res, 200, await inTurn(() => change(server, make)));
      // The library publishes by pushing to main, so only a publisher's site does it here.
      if (path === '/publish' && publisher) return reply(res, 200, await inTurn(() => publish(server)));
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
    name: 'site-editor',
    hooks: {
      'astro:config:setup': ({ command, injectScript, updateConfig }) => {
        if (command !== 'dev') return;
        injectScript('page', `import ${JSON.stringify(fileURLToPath(new URL('./client.ts', import.meta.url)))};`);
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'site-editor',
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
