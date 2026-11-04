import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { allowed } from '../editor/server';
import { deleteResource, EditError, newId, packageList, readResources, readTargets, saveResource, type ResourceFields, type Target } from '../editor/store';

const RELEASE = String(parse(readFileSync('kit.yaml', 'utf8')).library.release);

describe('the editor’s files', () => {
  let root: string;
  let targets: Target[];
  const resourcesText = () => readFileSync(join(root, 'source', 'offerings', 'resources.yaml'), 'utf8');
  const packageText = () => readFileSync(join(root, 'source', 'offerings', 'package.yaml'), 'utf8');
  const resource = (id: string) => readResources(root, targets).find((r) => r.id === id)!;
  const capability = () => targets.find((t) => t.id === 'eb:capability:records-management')!;
  const fields = (over: Partial<ResourceFields> = {}): ResourceFields & { package: string } => ({
    package: 'offerings',
    title: 'Records review',
    kind: 'service',
    url: 'https://example.com/records',
    lastReviewedAt: '2026-11-04',
    description: 'A short review of how an office keeps its records: what’s kept, and for how long.',
    links: [{ to: capability().id }],
    ...over,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kit-editor-'));
    for (const path of ['source', 'content', 'library']) cpSync(path, join(root, path), { recursive: true });
    targets = readTargets(root, RELEASE);
  });
  afterEach(() => rmSync(root, { recursive: true }));

  it('finds what a resource can help with, in your packages and the whole library', () => {
    expect(targets.map((t) => t.type)).not.toContain('resource');
    expect(new Set(targets.map((t) => t.folder))).toEqual(new Set(['local-audit', 'common', 'federal-acquisition', 'federal-contact-center', 'federal-foia', 'federal-grants', 'federal-hr-administration', 'federal-oig']));
    expect(targets.find((t) => t.ways.length)?.ways[0]).toEqual({ id: expect.any(String), title: expect.any(String) });
    expect(packageList(root).map((p) => p.name)).toEqual(['local-audit', 'offerings']);
  });

  it('reads the resources you have, with their links as full IDs', () => {
    const demo = resource('intake-to-referral-demo');
    expect(demo.elementId).toBe('example:resource:intake-to-referral-demo');
    expect(demo.links).toEqual([{ to: 'eb:implementationPattern:shared-case-platform', way: 'platform' }, { to: 'eb:capability:complaint-allegation-disclosure-intake' }]);
    expect(resource('oversight-intake-assessment').attributes).toEqual({ typicalLength: '2 weeks', deliverables: 'Current-state map, findings, and a phased plan' });
  });

  it('leaves everything else in the file as it was when it adds a resource', () => {
    const before = resourcesText();
    const { id } = saveResource(root, fields(), targets);
    expect(id).toBe('records-review');
    const after = resourcesText();
    expect(after.startsWith(before.trimEnd())).toBe(true);
    expect(after.slice(before.trimEnd().length)).toContain('\n\n- id: records-review\n');
    expect(after).toContain('what’s kept, and for how long.');
    expect(resource('records-review')).toMatchObject({ title: 'Records review', kind: 'service', links: [{ to: capability().id }] });
  });

  it('changes only what changed, keeping comments, details, and how links are written', () => {
    const before = resourcesText();
    const was = resource('intake-to-referral-demo');
    saveResource(root, { ...was, title: 'A new title' }, targets);
    const expected = before.replace('title: From intake to referral, on a shared case platform', 'title: A new title');
    expect(resourcesText()).toBe(expected);
  });

  it('writes nothing different when nothing changed', () => {
    const before = resourcesText();
    for (const r of readResources(root, targets).filter((x) => x.package === 'offerings')) saveResource(root, r, targets);
    expect(resourcesText()).toBe(before);
  });

  it('never changes an ID, and gives a new resource one of its own', () => {
    const was = resource('oversight-intake-assessment');
    expect(saveResource(root, { ...was, title: 'Something else' }, targets).id).toBe('oversight-intake-assessment');
    expect(saveResource(root, fields({ title: 'Something else' }), targets).id).toBe('something-else');
    expect(saveResource(root, fields({ title: 'Something else' }), targets).id).toBe('something-else-2');
    expect(newId('Café: the “best” guide!', [])).toBe('cafe-the-best-guide');
  });

  it('adds the package a new link needs, and undoes that with the rest', () => {
    const records = targets.find((t) => t.folder === 'federal-foia')!;
    const resourcesBefore = resourcesText();
    const packageBefore = packageText();
    expect(packageBefore).not.toContain('federal-foia');
    const { undo } = saveResource(root, fields({ links: [{ to: records.id }] }), targets);
    expect(parse(packageText()).dependencies).toContain('federal-foia');
    expect(packageText()).toContain('# The package itself.');
    undo();
    expect(resourcesText()).toBe(resourcesBefore);
    expect(packageText()).toBe(packageBefore);
  });

  it('keeps a link’s other fields when its way or note changes', () => {
    const was = resource('intake-to-referral-demo');
    saveResource(root, { ...was, links: [{ ...was.links[0], way: undefined, note: 'Start here' }, was.links[1]] }, targets);
    const raw = (parse(resourcesText()) as { id: string; helps_with: unknown[] }[]).find((r) => r.id === was.id)!;
    expect(raw.helps_with).toEqual([{ to: 'implementationPattern:shared-case-platform', note: 'Start here' }, 'capability:complaint-allegation-disclosure-intake']);
  });

  it('says what’s wrong with a form that isn’t finished, and writes nothing', () => {
    const before = resourcesText();
    const save = (over: Partial<ResourceFields>) => () => saveResource(root, fields(over), targets);
    expect(save({ title: ' ' })).toThrow('Give it a title.');
    expect(save({ kind: 'nonsense' })).toThrow('Choose what kind');
    expect(save({ url: 'not a link' })).toThrow('http://');
    expect(save({ links: [] })).toThrow('at least one');
    expect(save({ links: [{ to: 'eb:capability:nothing' }] })).toThrow("Can't find");
    expect(save({ links: [{ to: capability().id, way: 'nonsense' }] })).toThrow(EditError);
    expect(save({ attributes: { 'two words': 'x' } })).toThrow('no spaces');
    expect(resourcesText()).toBe(before);
    expect(() => saveResource(root, { ...fields(), package: '../outside' }, targets)).toThrow(EditError);
    expect(() => saveResource(root, { ...fields(), id: 'nothing-here' }, targets)).toThrow(EditError);
  });

  it('deletes a resource, keeping the file’s opening comment, and undoes that', () => {
    const before = resourcesText();
    const { undo } = deleteResource(root, 'offerings', 'oversight-intake-assessment');
    expect(resource('oversight-intake-assessment')).toBeUndefined();
    expect(resourcesText()).toContain('# Resources, in the order the pages show them');
    expect(resource('intake-to-referral-demo')).toBeDefined();
    undo();
    expect(resourcesText()).toBe(before);
    expect(() => deleteResource(root, 'offerings', 'nothing-here')).toThrow(EditError);
  });

  it('starts a resources.yaml for a package that has none', () => {
    const path = join(root, 'source', 'local-audit', 'resources.yaml');
    expect(existsSync(path)).toBe(false);
    saveResource(root, fields({ package: 'local-audit' } as Partial<ResourceFields>), targets);
    expect(parse(readFileSync(path, 'utf8'))[0].id).toBe('records-review');
  });
});

describe('who the editor answers', () => {
  const local = { host: '127.0.0.1:4322', origin: 'http://127.0.0.1:4322', 'content-type': 'application/json' };

  it('answers its own pages', () => {
    expect(allowed(local, 'POST')).toBe(true);
    expect(allowed({ host: 'localhost:4322' }, 'GET')).toBe(true);
  });

  it('refuses other sites, even from a browser on this computer', () => {
    expect(allowed({ ...local, origin: 'https://example.com' }, 'POST')).toBe(false);
    expect(allowed({ ...local, origin: undefined }, 'POST')).toBe(false);
    expect(allowed({ ...local, 'content-type': 'text/plain' }, 'POST')).toBe(false);
    expect(allowed({ ...local, host: 'evil.example:4322', origin: 'http://evil.example:4322' }, 'POST')).toBe(false);
    expect(allowed({ host: 'evil.example' }, 'GET')).toBe(false);
  });
});
