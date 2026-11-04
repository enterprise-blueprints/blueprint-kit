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

const REQUIREMENTS = `# Requirements, in the order the pages show them.

- id: publish-the-plan
  title: Publish the plan
  kind: transparency-reporting
  status: draft
  description: Publish the audit plan once the council approves it.
  sources: [ audit-standards ]
`;

const PATTERNS = `# Patterns, each with the links it holds.

- id: audit-workbench
  title: Audit Workbench
  status: draft
  description: "An example architecture: one place for workpapers and findings."
  sources: [ audit-standards ]
  attributes:
    layer: business-applications
    parts:
      - Workpapers linked to each finding
      - Review steps with sign-off
    strengths:
      - Reviewers see the evidence beside the finding
    ways:
      - id: product
        approach: product
        title: An audit management product
        description: Configured for the office’s methods.
        watchFor:
          - Licenses priced per auditor
      - id: built
        approach: build
        title: Built on the case platform
  depends_on:
    - to: eb:implementationPattern:case-platform
      way: built
      note: It runs on the platform.
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
  'source/audit/requirements.yaml': REQUIREMENTS,
  'source/audit/patterns.yaml': PATTERNS,
  'content/audit/0.1.0/blueprint.json': library('Audit', [
    { id: 'example:mission:local-audit', type: 'mission', title: 'Local Audit' },
    { id: 'example:outcome:on-plan', type: 'outcome', title: 'The audit plan is carried out' },
    { id: 'example:outcome:findings-closed', type: 'outcome', title: 'Findings are closed' },
    { id: 'example:capability:audit-planning', type: 'capability', title: 'Audit Planning' },
    { id: 'example:requirement:publish-the-plan', type: 'requirement', title: 'Publish the plan' },
    { id: 'example:implementationPattern:audit-workbench', type: 'implementationPattern', title: 'Audit Workbench', attributes: { ways: [{ id: 'product', title: 'An audit management product' }, { id: 'built', title: 'Built on the case platform' }] } },
  ]),
  'content/offerings/0.1.0/blueprint.json': library('Offerings', [{ id: 'example:capability:advice', type: 'capability', title: 'Advice' }]),
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
  const requirement = (over: Partial<ElementFields> = {}): ElementFields => ({
    package: 'audit',
    type: 'requirement',
    title: 'Report to the council',
    description: 'Report to the council each quarter.',
    status: 'draft',
    values: { kind: 'transparency-reporting' },
    incoming: { satisfies: ['example:capability:audit-planning'] },
    ...over,
  });
  const pattern = (over: Partial<ElementFields> = {}): ElementFields => ({
    package: 'audit',
    type: 'implementationPattern',
    title: 'Findings Tracker',
    description: 'An example architecture: a list of findings and what’s been done about them.',
    status: 'draft',
    pattern: { layer: 'business-applications', ways: [{ approach: 'platform', title: 'The agency’s platform' }] },
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
    expect(targets.find((t) => !t.own && t.ways.length)).toMatchObject({ ways: [{ id: 'platform', title: 'A platform' }] });
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

    it('reads a requirement’s kind and the capability it belongs to', () => {
      expect(element('requirement', 'publish-the-plan')).toMatchObject({ values: { kind: 'transparency-reporting' }, incoming: { satisfies: ['example:capability:audit-planning'] } });
    });

    it('reads a pattern’s layer, statements, ways, and links', () => {
      const { pattern: fields, links } = element('implementationPattern', 'audit-workbench');
      expect(fields).toMatchObject({ layer: 'business-applications', parts: ['Workpapers linked to each finding', 'Review steps with sign-off'], strengths: ['Reviewers see the evidence beside the finding'] });
      expect(fields!.ways).toEqual([
        { id: 'product', approach: 'product', title: 'An audit management product', description: 'Configured for the office’s methods.', watchFor: ['Licenses priced per auditor'] },
        { id: 'built', approach: 'build', title: 'Built on the case platform' },
      ]);
      expect(links!.depends_on).toEqual([{ to: 'eb:implementationPattern:case-platform', way: 'built', note: 'It runs on the platform.' }]);
    });
  });

  it('writes nothing different when nothing changed, for every type', () => {
    const files = ['offerings/resources.yaml', 'offerings/package.yaml', 'audit/missions.yaml', 'audit/outcomes.yaml', 'audit/capabilities.yaml', 'audit/requirements.yaml', 'audit/patterns.yaml', 'audit/links.yaml', 'audit/package.yaml'];
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

    it('writes out the package’s short references when a link brings in a second prefix, and undoes that with the rest', () => {
      const before = [text('offerings/package.yaml'), text('offerings/resources.yaml')];
      const { undo } = saveElement(root, resource({ links: { helps_with: [{ to: 'example:outcome:on-plan' }] } }), targets);
      expect((parse(text('offerings/package.yaml')) as { dependencies: string[] }).dependencies).toEqual(['common', 'audit']);
      const after = text('offerings/resources.yaml');
      expect(after).toContain('- eb:capability:records-management');
      expect(after).toContain('- to: eb:implementationPattern:case-platform');
      expect(after).toContain('helps_with: [ eb:capability:records-management ]');
      expect(after).toContain('# A comment that should stay.');
      expect(list('offerings/resources.yaml').at(-1)!.helps_with).toEqual(['example:outcome:on-plan']);
      undo();
      expect([text('offerings/package.yaml'), text('offerings/resources.yaml')]).toEqual(before);
    });

    it('leaves your own items short, and reaches links.yaml, bare keys, and discovery', () => {
      const discoveryFile = `- id: set
  title: Set
  questions:
    - id: q
      prompt: Q?
      kind: boolean
      points:
        - when: "true"
          to: capability:records-management
          why: Why
        - when: "false"
          to: [ capability:audit-planning, measure:plan-completed ]
          why: Why
`;
      writeFileSync(join(root, 'source', 'audit', 'discovery.yaml'), discoveryFile);
      const other: Target = { id: 'other:capability:x', title: 'X', type: 'capability', typeLabel: 'Capability', packageTitle: 'Other', folder: 'other', own: false, ways: [] };
      saveElement(root, pattern({ incoming: { candidate_pattern: [other.id, 'example:capability:audit-planning'] } }), [...targets, other]);
      const [planning] = list('audit/capabilities.yaml');
      expect(planning.candidate_pattern).toEqual([{ to: 'eb:implementationPattern:case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }, 'findings-tracker']);
      expect(planning.contributes_to).toEqual(['on-plan']);
      expect(text('audit/links.yaml')).toContain('from: eb:capability:records-management');
      expect(text('audit/links.yaml')).toContain('from: other:capability:x');
      const discovery = text('audit/discovery.yaml');
      expect(discovery).toContain('to: eb:capability:records-management');
      expect(discovery).toContain('to: [ capability:audit-planning, measure:plan-completed ]');
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

    it('keeps a link written out with only its to', () => {
      const path = join(root, 'source', 'audit', 'capabilities.yaml');
      writeFileSync(path, CAPABILITIES.replace('satisfies: [ publish-the-plan ]', 'satisfies:\n    - to: publish-the-plan'));
      saveElement(root, element('capability', 'audit-planning'), targets);
      expect(text('audit/capabilities.yaml')).toContain('- to: publish-the-plan');
    });

    it('saves a shared capability whose outcomes are in other packages', () => {
      const was = element('capability', 'audit-planning');
      saveElement(root, { ...was, title: 'Changed', links: { ...was.links, contributes_to: [] } }, targets);
      expect(list('audit/capabilities.yaml')[0].title).toBe('Changed');
    });

    it('keeps a link to something the form can’t offer any more', () => {
      const was = element('capability', 'audit-planning');
      const path = join(root, 'source', 'audit', 'capabilities.yaml');
      writeFileSync(path, CAPABILITIES.replace('satisfies: [ publish-the-plan ]', 'satisfies: [ eb:requirement:gone ]'));
      saveElement(root, { ...was, title: 'Changed', links: { ...was.links, satisfies: [{ to: 'eb:requirement:gone' }] } }, targets);
      expect(text('audit/capabilities.yaml')).toContain('satisfies: [ eb:requirement:gone ]');
    });
  });

  describe('requirements', () => {
    it('adds a requirement, with its link written on its capability', () => {
      expect(saveElement(root, requirement(), targets).id).toBe('report-to-the-council');
      expect(list('audit/requirements.yaml').at(-1)).toEqual({ id: 'report-to-the-council', title: 'Report to the council', kind: 'transparency-reporting', status: 'draft', description: 'Report to the council each quarter.' });
      expect(list('audit/capabilities.yaml')[0].satisfies).toEqual(['publish-the-plan', 'report-to-the-council']);
      expect(text('audit/requirements.yaml').startsWith(REQUIREMENTS)).toBe(true);
    });

    it('moves a requirement to another capability, keeping its sources', () => {
      const { id } = saveElement(root, capability(), targets);
      targets = [...targets, { id: `example:capability:${id}`, title: 'Report Publishing', type: 'capability', typeLabel: 'Capability', packageTitle: 'Audit', folder: 'audit', own: true, ways: [] }];
      saveElement(root, { ...element('requirement', 'publish-the-plan'), incoming: { satisfies: [`example:capability:${id}`] } }, targets);
      const [planning, publishing] = list('audit/capabilities.yaml');
      expect(planning.satisfies).toBeUndefined();
      expect(publishing.satisfies).toEqual(['publish-the-plan']);
      expect(list('audit/requirements.yaml')[0].sources).toEqual(['audit-standards']);
    });

    it('keeps a requirement that was already on two capabilities', () => {
      const path = join(root, 'source', 'audit', 'links.yaml');
      writeFileSync(path, `${LINKS}\n- from: capability:identity\n  satisfies: [ publish-the-plan ]\n`);
      const before = text('audit/links.yaml');
      saveElement(root, { ...element('requirement', 'publish-the-plan'), title: 'Publish it' }, targets);
      expect(text('audit/links.yaml')).toBe(before);
      expect(list('audit/requirements.yaml')[0].title).toBe('Publish it');
    });
  });

  describe('patterns', () => {
    it('adds a pattern with its attributes in the library’s order', () => {
      saveElement(root, pattern({
        pattern: {
          layer: 'data-records',
          parts: [' A list of findings ', ''],
          watchFor: ['Findings that never close'],
          ways: [{ approach: 'product', title: 'A Tracking Product', description: ' Bought. ', strengths: ['Quick to start'] }, { approach: 'build', title: 'A Tracking Product' }],
        },
      }), targets);
      const added = list('audit/patterns.yaml').at(-1)!;
      expect(Object.keys(added)).toEqual(['id', 'title', 'status', 'description', 'attributes']);
      expect(added.attributes).toEqual({
        layer: 'data-records',
        parts: ['A list of findings'],
        watchFor: ['Findings that never close'],
        ways: [
          { id: 'a-tracking-product', approach: 'product', title: 'A Tracking Product', description: 'Bought.', strengths: ['Quick to start'] },
          { id: 'a-tracking-product-2', approach: 'build', title: 'A Tracking Product' },
        ],
      });
      expect(text('audit/patterns.yaml').startsWith(PATTERNS)).toBe(true);
    });

    it('writes a link from your capability on it, and from a library capability in links.yaml', () => {
      saveElement(root, pattern({ incoming: { candidate_pattern: ['example:capability:audit-planning', 'eb:capability:identity'] } }), targets);
      const [planning] = list('audit/capabilities.yaml');
      expect(planning.candidate_pattern).toEqual([{ to: 'case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }, 'findings-tracker']);
      expect(list('audit/links.yaml').at(-1)).toEqual({ from: 'eb:capability:identity', candidate_pattern: ['findings-tracker'] });
    });

    it('changes a way without changing its ID, and keeps what’s around it', () => {
      const was = element('implementationPattern', 'audit-workbench');
      const ways = was.pattern!.ways.map((w) => (w.id === 'product' ? { ...w, title: 'A product for audit offices' } : w));
      saveElement(root, { ...was, pattern: { ...was.pattern!, ways } }, targets);
      const after = text('audit/patterns.yaml');
      expect(after).toContain('- id: product');
      expect(after).toContain('title: A product for audit offices');
      expect(after).toContain('sources: [ audit-standards ]');
      expect(after).toContain('way: built');
      expect(after.startsWith('# Patterns, each with the links it holds.')).toBe(true);
    });

    it('takes an empty list away, since the format won’t have one', () => {
      const was = element('implementationPattern', 'audit-workbench');
      saveElement(root, { ...was, pattern: { ...was.pattern!, strengths: [] } }, targets);
      expect(list('audit/patterns.yaml')[0].attributes).not.toHaveProperty('strengths');
    });

    it('reads a need’s way as this pattern’s, not the other one’s', () => {
      const was = element('implementationPattern', 'audit-workbench');
      const needs = (way: string) => ({ ...was, title: 'Changed', links: { ...was.links, depends_on: [{ to: 'eb:implementationPattern:case-platform', way }] } });
      expect(() => saveElement(root, needs('platform'), targets)).toThrow('isn’t one of this pattern’s');
      expect(() => saveElement(root, needs('product'), targets)).not.toThrow();
    });

    it('adds the package a need reaches', () => {
      saveElement(root, pattern({ package: 'offerings', links: { depends_on: [{ to: 'eb:implementationPattern:case-platform', note: 'Runs on it.' }], works_with: [{ to: 'example:implementationPattern:audit-workbench' }] } }), targets);
      expect(list('offerings/patterns.yaml').at(-1)).toMatchObject({ depends_on: [{ to: 'eb:implementationPattern:case-platform', note: 'Runs on it.' }], works_with: ['example:implementationPattern:audit-workbench'] });
      expect((parse(text('offerings/package.yaml')) as { dependencies: string[] }).dependencies).toEqual(['common', 'audit']);
    });

    it('won’t take away a way that a resource is about', () => {
      saveElement(root, resource({ links: { helps_with: [{ to: 'example:implementationPattern:audit-workbench', way: 'product' }] } }), targets);
      const was = element('implementationPattern', 'audit-workbench');
      const fewer = { ...was, links: { ...was.links }, pattern: { ...was.pattern!, ways: was.pattern!.ways.filter((w) => w.id !== 'product') } };
      expect(() => saveElement(root, fewer, targets)).toThrow('“Records review” is about the way “An audit management product”');
      expect(text('audit/patterns.yaml')).toBe(PATTERNS);
    });

    it('undoes a new pattern and everything its links touched', () => {
      const before = [text('audit/patterns.yaml'), text('audit/capabilities.yaml'), text('audit/links.yaml')];
      saveElement(root, pattern({ incoming: { candidate_pattern: ['example:capability:audit-planning', 'eb:capability:identity'] } }), targets).undo();
      expect([text('audit/patterns.yaml'), text('audit/capabilities.yaml'), text('audit/links.yaml')]).toEqual(before);
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

    it('won’t leave a resource with nothing to help with', () => {
      const id = 'example:implementationPattern:audit-workbench';
      saveElement(root, resource({ links: { helps_with: [{ to: id }] } }), targets);
      expect(() => deleteElement(root, 'audit', 'implementationPattern', 'audit-workbench', targets)).toThrow('“Records review” helps only with this');
      expect(text('audit/patterns.yaml')).toBe(PATTERNS);
    });

    it('takes a requirement off its capability', () => {
      deleteElement(root, 'audit', 'requirement', 'publish-the-plan', targets);
      expect(list('audit/requirements.yaml')).toEqual([]);
      expect(list('audit/capabilities.yaml')[0].satisfies).toBeUndefined();
    });

    it('takes a pattern’s links with it, from capabilities, links.yaml, other patterns, and resources', () => {
      const id = 'example:implementationPattern:audit-workbench';
      saveElement(root, pattern({ links: { works_with: [{ to: id }], depends_on: [{ to: id }] } }), targets);
      saveElement(root, resource({ links: { helps_with: [{ to: id, way: 'product' }, { to: 'eb:capability:identity' }] } }), targets);
      saveElement(root, { ...element('implementationPattern', 'audit-workbench'), incoming: { candidate_pattern: ['example:capability:audit-planning', 'eb:capability:identity'] } }, targets);
      deleteElement(root, 'audit', 'implementationPattern', 'audit-workbench', targets);
      expect(list('audit/patterns.yaml').map((p) => p.id)).toEqual(['findings-tracker']);
      expect(list('audit/patterns.yaml')[0]).not.toHaveProperty('works_with');
      expect(list('audit/patterns.yaml')[0]).not.toHaveProperty('depends_on');
      expect(list('audit/capabilities.yaml')[0].candidate_pattern).toEqual([{ to: 'case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }]);
      expect(text('audit/links.yaml')).not.toContain('audit-workbench');
      expect(list('offerings/resources.yaml').at(-1)!.helps_with).toEqual(['eb:capability:identity']);
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
    expect(save(requirement({ values: {} }))).toThrow('what kind of requirement');
    expect(save(requirement({ incoming: {} }))).toThrow('the capability it belongs to');
    expect(save(requirement({ incoming: { satisfies: ['example:capability:audit-planning', 'eb:capability:identity'] } }))).toThrow('belongs to one capability');
    expect(save(requirement({ incoming: { satisfies: ['eb:capability:identity'] } }))).toThrow('in another package');
    expect(save(requirement({ incoming: { satisfies: ['example:capability:advice'] } }))).toThrow('in another package');
    expect(save(pattern({ pattern: undefined }))).toThrow('Choose its layer');
    expect(save(pattern({ pattern: { layer: 'processing', ways: [{ approach: 'build', title: 'Built' }] } }))).toThrow('Choose its layer');
    expect(save(pattern({ pattern: { layer: 'connections', ways: [] } }))).toThrow('at least one way');
    expect(save(pattern({ pattern: { layer: 'connections', ways: [{ approach: 'nonsense', title: ' ' }, { approach: '', title: '' }] } }))).toThrow('Choose an approach for each way.\nGive each way a title.');
    expect(() => saveElement(root, { ...pattern(), id: 'audit-workbench', links: { works_with: [{ to: 'example:implementationPattern:audit-workbench' }] } }, targets)).toThrow('link to itself');
    expect(save({ ...resource(), package: '../outside' })).toThrow(EditError);
    expect(save({ ...resource(), type: 'solution' })).toThrow('doesn’t handle'.replace('’', "'"));
    expect(() => saveElement(root, { ...resource(), id: 'nothing-here' }, targets)).toThrow(EditError);
    expect(() => deleteElement(root, 'offerings', 'resource', 'nothing-here', targets)).toThrow(EditError);
    expect(text('offerings/resources.yaml')).toBe(RESOURCES);
    expect(text('audit/outcomes.yaml')).toBe(OUTCOMES);
    expect(text('audit/requirements.yaml')).toBe(REQUIREMENTS);
    expect(text('audit/patterns.yaml')).toBe(PATTERNS);
  });

  it('keeps a link from something the form can’t offer any more, on the element it points to', () => {
    writeFileSync(join(root, 'source', 'audit', 'links.yaml'), `${LINKS}\n- from: capability:old\n  contributes_to: [ on-plan ]\n`);
    const before = text('audit/links.yaml');
    saveElement(root, { ...element('outcome', 'on-plan'), title: 'Changed' }, targets);
    expect(text('audit/links.yaml')).toBe(before);
    expect(list('audit/outcomes.yaml')[0].title).toBe('Changed');
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
