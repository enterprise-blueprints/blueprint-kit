import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { allowed } from '../editor/server';
import {
  addPackage, capabilitiesProviding, deleteElement, deleteQuestion, deleteSet, deleteSource, EditError, newId, packageList, readDiscovery, readElements, readSources, readTargets,
  saveElement, saveQuestion, saveSet, saveSource, type ElementFields, type QuestionFields, type SourceFields, type Target,
} from '../editor/store';

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
    - to: solution:case-platform-platform
      note: The platform, start to finish.
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
  works_with:
    - to: eb:implementationPattern:case-platform
      note: Findings can open cases.
`;

const SOLUTIONS = `# Solutions, each with the patterns it implements.

- id: audit-workbench-product
  title: An audit management product
  approach: product
  status: draft
  description: Configured for the office’s methods.
  attributes:
    watchFor:
      - Licenses priced per auditor
  implements: [ audit-workbench ]

- id: audit-workbench-built
  title: Built on the case platform
  approach: build
  status: draft
  description: The workbench, built on the agency’s case platform.
  implements: [ audit-workbench ]
  depends_on:
    - to: eb:implementationPattern:case-platform
      note: It runs on the platform.
`;

const SOURCES = `# The references this package cites.

- id: audit-standards
  title: Government Auditing Standards
  url: https://example.com/standards
  kind: official-reference
  publicationDate: 2024-02-01
  lastReviewedAt: 2026-10-30
  note: What an audit has to do.
`;

const DISCOVERY = `# Discovery question sets.

- id: audit-results
  title: Audit results discovery
  description: For the start of an engagement.
  questions:
    - id: priority-results
      prompt: Which of these results matter most?
      kind: multiple-choice
      options:
        - on-plan: The plan is carried out
        - closed: Findings are closed
      points:
        - when: on-plan
          to: outcome:on-plan
          why: This effort is meant to advance it.
        - when: [ on-plan, closed ]
          to: [ measure:plan-completed, capability:records-management ]
          why: Either one needs it.
    - id: publishes-reports
      prompt: Does the office publish its reports?
      kind: boolean
      points:
        - when: "false"
          to: capability:audit-planning
          why: It may need a way to publish.
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
  'source/audit/solutions.yaml': SOLUTIONS,
  'source/audit/sources.yaml': SOURCES,
  'source/audit/discovery.yaml': DISCOVERY,
  'content/audit/0.1.0/blueprint.json': library('Audit', [
    { id: 'example:mission:local-audit', type: 'mission', title: 'Local Audit' },
    { id: 'example:outcome:on-plan', type: 'outcome', title: 'The audit plan is carried out', attributes: { measures: [{ id: 'plan-completed', title: 'Share of the plan completed' }] } },
    { id: 'example:outcome:findings-closed', type: 'outcome', title: 'Findings are closed' },
    { id: 'example:capability:audit-planning', type: 'capability', title: 'Audit Planning' },
    { id: 'example:requirement:publish-the-plan', type: 'requirement', title: 'Publish the plan' },
    { id: 'example:implementationPattern:audit-workbench', type: 'implementationPattern', title: 'Audit Workbench', attributes: { layer: 'business-applications' } },
    { id: 'example:solution:audit-workbench-product', type: 'solution', title: 'An audit management product', attributes: { approach: 'product' } },
    { id: 'example:solution:audit-workbench-built', type: 'solution', title: 'Built on the case platform', attributes: { approach: 'build' } },
  ]),
  'content/offerings/0.1.0/blueprint.json': library('Offerings', [{ id: 'example:capability:advice', type: 'capability', title: 'Advice' }]),
  [`library/packages/common/${RELEASE}/blueprint.json`]: library('Common', [
    { id: 'eb:capability:records-management', type: 'capability', title: 'Records management' },
    { id: 'eb:capability:identity', type: 'capability', title: 'Identity' },
    { id: 'eb:implementationPattern:case-platform', type: 'implementationPattern', title: 'Case platform', attributes: { layer: 'business-applications' } },
    { id: 'eb:solution:case-platform-platform', type: 'solution', title: 'A platform', attributes: { approach: 'platform' } },
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
    pattern: { layer: 'business-applications' },
    ...over,
  });
  const solution = (over: Partial<ElementFields> = {}): ElementFields => ({
    package: 'audit',
    type: 'solution',
    title: 'The office’s own app',
    description: 'An app the office builds on its platform.',
    status: 'draft',
    values: { approach: 'build' },
    links: { implements: [{ to: 'example:implementationPattern:audit-workbench' }] },
    ...over,
  });

  const source = (over: Partial<SourceFields> = {}): SourceFields => ({ package: 'audit', title: 'City Charter, Article 5', url: 'https://example.com/charter', kind: 'official-reference', lastReviewedAt: '2026-11-04', ...over });
  const question = (over: Partial<QuestionFields> = {}): QuestionFields => ({ package: 'audit', set: 'audit-results', prompt: 'How does the office plan its audits?', kind: 'text', ...over });
  const askedIn = (id: string) => readDiscovery(root, targets).flatMap((s) => s.questions).find((q) => q.id === id)!;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'site-editor-'));
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
    expect(targets.find((t) => t.id === 'eb:solution:case-platform-platform')).toMatchObject({ type: 'solution', own: false, folder: 'common' });
    expect(packageList(root)).toEqual([{ name: 'audit', title: 'Audit' }, { name: 'offerings', title: 'Offerings' }]);
  });

  describe('reading', () => {
    it('reads resources, with their links as full IDs', () => {
      const demo = element('resource', 'intake-demo');
      expect(demo.elementId).toBe('example:resource:intake-demo');
      expect(demo.links!.helps_with).toEqual([{ to: 'eb:solution:case-platform-platform', note: 'The platform, start to finish.' }, { to: 'eb:capability:records-management' }]);
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

    it('reads a pattern’s layer, statements, links, and solutions', () => {
      const { pattern: fields, links, incoming } = element('implementationPattern', 'audit-workbench');
      expect(fields).toEqual({ layer: 'business-applications', parts: ['Workpapers linked to each finding', 'Review steps with sign-off'], strengths: ['Reviewers see the evidence beside the finding'] });
      expect(links!.works_with).toEqual([{ to: 'eb:implementationPattern:case-platform', note: 'Findings can open cases.' }]);
      expect(incoming!.implements).toEqual(['example:solution:audit-workbench-product', 'example:solution:audit-workbench-built']);
    });

    it('reads a solution’s approach, statements, what it implements, and what it needs', () => {
      expect(element('solution', 'audit-workbench-product')).toMatchObject({ values: { approach: 'product' }, pattern: { watchFor: ['Licenses priced per auditor'] }, links: { implements: [{ to: 'example:implementationPattern:audit-workbench' }] } });
      expect(element('solution', 'audit-workbench-built').links!.depends_on).toEqual([{ to: 'eb:implementationPattern:case-platform', note: 'It runs on the platform.' }]);
    });
  });

  it('writes nothing different when nothing changed, for every type', () => {
    const files = ['offerings/resources.yaml', 'offerings/package.yaml', 'audit/missions.yaml', 'audit/outcomes.yaml', 'audit/capabilities.yaml', 'audit/requirements.yaml', 'audit/patterns.yaml', 'audit/solutions.yaml', 'audit/sources.yaml', 'audit/discovery.yaml', 'audit/links.yaml', 'audit/package.yaml'];
    const before = files.map(text);
    for (const e of readElements(root, targets)) saveElement(root, e, targets);
    for (const s of readSources(root)) saveSource(root, s);
    for (const set of readDiscovery(root, targets)) {
      saveSet(root, set);
      for (const q of set.questions) saveQuestion(root, q, targets);
    }
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

    it('keeps how a link is written when its note changes', () => {
      const was = element('resource', 'intake-demo');
      const [first, second] = was.links!.helps_with;
      saveElement(root, { ...was, links: { helps_with: [{ ...first, note: 'Start here' }, second] } }, targets);
      expect(list('offerings/resources.yaml').find((r) => r.id === was.id)!.helps_with).toEqual([{ to: 'solution:case-platform-platform', note: 'Start here' }, 'capability:records-management']);
      saveElement(root, { ...element('resource', 'intake-demo'), links: { helps_with: [{ to: first.to }, second] } }, targets);
      expect(list('offerings/resources.yaml').find((r) => r.id === was.id)!.helps_with).toEqual(['solution:case-platform-platform', 'capability:records-management']);
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
      expect(after).toContain('- to: eb:solution:case-platform-platform');
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
      const other: Target = { id: 'other:capability:x', title: 'X', type: 'capability', typeLabel: 'Capability', packageTitle: 'Other', folder: 'other', own: false };
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

    it('saves what varies on a capability, and leaves it when a form doesn’t send it', () => {
      const notes = 'Some offices work under a city charter.';
      const { id } = saveElement(root, capability({ applicabilityNotes: ` ${notes} ` }), targets);
      expect(list('audit/capabilities.yaml').find((c) => c.id === id)!.applicabilityNotes).toBe(notes);
      const fresh = readTargets(root, RELEASE);
      const saved = readElements(root, fresh).find((e) => e.type === 'capability' && e.id === id)!;
      expect(saved.applicabilityNotes).toBe(notes);
      const { applicabilityNotes: _notes, ...without } = saved;
      saveElement(root, without, fresh);
      expect(list('audit/capabilities.yaml').find((c) => c.id === id)!.applicabilityNotes).toBe(notes);
      saveElement(root, { ...saved, applicabilityNotes: '' }, fresh);
      expect(list('audit/capabilities.yaml').find((c) => c.id === id)).not.toHaveProperty('applicabilityNotes');
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

    it('adds a capability to a shared package, which has no outcomes of its own to choose', () => {
      saveElement(root, capability({ package: 'offerings', links: {} }), targets);
      expect(list('offerings/capabilities.yaml').at(-1)).toMatchObject({ id: 'report-publishing' });
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
      targets = [...targets, { id: `example:capability:${id}`, title: 'Report Publishing', type: 'capability', typeLabel: 'Capability', packageTitle: 'Audit', folder: 'audit', own: true }];
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
        },
      }), targets);
      const added = list('audit/patterns.yaml').at(-1)!;
      expect(Object.keys(added)).toEqual(['id', 'title', 'status', 'description', 'attributes']);
      expect(added.attributes).toEqual({ layer: 'data-records', parts: ['A list of findings'], watchFor: ['Findings that never close'] });
      expect(text('audit/patterns.yaml').startsWith(PATTERNS)).toBe(true);
    });

    it('writes a link from your capability on it, and from a library capability in links.yaml', () => {
      saveElement(root, pattern({ incoming: { candidate_pattern: ['example:capability:audit-planning', 'eb:capability:identity'] } }), targets);
      const [planning] = list('audit/capabilities.yaml');
      expect(planning.candidate_pattern).toEqual([{ to: 'case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }, 'findings-tracker']);
      expect(list('audit/links.yaml').at(-1)).toEqual({ from: 'eb:capability:identity', candidate_pattern: ['findings-tracker'] });
    });

    it('changes a pattern and keeps what’s around it', () => {
      const was = element('implementationPattern', 'audit-workbench');
      saveElement(root, { ...was, title: 'An audit workbench' }, targets);
      const after = text('audit/patterns.yaml');
      expect(after).toContain('title: An audit workbench');
      expect(after).toContain('sources: [ audit-standards ]');
      expect(after).toContain('note: Findings can open cases.');
      expect(after.startsWith('# Patterns, each with the links it holds.')).toBe(true);
    });

    it('takes an empty list away, since the format won’t have one', () => {
      const was = element('implementationPattern', 'audit-workbench');
      saveElement(root, { ...was, pattern: { ...was.pattern!, strengths: [] } }, targets);
      expect(list('audit/patterns.yaml')[0].attributes).not.toHaveProperty('strengths');
    });


    it('adds the package a need reaches', () => {
      saveElement(root, pattern({ package: 'offerings', links: { depends_on: [{ to: 'eb:implementationPattern:case-platform', note: 'Runs on it.' }], works_with: [{ to: 'example:implementationPattern:audit-workbench' }] } }), targets);
      expect(list('offerings/patterns.yaml').at(-1)).toMatchObject({ depends_on: [{ to: 'eb:implementationPattern:case-platform', note: 'Runs on it.' }], works_with: ['example:implementationPattern:audit-workbench'] });
      expect((parse(text('offerings/package.yaml')) as { dependencies: string[] }).dependencies).toEqual(['common', 'audit']);
    });

    it('takes a solution on and off from the pattern’s form, writing it on the solution', () => {
      const was = element('implementationPattern', 'audit-workbench');
      saveElement(root, { ...was, incoming: { ...was.incoming, implements: ['example:solution:audit-workbench-built'] } }, targets);
      expect(list('audit/solutions.yaml')[0]).not.toHaveProperty('implements');
      expect(list('audit/solutions.yaml')[1].implements).toEqual(['audit-workbench']);
    });
  });

  describe('solutions', () => {
    it('adds a solution with its approach, what it implements, its statements, and a link', () => {
      saveElement(root, solution({ values: { approach: 'product', url: 'https://example.com/tracker', by: 'Acme', lastReviewedAt: '2026-11-05' }, pattern: { strengths: [' Quick to start ', ''] } }), targets);
      const added = list('audit/solutions.yaml').at(-1)!;
      expect(added).toEqual({
        id: 'the-offices-own-app',
        title: 'The office’s own app',
        approach: 'product',
        status: 'draft',
        url: 'https://example.com/tracker',
        by: 'Acme',
        lastReviewedAt: '2026-11-05',
        description: 'An app the office builds on its platform.',
        attributes: { strengths: ['Quick to start'] },
        implements: ['audit-workbench'],
      });
      expect(text('audit/solutions.yaml').startsWith(SOLUTIONS)).toBe(true);
    });

    it('leaves out attributes it has none of, and writes a need on the solution', () => {
      saveElement(root, solution({ links: { implements: [{ to: 'eb:implementationPattern:case-platform' }], depends_on: [{ to: 'example:implementationPattern:audit-workbench', note: 'Its findings.' }] } }), targets);
      const added = list('audit/solutions.yaml').at(-1)!;
      expect(added).not.toHaveProperty('attributes');
      expect(added).toMatchObject({ implements: ['eb:implementationPattern:case-platform'], depends_on: [{ to: 'audit-workbench', note: 'Its findings.' }] });
    });

    it('needs an approach and a pattern to implement, and a link that’s a link', () => {
      const save = (input: ElementFields) => () => saveElement(root, input, targets);
      expect(save(solution({ values: { approach: 'outsource' } }))).toThrow('Choose its approach.');
      expect(save(solution({ links: { implements: [] } }))).toThrow('at least one pattern it implements');
      expect(save(solution({ links: { implements: [{ to: 'example:capability:audit-planning' }] } }))).toThrow("can't go there");
      expect(save(solution({ values: { approach: 'build', url: 'example.com' } }))).toThrow('http://');
      expect(text('audit/solutions.yaml')).toBe(SOLUTIONS);
    });

    it('undoes a new pattern and everything its links touched', () => {
      const before = [text('audit/patterns.yaml'), text('audit/capabilities.yaml'), text('audit/links.yaml')];
      saveElement(root, pattern({ incoming: { candidate_pattern: ['example:capability:audit-planning', 'eb:capability:identity'] } }), targets).undo();
      expect([text('audit/patterns.yaml'), text('audit/capabilities.yaml'), text('audit/links.yaml')]).toEqual(before);
    });
  });

  describe('sources', () => {
    it('reads a package’s sources', () => {
      expect(readSources(root)).toEqual([{ package: 'audit', id: 'audit-standards', sourceId: 'src:audit-standards', packageId: 'com.example.audit', title: 'Government Auditing Standards', url: 'https://example.com/standards', kind: 'official-reference', publicationDate: '2024-02-01', lastReviewedAt: '2026-10-30', note: 'What an audit has to do.' }]);
    });

    it('uses the ID chosen for a new source', () => {
      expect(saveSource(root, source({ chosenId: 'charter' })).id).toBe('charter');
      expect(() => saveSource(root, source({ chosenId: 'charter' }))).toThrow('already in use');
      expect(() => saveSource(root, source({ chosenId: 'City Charter' }))).toThrow('won’t work as an ID');
    });

    it('adds a source, starting the file for a package with none, and undoes that', () => {
      expect(saveSource(root, source()).id).toBe('city-charter-article-5');
      expect(list('audit/sources.yaml').at(-1)).toEqual({ id: 'city-charter-article-5', title: 'City Charter, Article 5', url: 'https://example.com/charter', kind: 'official-reference', lastReviewedAt: '2026-11-04' });
      expect(text('audit/sources.yaml').startsWith(SOURCES)).toBe(true);
      const { undo } = saveSource(root, source({ package: 'offerings' }));
      expect(list('offerings/sources.yaml')).toHaveLength(1);
      undo();
      expect(existsSync(join(root, 'source', 'offerings', 'sources.yaml'))).toBe(false);
    });

    it('changes a source without changing its ID', () => {
      const [was] = readSources(root);
      saveSource(root, { ...was, title: 'Yellow Book', publicationDate: undefined, note: '' });
      expect(list('audit/sources.yaml')[0]).toEqual({ id: 'audit-standards', title: 'Yellow Book', url: 'https://example.com/standards', kind: 'official-reference', lastReviewedAt: '2026-10-30' });
    });

    it('cites sources on an element, and takes them off', () => {
      const was = element('outcome', 'findings-closed');
      expect(was.sources).toEqual([]);
      saveElement(root, { ...was, sources: ['audit-standards'] }, targets);
      expect(list('audit/outcomes.yaml')[1].sources).toEqual(['audit-standards']);
      saveElement(root, { ...element('outcome', 'findings-closed'), sources: [] }, targets);
      expect(list('audit/outcomes.yaml')[1]).not.toHaveProperty('sources');
    });

    it('leaves a citation written on its own as it is', () => {
      const path = join(root, 'source', 'audit', 'requirements.yaml');
      writeFileSync(path, REQUIREMENTS.replace('sources: [ audit-standards ]', 'sources: audit-standards'));
      saveElement(root, { ...element('requirement', 'publish-the-plan'), title: 'Changed' }, targets);
      expect(text('audit/requirements.yaml')).toContain('sources: audit-standards');
    });

    it('takes a source’s citations with it, on elements, measures, and links, and undoes that', () => {
      const path = join(root, 'source', 'audit', 'capabilities.yaml');
      writeFileSync(path, CAPABILITIES.replace('      note: Holds the plan once it’s approved.', '      note: Holds the plan once it’s approved.\n      sources: [ audit-standards ]'));
      const before = ['audit/sources.yaml', 'audit/capabilities.yaml', 'audit/outcomes.yaml', 'audit/requirements.yaml', 'audit/patterns.yaml'].map(text);
      const { undo } = deleteSource(root, 'audit', 'audit-standards');
      expect(list('audit/sources.yaml')).toEqual([]);
      const [planning] = list('audit/capabilities.yaml');
      expect(planning).not.toHaveProperty('sources');
      expect(planning.candidate_pattern).toEqual([{ to: 'case-platform', coverage: 'partial', note: 'Holds the plan once it’s approved.' }]);
      expect((list('audit/outcomes.yaml')[0].measures as Record<string, unknown>[])[0]).not.toHaveProperty('sources');
      expect(list('audit/requirements.yaml')[0]).not.toHaveProperty('sources');
      expect(list('audit/patterns.yaml')[0]).not.toHaveProperty('sources');
      undo();
      expect(['audit/sources.yaml', 'audit/capabilities.yaml', 'audit/outcomes.yaml', 'audit/requirements.yaml', 'audit/patterns.yaml'].map(text)).toEqual(before);
    });

    it('says what’s wrong with a source', () => {
      expect(() => saveSource(root, source({ title: ' ' }))).toThrow('Give it a title.');
      expect(() => saveSource(root, source({ url: 'nope' }))).toThrow('http://');
      expect(() => saveSource(root, source({ kind: 'nonsense' }))).toThrow('what kind of source');
      expect(() => saveSource(root, source({ lastReviewedAt: '' }))).toThrow('last checked');
      expect(() => saveSource(root, source({ publicationDate: 'soon' }))).toThrow('publication date');
      expect(() => saveSource(root, source({ id: 'nothing-here' }))).toThrow(EditError);
      expect(() => deleteSource(root, 'audit', 'nothing-here')).toThrow(EditError);
      expect(text('audit/sources.yaml')).toBe(SOURCES);
    });
  });

  describe('discovery', () => {
    it('reads sets, answers, and what they point to, as full IDs', () => {
      const [set] = readDiscovery(root, targets);
      expect(set).toMatchObject({ assessmentId: 'assessment:audit-results', packageId: 'com.example.audit', title: 'Audit results discovery' });
      expect(askedIn('priority-results')).toMatchObject({
        questionId: 'question:priority-results',
        options: [{ value: 'on-plan', label: 'The plan is carried out' }, { value: 'closed', label: 'Findings are closed' }],
        points: [
          { when: ['on-plan'], to: ['example:outcome:on-plan'], why: 'This effort is meant to advance it.' },
          { when: ['on-plan', 'closed'], to: ['example:measure:plan-completed', 'eb:capability:records-management'], why: 'Either one needs it.' },
        ],
      });
      expect(targets.find((t) => t.id === 'example:measure:plan-completed')).toMatchObject({ title: 'Share of the plan completed', type: 'measure', typeLabel: 'Measure', folder: 'audit' });
    });

    it('adds a question to a set, and leaves the others as they were', () => {
      expect(saveQuestion(root, question(), targets)).toMatchObject({ id: 'how-does-the-office-plan-its-audits', set: 'audit-results' });
      expect(text('audit/discovery.yaml').startsWith(DISCOVERY)).toBe(true);
      expect(askedIn('how-does-the-office-plan-its-audits')).toMatchObject({ prompt: 'How does the office plan its audits?', kind: 'text', options: [], points: [] });
    });

    it('gives new answers values from their words, and turns pointers’ keys into them', () => {
      saveQuestion(root, question({
        prompt: 'How are findings tracked?',
        kind: 'single-choice',
        options: [{ key: 'new-1', label: 'In a spreadsheet' }, { key: 'new-2', label: 'In a tracking system' }],
        points: [{ when: ['new-1'], to: ['example:capability:audit-planning', 'eb:capability:request-intake'], why: 'A spreadsheet may not hold up.' }],
      }), targets);
      const written = (list('audit/discovery.yaml')[0].questions as Record<string, unknown>[]).at(-1)!;
      expect(written.options).toEqual([{ 'in-a-spreadsheet': 'In a spreadsheet' }, { 'in-a-tracking-system': 'In a tracking system' }]);
      expect(written.points).toEqual([{ when: 'in-a-spreadsheet', to: ['capability:audit-planning', 'eb:capability:request-intake'], why: 'A spreadsheet may not hold up.' }]);
      expect((parse(text('audit/package.yaml')) as { dependencies: string[] }).dependencies).toEqual(['common', 'foia']);
    });

    it('keeps an answer’s value and what points at it when its words change', () => {
      const was = askedIn('priority-results');
      saveQuestion(root, { ...was, options: [{ value: 'on-plan', label: 'Audits happen as planned' }, was.options![1]] }, targets);
      const after = text('audit/discovery.yaml');
      expect(after).toContain('- on-plan: Audits happen as planned');
      expect(after).toContain('when: [ on-plan, closed ]');
      expect(after).toContain('to: [ measure:plan-completed, capability:records-management ]');
    });

    it('writes a yes-or-no answer so it stays text', () => {
      saveQuestion(root, question({ prompt: 'Is the plan public?', kind: 'boolean', points: [{ when: ['true'], to: ['example:outcome:on-plan'], why: 'It’s already open.' }] }), targets);
      expect(text('audit/discovery.yaml')).toContain('when: "true"');
    });

    it('takes answers and pointers away when a question stops having them', () => {
      saveQuestion(root, { ...askedIn('priority-results'), kind: 'text', options: [], points: [] }, targets);
      const [first] = list('audit/discovery.yaml')[0].questions as Record<string, unknown>[];
      expect(first).toEqual({ id: 'priority-results', prompt: 'Which of these results matter most?', kind: 'text' });
    });

    it('starts a set with its first question, in a package with no discovery yet', () => {
      const saved = saveQuestion(root, { package: 'offerings', newSet: { title: 'Getting started', description: 'For a first meeting.' }, prompt: 'What brought you here?', kind: 'text' }, targets);
      expect(saved).toMatchObject({ set: 'getting-started', id: 'what-brought-you-here' });
      expect(list('offerings/discovery.yaml')).toEqual([{ id: 'getting-started', title: 'Getting started', description: 'For a first meeting.', questions: [{ id: 'what-brought-you-here', prompt: 'What brought you here?', kind: 'text' }] }]);
      saved.undo();
      expect(existsSync(join(root, 'source', 'offerings', 'discovery.yaml'))).toBe(false);
    });

    it('changes a set’s title without touching its questions, and deletes a set', () => {
      saveSet(root, { package: 'audit', id: 'audit-results', title: 'Results', description: '' });
      expect(list('audit/discovery.yaml')[0]).toMatchObject({ id: 'audit-results', title: 'Results' });
      expect(list('audit/discovery.yaml')[0]).not.toHaveProperty('description');
      expect(list('audit/discovery.yaml')[0].questions).toHaveLength(2);
      deleteSet(root, 'audit', 'audit-results');
      expect(list('audit/discovery.yaml')).toEqual([]);
    });

    it('deletes a question, but not a set’s last one', () => {
      deleteQuestion(root, 'audit', 'audit-results', 'publishes-reports');
      expect(list('audit/discovery.yaml')[0].questions).toHaveLength(1);
      expect(() => deleteQuestion(root, 'audit', 'audit-results', 'priority-results')).toThrow('delete the set instead');
    });

    it('takes what answers say about a deleted element with it, and a pointer left with nothing', () => {
      deleteElement(root, 'audit', 'requirement', 'publish-the-plan', targets);
      deleteElement(root, 'audit', 'capability', 'audit-planning', targets);
      const [, second] = list('audit/discovery.yaml')[0].questions as Record<string, unknown>[];
      expect(second).not.toHaveProperty('points');
      expect(text('audit/discovery.yaml').startsWith('# Discovery question sets.')).toBe(true);
    });

    it('takes what answers say about an outcome’s measures with it too', () => {
      deleteElement(root, 'audit', 'outcome', 'on-plan', targets);
      const [first] = list('audit/discovery.yaml')[0].questions as { points: unknown[] }[];
      expect(first.points).toEqual([{ when: ['on-plan', 'closed'], to: ['capability:records-management'], why: 'Either one needs it.' }]);
    });

    it('uses the ID chosen for a new question', () => {
      expect(saveQuestion(root, question({ chosenId: 'audit-planning-approach' }), targets).id).toBe('audit-planning-approach');
      expect(() => saveQuestion(root, question({ chosenId: 'audit-planning-approach' }), targets)).toThrow('already in use');
    });

    it('says what’s wrong with a question, and writes nothing', () => {
      const save = (over: Partial<QuestionFields>) => () => saveQuestion(root, question(over), targets);
      expect(save({ prompt: ' ' })).toThrow('Write the question.');
      expect(save({ kind: 'nonsense' })).toThrow('how it’s answered');
      expect(save({ kind: 'single-choice', options: [{ label: 'Only one' }] })).toThrow('at least two answers');
      expect(save({ kind: 'single-choice', options: [{ label: 'One' }, { label: ' ' }] })).toThrow('each answer some words');
      expect(save({ kind: 'boolean', points: [{ when: [], to: ['example:outcome:on-plan'], why: 'Why' }] })).toThrow('which answers');
      expect(save({ kind: 'boolean', points: [{ when: ['true'], to: [], why: 'Why' }] })).toThrow('points to');
      expect(save({ kind: 'boolean', points: [{ when: ['true'], to: ['example:outcome:on-plan'], why: ' ' }] })).toThrow('why each pointer');
      expect(save({ kind: 'boolean', points: [{ when: ['true'], to: ['example:outcome:gone'], why: 'Why' }] })).toThrow("Can't find");
      expect(save({ set: 'nothing-here' })).toThrow(EditError);
      expect(save({ set: undefined, newSet: { title: ' ' } })).toThrow('Give the set a title.');
      expect(save({ id: 'nothing-here' })).toThrow(EditError);
      expect(text('audit/discovery.yaml')).toBe(DISCOVERY);
    });
  });

  describe('new packages', () => {
    it('takes its publisher’s details from your first package, and builds on nothing yet', () => {
      writeFileSync(join(root, 'source', 'audit', 'package.yaml'), `schemaVersion: 0.6.0\n${AUDIT}publisher:\n  name: Acme\n  url: https://example.com\nlicense: MIT\ndomain: public-sector\n`);
      const { name, undo } = addPackage(root, { title: 'Our Services', description: 'What we offer.' });
      expect(name).toBe('our-services');
      expect(parse(text('our-services/package.yaml'))).toEqual({ schemaVersion: '0.6.0', packageId: 'com.example.our-services', idPrefix: 'example', title: 'Our Services', description: 'What we offer.', publisher: { name: 'Acme', url: 'https://example.com' }, license: 'MIT', domain: 'public-sector' });
      expect(text('our-services/package.yaml').startsWith('# The package itself.')).toBe(true);
      undo();
      expect(existsSync(join(root, 'source', 'our-services'))).toBe(false);
    });

    it('takes the library’s own prefix on the library, where it’s the one its packages have', () => {
      writeFileSync(join(root, 'source', 'audit', 'package.yaml'), `schemaVersion: 0.6.0\npackageId: org.enterprise-blueprints.audit\nidPrefix: eb\ntitle: Audit\npublisher:\n  name: Enterprise Blueprints\nlicense: MIT\ndomain: public-sector\n`);
      expect(addPackage(root, { title: 'Benefits', description: 'x' }).name).toBe('benefits');
      expect(parse(text('benefits/package.yaml'))).toMatchObject({ packageId: 'org.enterprise-blueprints.benefits', idPrefix: 'eb', license: 'MIT' });
    });

    it('uses the ID chosen for a package as its folder and the end of its package ID', () => {
      writeFileSync(join(root, 'source', 'audit', 'package.yaml'), `schemaVersion: 0.6.0\n${AUDIT}publisher:\n  name: Acme\n  url: https://example.com\nlicense: MIT\ndomain: public-sector\n`);
      expect(addPackage(root, { title: 'Benefits and Eligibility', chosenId: 'city-benefits', description: 'x' }).name).toBe('city-benefits');
      expect(parse(text('city-benefits/package.yaml')).packageId).toMatch(/\.city-benefits$/);
      expect(() => addPackage(root, { title: 'Another', chosenId: 'city-benefits', description: 'x' })).toThrow('already in use');
    });

    it('won’t take a folder name your packages or the library’s have', () => {
      writeFileSync(join(root, 'source', 'audit', 'package.yaml'), `schemaVersion: 0.6.0\n${AUDIT}`);
      expect(addPackage(root, { title: 'Common', description: 'x', publisher: 'Acme' }).name).toBe('common-2');
      expect(addPackage(root, { title: 'Audit', description: 'x', publisher: 'Acme' }).name).toBe('audit-2');
    });

    it('asks your first package who you are, on the newest schema', () => {
      rmSync(join(root, 'source'), { recursive: true });
      mkdirSync(join(root, 'source'));
      mkdirSync(join(root, 'schemas'));
      for (const v of ['0.5.0', '0.10.0', '0.6.0']) writeFileSync(join(root, 'schemas', `blueprint-package-${v}.schema.json`), '{}');
      expect(() => addPackage(root, { title: 'First', description: 'x' })).toThrow('ID prefix');
      expect(() => addPackage(root, { title: 'First', description: 'x', prefix: 'eb', publisher: 'Acme' })).toThrow('library’s');
      expect(() => addPackage(root, { title: 'First', description: 'x', prefix: 'acme' })).toThrow('who publishes');
      addPackage(root, { title: 'First', description: 'x', prefix: 'acme', publisher: 'Acme County' });
      expect(parse(text('first/package.yaml'))).toMatchObject({ schemaVersion: '0.10.0', packageId: 'org.acme.first', idPrefix: 'acme', publisher: { name: 'Acme County' } });
    });

    it('says what’s missing', () => {
      expect(() => addPackage(root, { title: ' ', description: ' ' })).toThrow('Give it a title.\nGive it a description.');
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
      deleteElement(root, 'audit', 'requirement', 'publish-the-plan', targets);
      deleteElement(root, 'audit', 'capability', 'audit-planning', targets);
      expect(list('audit/capabilities.yaml')).toEqual([]);
      expect(list('offerings/resources.yaml').at(-1)!.helps_with).toEqual(['capability:records-management']);
    });

    it('leaves a mission’s outcomes in place', () => {
      deleteElement(root, 'audit', 'mission', 'local-audit', targets);
      expect(list('audit/missions.yaml')).toEqual([]);
      expect(list('audit/outcomes.yaml')).toHaveLength(2);
    });

    it('won’t leave a requirement with no capability', () => {
      expect(() => deleteElement(root, 'audit', 'capability', 'audit-planning', targets)).toThrow('“Publish the plan” belongs only to this');
      expect(text('audit/capabilities.yaml')).toBe(CAPABILITIES);
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
      saveElement(root, resource({ links: { helps_with: [{ to: id }, { to: 'eb:capability:identity' }] } }), targets);
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
    expect(newId('What’s the plan', [])).toBe('whats-the-plan');
  });

  it('cuts a long ID between words', () => {
    const id = newId('Benefits are paid on time, in the right amount, to the right person', []);
    expect(id).toBe('benefits-are-paid-on-time-in-the-right-amount-to-the-right');
    expect(newId('x'.repeat(70), [])).toHaveLength(60);
  });

  it('uses a chosen ID for something new, if it can', () => {
    expect(saveElement(root, resource({ title: 'A long title for a guide', chosenId: 'short-guide' }), targets).id).toBe('short-guide');
    expect(saveElement(root, resource({ title: 'Blank means the title', chosenId: ' ' }), targets).id).toBe('blank-means-the-title');
    expect(() => saveElement(root, resource({ chosenId: 'short-guide' }), targets)).toThrow('already in use');
    expect(() => saveElement(root, resource({ chosenId: 'Not An ID' }), targets)).toThrow('won’t work as an ID');
    expect(() => saveElement(root, resource({ chosenId: 'ends-with-' }), targets)).toThrow('won’t work as an ID');
    // An ID never changes, so a chosen one means nothing on something that has one.
    expect(saveElement(root, { ...element('resource', 'intake-assessment'), chosenId: 'other' }, targets).id).toBe('intake-assessment');
  });

  it('says what’s wrong with a form that isn’t finished, and writes nothing', () => {
    const save = (input: ElementFields) => () => saveElement(root, input, targets);
    const values = (over: Record<string, string>) => ({ values: { ...resource().values, ...over } });
    expect(save(resource({ title: ' ' }))).toThrow('Give it a title.');
    expect(save(resource(values({ kind: 'nonsense' })))).toThrow('Choose what kind');
    expect(save(resource(values({ url: 'not a link' })))).toThrow('http://');
    expect(save(resource({ links: { helps_with: [] } }))).toThrow('at least one');
    expect(save(resource({ links: { helps_with: [{ to: 'eb:capability:nothing' }] } }))).toThrow("Can't find");
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
    expect(save(pattern({ pattern: { layer: 'processing' } }))).toThrow('Choose its layer');
    expect(() => saveElement(root, { ...pattern(), id: 'audit-workbench', links: { works_with: [{ to: 'example:implementationPattern:audit-workbench' }] } }, targets)).toThrow('link to itself');
    expect(save({ ...resource(), package: '../outside' })).toThrow(EditError);
    expect(save({ ...resource(), type: 'measure' })).toThrow('doesn’t handle'.replace('’', "'"));
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
