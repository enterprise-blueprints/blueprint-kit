import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { allowed } from '../editor/server';
import { capabilitiesProviding, deleteElement, EditError, newId, packageList, readElements, readTargets, saveElement, type ElementFields, type Target } from '../editor/store';

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

const MISSIONS = `# Missions, in the order the pages show them.

- id: local-audit
  title: Local Audit
  status: draft
  description: An audit office plans and performs audits.
  attributes:
    scope: US-local
    tagline: Audits of the public’s money
    principles:
      - Every audit starts from risk
  seeks: [ on-plan, findings-closed ]
`;

const OUTCOMES = `# Outcomes, each with its measures.

- id: on-plan
  title: The audit plan is carried out
  theme: timely
  status: draft
  description: Audits are done when planned.
  measures:
    - id: plan-completed
      title: Share of the plan completed
      description: Audits reported this year.
      sources: [ audit-standards ]

- id: findings-closed
  title: Findings are closed
  theme: accountable
  status: draft
  description: Departments act on what the office finds.
`;

const CAPABILITIES = `# Capabilities, each with the links it holds.

- id: audit-planning
  title: Audit Planning
  stage: plan-prepare
  status: draft
  description: Ability to plan the year’s audits.
  sources: [ audit-standards ]
  contributes_to: [ on-plan ]
  satisfies: [ publish-the-plan ]
  candidate_pattern:
    - to: case-platform
      coverage: partial
      note: Holds the plan once it’s approved.
`;

const LINKS = `# Links from the library's elements.

- from: capability:records-management
  contributes_to: [ findings-closed ]
`;

const AUDIT = `packageId: com.example.audit
idPrefix: example
title: Audit
dependencies: [ common ]
`;

const library = (title: string, elements: unknown[], relations: unknown[] = []) => JSON.stringify({ packageId: `org.test.${title}`, title, elements, relations });

const FILES: Record<string, string> = {
  'source/offerings/package.yaml': PACKAGE,
  'source/offerings/resources.yaml': RESOURCES,
  'source/audit/package.yaml': AUDIT,
  'source/audit/missions.yaml': MISSIONS,
  'source/audit/outcomes.yaml': OUTCOMES,
  'source/audit/capabilities.yaml': CAPABILITIES,
  'source/audit/links.yaml': LINKS,
  'content/audit/0.1.0/blueprint.json': library('Audit', [
    { id: 'example:mission:local-audit', type: 'mission', title: 'Local Audit' },
    { id: 'example:outcome:on-plan', type: 'outcome', title: 'The audit plan is carried out' },
    { id: 'example:outcome:findings-closed', type: 'outcome', title: 'Findings are closed' },
    { id: 'example:capability:audit-planning', type: 'capability', title: 'Audit Planning' },
    { id: 'example:requirement:publish-the-plan', type: 'requirement', title: 'Publish the plan' },
  ]),
  [`library/packages/common/${RELEASE}/blueprint.json`]: library('Common', [
    { id: 'eb:capability:records-management', type: 'capability', title: 'Records management' },
    { id: 'eb:capability:identity', type: 'capability', title: 'Identity' },
    { id: 'eb:implementationPattern:case-platform', type: 'implementationPattern', title: 'Case platform', attributes: { ways: [{ id: 'platform', title: 'A platform', approach: 'extend' }] } },
    { id: 'eb:resource:a-guide', type: 'resource', title: 'A guide' },
    { id: 'eb:capability:old', type: 'capability', title: 'Old', status: 'deprecated' },
  ], [
    { from: 'eb:capability:identity', predicate: 'candidate_pattern', to: 'eb:implementationPattern:case-platform' },
    { from: 'eb:capability:identity', predicate: 'contributes_to', to: 'eb:implementationPattern:other' },
  ]),
  [`library/packages/foia/${RELEASE}/blueprint.json`]: library('FOIA', [{ id: 'eb:capability:request-intake', type: 'capability', title: 'Request intake' }]),
};

describe('the editor’s files', () => {
  let root: string;
  let targets: Target[];
  const text = (file: string) => readFileSync(join(root, 'source', file), 'utf8');
  const list = (file: string) => parse(text(file)) as Record<string, unknown>[];
  const element = (type: string, id: string) => readElements(root, targets).find((e) => e.type === type && e.id === id)!;
  const resource = (over: Partial<ElementFields> = {}): ElementFields => ({
    package: 'offerings',
    type: 'resource',
    title: 'Records review',
    description: 'A short review of how an office keeps its records: what’s kept, and for how long.',
    values: { kind: 'service', url: 'https://example.com/records', lastReviewedAt: '2026-11-04' },
    links: { helps_with: [{ to: 'eb:capability:records-management' }] },
    ...over,
  });
  const outcome = (over: Partial<ElementFields> = {}): ElementFields => ({ package: 'audit', type: 'outcome', title: 'Reports are read', description: 'People read what the office publishes.', status: 'draft', values: { theme: 'transparent' }, ...over });
  const capability = (over: Partial<ElementFields> = {}): ElementFields => ({
    package: 'audit',
    type: 'capability',
    title: 'Report Publishing',
    description: 'Ability to publish audit reports.',
    status: 'draft',
    values: { stage: 'report-close' },
    links: { contributes_to: [{ to: 'example:outcome:on-plan' }] },
    ...over,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kit-editor-'));
    for (const [path, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    targets = readTargets(root, RELEASE);
  });
  afterEach(() => rmSync(root, { recursive: true }));

  it('finds what can be linked to, in your packages and the library’s', () => {
    expect(targets.map((t) => t.id)).not.toContain('eb:resource:a-guide');
    expect(targets.map((t) => t.id)).not.toContain('eb:capability:old');
    expect(targets.find((t) => t.id === 'example:outcome:on-plan')).toMatchObject({ own: true, folder: 'audit' });
    expect(targets.find((t) => t.ways.length)).toMatchObject({ own: false, ways: [{ id: 'platform', title: 'A platform' }] });
    expect(packageList(root)).toEqual([{ name: 'audit', title: 'Audit' }, { name: 'offerings', title: 'Offerings' }]);
  });

  describe('reading', () => {
    it('reads resources, with their links as full IDs', () => {
      const demo = element('resource', 'intake-demo');
      expect(demo.elementId).toBe('example:resource:intake-demo');
      expect(demo.links!.helps_with).toEqual([{ to: 'eb:implementationPattern:case-platform', way: 'platform' }, { to: 'eb:capability:records-management' }]);
      expect(element('resource', 'intake-assessment').details).toEqual({ typicalLength: '2 weeks', deliverables: 'A map, and a plan' });
    });

    it('reads a mission’s tagline, principles, and outcomes', () => {
      expect(element('mission', 'local-audit')).toMatchObject({ status: 'draft', tagline: 'Audits of the public’s money', principles: ['Every audit starts from risk'], links: { seeks: [{ to: 'example:outcome:on-plan' }, { to: 'example:outcome:findings-closed' }] } });
    });

    it('reads what links to an outcome, from its own package and from links.yaml', () => {
      expect(element('outcome', 'on-plan').incoming).toEqual({ seeks: ['example:mission:local-audit'], contributes_to: ['example:capability:audit-planning'] });
      expect(element('outcome', 'findings-closed').incoming!.contributes_to).toEqual(['eb:capability:records-management']);
      expect(element('outcome', 'on-plan').measures).toEqual([{ id: 'plan-completed', title: 'Share of the plan completed', description: 'Audits reported this year.' }]);
    });

    it('reads a capability’s links with what they say', () => {
      expect(element('capability', 'audit-planning')).toMatchObject({ values: { stage: 'plan-prepare' }, links: { candidate_pattern: [{ to: 'eb:implementationPattern:case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }], satisfies: [{ to: 'example:requirement:publish-the-plan' }] } });
    });
  });

  it('writes nothing different when nothing changed, for every type', () => {
    const files = ['offerings/resources.yaml', 'offerings/package.yaml', 'audit/missions.yaml', 'audit/outcomes.yaml', 'audit/capabilities.yaml', 'audit/links.yaml', 'audit/package.yaml'];
    const before = files.map(text);
    for (const e of readElements(root, targets)) saveElement(root, e, targets);
    expect(files.map(text)).toEqual(before);
  });

  describe('resources', () => {
    it('leaves everything else in the file as it was when it adds one', () => {
      expect(saveElement(root, resource(), targets).id).toBe('records-review');
      const after = text('offerings/resources.yaml');
      expect(after.startsWith(RESOURCES.trimEnd())).toBe(true);
      expect(after.slice(RESOURCES.trimEnd().length)).toContain('\n\n- id: records-review\n');
      expect(after).toContain('what’s kept, and for how long.');
    });

    it('changes only what changed, keeping comments, details, and how links are written', () => {
      saveElement(root, { ...element('resource', 'intake-demo'), title: 'A new title' }, targets);
      expect(text('offerings/resources.yaml')).toBe(RESOURCES.replace('title: From intake to referral', 'title: A new title'));
    });

    it('keeps a link’s other fields when its way or note changes', () => {
      const was = element('resource', 'intake-demo');
      const [first, second] = was.links!.helps_with;
      saveElement(root, { ...was, links: { helps_with: [{ ...first, way: undefined, note: 'Start here' }, second] } }, targets);
      expect(list('offerings/resources.yaml').find((r) => r.id === was.id)!.helps_with).toEqual([{ to: 'implementationPattern:case-platform', note: 'Start here' }, 'capability:records-management']);
    });

    it('adds the package a new link needs, and undoes that with the rest', () => {
      const { undo } = saveElement(root, resource({ links: { helps_with: [{ to: 'eb:capability:request-intake' }] } }), targets);
      expect(parse(text('offerings/package.yaml')).dependencies).toEqual(['common', 'foia']);
      expect(text('offerings/package.yaml')).toContain('# The packages this one points into.');
      undo();
      expect(text('offerings/resources.yaml')).toBe(RESOURCES);
      expect(text('offerings/package.yaml')).toBe(PACKAGE);
    });

    it('starts a file for a package that has none, and takes it away again', () => {
      const path = join(root, 'source', 'audit', 'resources.yaml');
      expect(existsSync(path)).toBe(false);
      const { undo } = saveElement(root, resource({ package: 'audit' }), targets);
      expect(parse(readFileSync(path, 'utf8'))[0].id).toBe('records-review');
      undo();
      expect(existsSync(path)).toBe(false);
    });
  });

  describe('missions', () => {
    it('adds a mission with its tagline and principles', () => {
      const { id } = saveElement(root, { package: 'audit', type: 'mission', title: 'Performance Audit', description: 'Audits of how well programs work.', status: 'draft', tagline: 'Do programs work?', principles: ['Start from what the public gets', ' '] }, targets);
      expect(id).toBe('performance-audit');
      expect(list('audit/missions.yaml')[1]).toEqual({ id, title: 'Performance Audit', status: 'draft', description: 'Audits of how well programs work.', attributes: { tagline: 'Do programs work?', principles: ['Start from what the public gets'] } });
    });

    it('keeps attributes the form doesn’t show when the tagline changes', () => {
      saveElement(root, { ...element('mission', 'local-audit'), tagline: '' }, targets);
      expect(list('audit/missions.yaml')[0].attributes).toEqual({ scope: 'US-local', principles: ['Every audit starts from risk'] });
    });
  });

  describe('outcomes', () => {
    it('adds an outcome to a mission, in the mission’s own list', () => {
      const { id } = saveElement(root, outcome({ incoming: { seeks: ['example:mission:local-audit'] } }), targets);
      expect(id).toBe('reports-are-read');
      expect(text('audit/missions.yaml')).toContain('seeks: [ on-plan, findings-closed, reports-are-read ]');
    });

    it('writes your own capability’s link on it, and a library capability’s in links.yaml', () => {
      const was = element('outcome', 'findings-closed');
      saveElement(root, { ...was, incoming: { ...was.incoming, contributes_to: [...was.incoming!.contributes_to, 'example:capability:audit-planning', 'eb:capability:identity', 'eb:capability:request-intake'] } }, targets);
      expect(text('audit/capabilities.yaml')).toContain('contributes_to: [ on-plan, findings-closed ]');
      expect(text('audit/links.yaml')).toContain('# Links from the library');
      expect(list('audit/links.yaml')).toEqual([
        { from: 'capability:records-management', contributes_to: ['findings-closed'] },
        { from: 'eb:capability:identity', contributes_to: ['findings-closed'] },
        { from: 'eb:capability:request-intake', contributes_to: ['findings-closed'] },
      ]);
      expect(parse(text('audit/package.yaml')).dependencies).toEqual(['common', 'foia']);
    });

    it('adds to a library capability’s existing entry instead of repeating it', () => {
      const was = element('outcome', 'on-plan');
      saveElement(root, { ...was, incoming: { ...was.incoming, contributes_to: [...was.incoming!.contributes_to, 'eb:capability:records-management'] } }, targets);
      expect(list('audit/links.yaml')).toEqual([{ from: 'capability:records-management', contributes_to: ['findings-closed', 'on-plan'] }]);
    });

    it('takes links away from wherever they’re written', () => {
      const closed = element('outcome', 'findings-closed');
      saveElement(root, { ...closed, incoming: { ...closed.incoming, contributes_to: [] } }, targets);
      expect(list('audit/links.yaml')).toEqual([]);
      const plan = element('outcome', 'on-plan');
      saveElement(root, { ...plan, incoming: { seeks: [], contributes_to: [] } }, targets);
      expect(list('audit/missions.yaml')[0].seeks).toEqual(['findings-closed']);
      expect(list('audit/capabilities.yaml')[0].contributes_to).toBeUndefined();
    });

    it('keeps a measure’s ID and sources, and gives a new one an ID of its own', () => {
      const was = element('outcome', 'on-plan');
      saveElement(root, { ...was, measures: [{ ...was.measures![0], title: 'Plan completed' }, { title: 'Share of the plan completed', description: 'A second one.' }] }, targets);
      expect(list('audit/outcomes.yaml')[0].measures).toEqual([
        { id: 'plan-completed', title: 'Plan completed', description: 'Audits reported this year.', sources: ['audit-standards'] },
        { id: 'share-of-the-plan-completed', title: 'Share of the plan completed', description: 'A second one.' },
      ]);
    });

    it('undoes every file a change touched', () => {
      const was = element('outcome', 'on-plan');
      const { undo } = saveElement(root, { ...was, title: 'Changed', incoming: { seeks: [], contributes_to: ['eb:capability:request-intake'] } }, targets);
      undo();
      expect(text('audit/outcomes.yaml')).toBe(OUTCOMES);
      expect(text('audit/missions.yaml')).toBe(MISSIONS);
      expect(text('audit/capabilities.yaml')).toBe(CAPABILITIES);
      expect(text('audit/links.yaml')).toBe(LINKS);
      expect(text('audit/package.yaml')).toBe(AUDIT);
    });
  });

  describe('capabilities', () => {
    it('adds a capability, with bare keys for its own package’s items and full IDs for the library’s', () => {
      const { id } = saveElement(root, capability({ links: { contributes_to: [{ to: 'example:outcome:on-plan' }], candidate_pattern: [{ to: 'eb:implementationPattern:case-platform', coverage: 'partial', note: 'Part of it' }], satisfies: [{ to: 'example:requirement:publish-the-plan' }] } }), targets);
      expect(list('audit/capabilities.yaml').find((c) => c.id === id)).toEqual({
        id: 'report-publishing', title: 'Report Publishing', stage: 'report-close', status: 'draft', description: 'Ability to publish audit reports.',
        contributes_to: ['on-plan'],
        candidate_pattern: [{ to: 'eb:implementationPattern:case-platform', coverage: 'partial', note: 'Part of it' }],
        satisfies: ['publish-the-plan'],
      });
    });

    it('keeps a pattern’s link as written unless its coverage or note changes', () => {
      const was = element('capability', 'audit-planning');
      saveElement(root, { ...was, links: { ...was.links, candidate_pattern: [{ to: 'eb:implementationPattern:case-platform' }] } }, targets);
      expect(list('audit/capabilities.yaml')[0].candidate_pattern).toEqual(['case-platform']);
    });

    it('keeps sources, which the form doesn’t show', () => {
      saveElement(root, { ...element('capability', 'audit-planning'), title: 'Annual Audit Planning' }, targets);
      expect(list('audit/capabilities.yaml')[0].sources).toEqual(['audit-standards']);
    });

    it('keeps a link to something the form can’t offer any more', () => {
      const was = element('capability', 'audit-planning');
      const path = join(root, 'source', 'audit', 'capabilities.yaml');
      writeFileSync(path, CAPABILITIES.replace('satisfies: [ publish-the-plan ]', 'satisfies: [ eb:requirement:gone ]'));
      saveElement(root, { ...was, title: 'Changed', links: { ...was.links, satisfies: [{ to: 'eb:requirement:gone' }] } }, targets);
      expect(text('audit/capabilities.yaml')).toContain('satisfies: [ eb:requirement:gone ]');
    });
  });

  describe('deleting', () => {
    it('deletes a resource, keeping the file’s opening comment, and undoes that', () => {
      const { undo } = deleteElement(root, 'offerings', 'resource', 'intake-assessment', targets);
      expect(element('resource', 'intake-assessment')).toBeUndefined();
      expect(text('offerings/resources.yaml')).toContain('# A comment that should stay.');
      undo();
      expect(text('offerings/resources.yaml')).toBe(RESOURCES);
    });

    it('takes an outcome’s links with it, wherever they are', () => {
      const { undo } = deleteElement(root, 'audit', 'outcome', 'findings-closed', targets);
      expect(list('audit/outcomes.yaml').map((o) => o.id)).toEqual(['on-plan']);
      expect(list('audit/missions.yaml')[0].seeks).toEqual(['on-plan']);
      expect(list('audit/links.yaml')).toEqual([]);
      undo();
      for (const [file, was] of [['outcomes', OUTCOMES], ['missions', MISSIONS], ['links', LINKS]]) expect(text(`audit/${file}.yaml`)).toBe(was);
    });

    it('takes a capability’s entries in links.yaml with it, and resources’ links to it', () => {
      const path = join(root, 'source', 'offerings', 'resources.yaml');
      writeFileSync(path, `${RESOURCES}\n- id: planning-guide\n  title: Planning guide\n  kind: guide\n  url: https://example.com/g\n  lastReviewedAt: 2026-10-30\n  description: A guide.\n  helps_with:\n    - example:capability:audit-planning\n    - capability:records-management\n`);
      deleteElement(root, 'audit', 'capability', 'audit-planning', targets);
      expect(list('audit/capabilities.yaml')).toEqual([]);
      expect(list('offerings/resources.yaml').at(-1)!.helps_with).toEqual(['capability:records-management']);
    });

    it('leaves a mission’s outcomes in place', () => {
      deleteElement(root, 'audit', 'mission', 'local-audit', targets);
      expect(list('audit/missions.yaml')).toEqual([]);
      expect(list('audit/outcomes.yaml')).toHaveLength(2);
    });
  });

  it('finds which capabilities would bring a pattern into a mission', () => {
    expect(capabilitiesProviding(root, RELEASE, 'eb:implementationPattern:case-platform', targets).map((c) => c.title)).toEqual(['Identity']);
    expect(capabilitiesProviding(root, RELEASE, 'eb:implementationPattern:other', targets)).toEqual([]);
  });

  it('never changes an ID, and gives a new element one of its own', () => {
    expect(saveElement(root, { ...element('resource', 'intake-assessment'), title: 'Something else' }, targets).id).toBe('intake-assessment');
    expect(saveElement(root, resource({ title: 'Something else' }), targets).id).toBe('something-else');
    expect(saveElement(root, resource({ title: 'Something else' }), targets).id).toBe('something-else-2');
    expect(newId('Café: the “best” guide!', [])).toBe('cafe-the-best-guide');
  });

  it('says what’s wrong with a form that isn’t finished, and writes nothing', () => {
    const save = (input: ElementFields) => () => saveElement(root, input, targets);
    const values = (over: Record<string, string>) => ({ values: { ...resource().values, ...over } });
    expect(save(resource({ title: ' ' }))).toThrow('Give it a title.');
    expect(save(resource(values({ kind: 'nonsense' })))).toThrow('Choose what kind');
    expect(save(resource(values({ url: 'not a link' })))).toThrow('http://');
    expect(save(resource({ links: { helps_with: [] } }))).toThrow('at least one');
    expect(save(resource({ links: { helps_with: [{ to: 'eb:capability:nothing' }] } }))).toThrow("Can't find");
    expect(save(resource({ links: { helps_with: [{ to: 'eb:capability:records-management', way: 'nonsense' }] } }))).toThrow(EditError);
    expect(save(resource({ details: { 'two words': 'x' } }))).toThrow('no spaces');
    expect(save(outcome({ values: {} }))).toThrow('what the public gets');
    expect(save(outcome({ status: 'nonsense' }))).toThrow('Choose a status');
    expect(save(outcome({ measures: [{ title: 'Only a title', description: '' }] }))).toThrow('each measure');
    expect(save(outcome({ incoming: { contributes_to: ['example:outcome:on-plan'] } }))).toThrow("can't go there");
    expect(save(capability({ values: {} }))).toThrow('stage of the work');
    expect(save(capability({ links: {} }))).toThrow('at least one outcome');
    expect(save(capability({ links: { contributes_to: [{ to: 'eb:capability:identity' }] } }))).toThrow("can't go there");
    expect(save({ ...resource(), package: '../outside' })).toThrow(EditError);
    expect(save({ ...resource(), type: 'solution' })).toThrow('doesn’t handle'.replace('’', "'"));
    expect(() => saveElement(root, { ...resource(), id: 'nothing-here' }, targets)).toThrow(EditError);
    expect(() => deleteElement(root, 'offerings', 'resource', 'nothing-here', targets)).toThrow(EditError);
    expect(text('offerings/resources.yaml')).toBe(RESOURCES);
    expect(text('audit/outcomes.yaml')).toBe(OUTCOMES);
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
