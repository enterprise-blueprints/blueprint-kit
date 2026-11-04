import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { allowed } from '../editor/server';
import { deleteResource, EditError, newId, packageList, readResources, readTargets, saveResource, type ResourceFields, type Target } from '../editor/store';

// Every copy of the kit runs these, whatever it has made of the sample, so they
// work on files of their own rather than on source/.
const RELEASE = '1.0.0';

const RESOURCES = `# Resources, in the order the pages show them.
#
# A comment that should stay.

- id: intake-assessment
  title: Intake assessment
  kind: service
  url: https://example.com/services/intake
  lastReviewedAt: 2026-10-30
  description: Two weeks with an office mapping how complaints come in, where they wait, and how they’re tracked, ending in a short plan that fits the office and a list of what to do first.
  attributes:
    typicalLength: 2 weeks
    deliverables: A map, and a plan
  helps_with:
    - capability:records-management
    - implementationPattern:case-platform

- id: intake-demo
  title: From intake to referral
  kind: demo
  url: https://example.com/demos/intake
  lastReviewedAt: 2026-10-30
  description: A short recorded walkthrough.
  helps_with:
    - to: implementationPattern:case-platform
      way: platform
    - capability:records-management

- id: risk-scorecard
  title: Risk scorecard
  kind: template
  url: https://example.com/templates/risk
  lastReviewedAt: 2026-10-30
  description: A spreadsheet.
  helps_with: [ capability:records-management ]
`;

const PACKAGE = `# The package itself.

packageId: com.example.offerings
idPrefix: example
title: Offerings
# The packages this one points into.
dependencies: [ common ]
`;

const library = (title: string, elements: unknown[]) => JSON.stringify({ packageId: `org.test.${title}`, title, elements });

const FILES: Record<string, string> = {
  'source/offerings/package.yaml': PACKAGE,
  'source/offerings/resources.yaml': RESOURCES,
  'source/audit/package.yaml': 'packageId: com.example.audit\nidPrefix: example\ntitle: Audit\n',
  'content/audit/0.1.0/blueprint.json': library('Audit', [{ id: 'example:capability:audit-planning', type: 'capability', title: 'Audit planning' }]),
  [`library/packages/common/${RELEASE}/blueprint.json`]: library('Common', [
    { id: 'eb:capability:records-management', type: 'capability', title: 'Records management' },
    { id: 'eb:implementationPattern:case-platform', type: 'implementationPattern', title: 'Case platform', attributes: { ways: [{ id: 'platform', title: 'A platform', approach: 'extend' }] } },
    { id: 'eb:resource:a-guide', type: 'resource', title: 'A guide' },
    { id: 'eb:capability:old', type: 'capability', title: 'Old', status: 'deprecated' },
  ]),
  [`library/packages/foia/${RELEASE}/blueprint.json`]: library('FOIA', [{ id: 'eb:capability:request-intake', type: 'capability', title: 'Request intake' }]),
};

describe('the editor’s files', () => {
  let root: string;
  let targets: Target[];
  const resourcesText = () => readFileSync(join(root, 'source', 'offerings', 'resources.yaml'), 'utf8');
  const packageText = () => readFileSync(join(root, 'source', 'offerings', 'package.yaml'), 'utf8');
  const resource = (id: string) => readResources(root, targets).find((r) => r.id === id)!;
  const fields = (over: Partial<ResourceFields & { package: string }> = {}): ResourceFields & { package: string } => ({
    package: 'offerings',
    title: 'Records review',
    kind: 'service',
    url: 'https://example.com/records',
    lastReviewedAt: '2026-11-04',
    description: 'A short review of how an office keeps its records: what’s kept, and for how long.',
    links: [{ to: 'eb:capability:records-management' }],
    ...over,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kit-editor-'));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    targets = readTargets(root, RELEASE);
  });
  afterEach(() => rmSync(root, { recursive: true }));

  it('finds what a resource can help with, in your packages and the library’s', () => {
    expect(targets.map((t) => t.id).sort()).toEqual(['eb:capability:records-management', 'eb:capability:request-intake', 'eb:implementationPattern:case-platform', 'example:capability:audit-planning']);
    expect(targets.find((t) => t.ways.length)?.ways).toEqual([{ id: 'platform', title: 'A platform' }]);
    expect(packageList(root)).toEqual([{ name: 'audit', title: 'Audit' }, { name: 'offerings', title: 'Offerings' }]);
  });

  it('reads the resources you have, with their links as full IDs', () => {
    const demo = resource('intake-demo');
    expect(demo.elementId).toBe('example:resource:intake-demo');
    expect(demo.links).toEqual([{ to: 'eb:implementationPattern:case-platform', way: 'platform' }, { to: 'eb:capability:records-management' }]);
    expect(resource('intake-assessment').attributes).toEqual({ typicalLength: '2 weeks', deliverables: 'A map, and a plan' });
  });

  it('leaves everything else in the file as it was when it adds a resource', () => {
    const { id } = saveResource(root, fields(), targets);
    expect(id).toBe('records-review');
    const after = resourcesText();
    expect(after.startsWith(RESOURCES.trimEnd())).toBe(true);
    expect(after.slice(RESOURCES.trimEnd().length)).toContain('\n\n- id: records-review\n');
    expect(after).toContain('what’s kept, and for how long.');
    expect(resource('records-review')).toMatchObject({ title: 'Records review', kind: 'service', links: [{ to: 'eb:capability:records-management' }] });
  });

  it('changes only what changed, keeping comments, details, and how links are written', () => {
    saveResource(root, { ...resource('intake-demo'), title: 'A new title' }, targets);
    expect(resourcesText()).toBe(RESOURCES.replace('title: From intake to referral', 'title: A new title'));
  });

  it('writes nothing different when nothing changed', () => {
    for (const r of readResources(root, targets)) saveResource(root, r, targets);
    expect(resourcesText()).toBe(RESOURCES);
  });

  it('never changes an ID, and gives a new resource one of its own', () => {
    expect(saveResource(root, { ...resource('intake-assessment'), title: 'Something else' }, targets).id).toBe('intake-assessment');
    expect(saveResource(root, fields({ title: 'Something else' }), targets).id).toBe('something-else');
    expect(saveResource(root, fields({ title: 'Something else' }), targets).id).toBe('something-else-2');
    expect(newId('Café: the “best” guide!', [])).toBe('cafe-the-best-guide');
  });

  it('adds the package a new link needs, and undoes that with the rest', () => {
    const { undo } = saveResource(root, fields({ links: [{ to: 'eb:capability:request-intake' }] }), targets);
    expect(parse(packageText()).dependencies).toEqual(['common', 'foia']);
    expect(packageText()).toContain('# The packages this one points into.');
    undo();
    expect(resourcesText()).toBe(RESOURCES);
    expect(packageText()).toBe(PACKAGE);
  });

  it('keeps a link’s other fields when its way or note changes', () => {
    const was = resource('intake-demo');
    saveResource(root, { ...was, links: [{ ...was.links[0], way: undefined, note: 'Start here' }, was.links[1]] }, targets);
    const raw = (parse(resourcesText()) as { id: string; helps_with: unknown[] }[]).find((r) => r.id === was.id)!;
    expect(raw.helps_with).toEqual([{ to: 'implementationPattern:case-platform', note: 'Start here' }, 'capability:records-management']);
  });

  it('says what’s wrong with a form that isn’t finished, and writes nothing', () => {
    const save = (over: Partial<ResourceFields>) => () => saveResource(root, fields(over), targets);
    expect(save({ title: ' ' })).toThrow('Give it a title.');
    expect(save({ kind: 'nonsense' })).toThrow('Choose what kind');
    expect(save({ url: 'not a link' })).toThrow('http://');
    expect(save({ links: [] })).toThrow('at least one');
    expect(save({ links: [{ to: 'eb:capability:nothing' }] })).toThrow("Can't find");
    expect(save({ links: [{ to: 'eb:capability:records-management', way: 'nonsense' }] })).toThrow(EditError);
    expect(save({ attributes: { 'two words': 'x' } })).toThrow('no spaces');
    expect(resourcesText()).toBe(RESOURCES);
    expect(() => saveResource(root, fields({ package: '../outside' }), targets)).toThrow(EditError);
    expect(() => saveResource(root, { ...fields(), id: 'nothing-here' }, targets)).toThrow(EditError);
  });

  it('deletes a resource, keeping the file’s opening comment, and undoes that', () => {
    const { undo } = deleteResource(root, 'offerings', 'intake-assessment');
    expect(resource('intake-assessment')).toBeUndefined();
    expect(resourcesText()).toContain('# A comment that should stay.');
    expect(resource('intake-demo')).toBeDefined();
    undo();
    expect(resourcesText()).toBe(RESOURCES);
    expect(() => deleteResource(root, 'offerings', 'nothing-here')).toThrow(EditError);
  });

  it('starts a resources.yaml for a package that has none, and takes it away again', () => {
    const path = join(root, 'source', 'audit', 'resources.yaml');
    expect(existsSync(path)).toBe(false);
    const { undo } = saveResource(root, fields({ package: 'audit' }), targets);
    expect(parse(readFileSync(path, 'utf8'))[0].id).toBe('records-review');
    undo();
    expect(existsSync(path)).toBe(false);
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
