// The Enterprise Blueprints package format and its validation: JSON Schema
// first, then the reference checks a schema can't do. Schema 0.2.0 adds
// dependencies, so a package can build on another one's elements. Schema
// 0.3.0 gives patterns and solutions typed attributes, and lets a candidate
// pattern say it only partly covers a capability. Schema 0.4.0 gives every
// pattern its ways to source it, and makes a mission's patterns its
// architecture, with outcomes holding their measures. Schema 0.5.0 lets
// outcomes, capabilities, and requirements name a group that holds across
// missions. Schema 0.6.0 adds resources and what they help with, and gives
// each package a prefix for its element IDs, so packages from other
// publishers can build on the library's. Packages stay valid under the
// schema they were published with.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema010 from '../../schemas/blueprint-package-0.1.0.schema.json' with { type: 'json' };
import schema020 from '../../schemas/blueprint-package-0.2.0.schema.json' with { type: 'json' };
import schema030 from '../../schemas/blueprint-package-0.3.0.schema.json' with { type: 'json' };
import schema040 from '../../schemas/blueprint-package-0.4.0.schema.json' with { type: 'json' };
import schema050 from '../../schemas/blueprint-package-0.5.0.schema.json' with { type: 'json' };
import schema060 from '../../schemas/blueprint-package-0.6.0.schema.json' with { type: 'json' };
import { earlierLayers, elementTypes, libraryPrefix, patternApproaches, patternFields, patternLayers, predicates } from './vocabulary.ts';

export interface Source {
  id: string;
  title: string;
  url: string;
  kind: 'official-reference' | 'research' | 'background' | 'other';
  publicationDate?: string;
  lastReviewedAt?: string;
  note?: string;
}

export interface Element {
  id: string;
  type: string;
  title: string;
  description: string;
  status?: 'reference' | 'draft' | 'deprecated';
  replacedBy?: string;
  sourceIds?: string[];
  tags?: string[];
  jurisdictions?: string[];
  applicabilityNotes?: string;
  attributes?: Record<string, unknown>;
}

export interface Relation {
  id: string;
  from: string;
  predicate: string;
  to: string;
  /** For candidate_pattern, since schema 0.3.0: "partial" when the pattern covers only part of the capability. */
  coverage?: 'full' | 'partial';
  /** Since schema 0.4.0. For depends_on, the way that needs the other pattern; since schema 0.6.0, for helps_with, the way of the pattern the resource helps with. */
  way?: string;
  description?: string;
  sourceIds?: string[];
}

export interface QuestionOption {
  value: string;
  label: string;
}

/** An answer that points to an element worth exploring, and why. */
export interface CandidateMapping {
  answerValue: string;
  elementId: string;
  interpretation: string;
}

export interface Question {
  id: string;
  prompt: string;
  kind: 'single-choice' | 'multiple-choice' | 'text' | 'number' | 'boolean';
  options?: QuestionOption[];
  candidateMappings?: CandidateMapping[];
}

/** A set of discovery questions. */
export interface Assessment {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

/** A package this one builds on, pinned to a version. */
export interface Dependency {
  packageId: string;
  version: string;
}

export interface BlueprintPackage {
  schemaVersion: '0.1.0' | '0.2.0' | '0.3.0' | '0.4.0' | '0.5.0' | '0.6.0';
  packageId: string;
  /** Since schema 0.6.0: the first part of its element IDs. Before then, always "eb". */
  idPrefix?: string;
  version: string;
  title: string;
  description: string;
  publisher: { name: string; url?: string };
  license: string;
  publishedAt: string;
  domain: string;
  jurisdictions?: string[];
  tags?: string[];
  dependencies?: Dependency[];
  sources?: Source[];
  elements: Element[];
  relations: Relation[];
  assessments?: Assessment[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemas = {
  '0.1.0': ajv.compile<BlueprintPackage>(schema010),
  '0.2.0': ajv.compile<BlueprintPackage>(schema020),
  '0.3.0': ajv.compile<BlueprintPackage>(schema030),
  '0.4.0': ajv.compile<BlueprintPackage>(schema040),
  '0.5.0': ajv.compile<BlueprintPackage>(schema050),
  '0.6.0': ajv.compile<BlueprintPackage>(schema060),
};
export const schemaVersions = Object.keys(schemas) as (keyof typeof schemas)[];

/** Finds a package version this one depends on, if the library has it. */
export type Resolve = (packageId: string, version: string) => BlueprintPackage | undefined;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) (seen.has(id) ? repeated : seen).add(id);
  return [...repeated];
}

/**
 * Returns every problem found; an empty list means the package is valid.
 * Relations and discovery answers can point at elements of the packages it
 * depends on, which `resolve` looks up.
 */
export function validatePackage(data: unknown, resolve: Resolve = () => undefined): string[] {
  const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  const matchesSchema = schemas[version as keyof typeof schemas];
  if (!matchesSchema) return [`schema: schemaVersion should be one of ${schemaVersions.join(', ')}`];
  if (!matchesSchema(data)) {
    return (matchesSchema.errors ?? []).map(
      (e) => `schema: ${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`,
    );
  }
  const pkg = data;
  const errors: string[] = [];
  const sources = pkg.sources ?? [];

  // Elements this package can point at: its own, then its dependencies'.
  const reachable = new Map<string, Element>();
  const dependencyRelations: Relation[] = [];
  const dependencies = pkg.dependencies ?? [];
  for (const id of duplicates(dependencies.map((d) => d.packageId))) errors.push(`depends on ${id} more than once`);
  for (const d of dependencies) {
    if (d.packageId === pkg.packageId) {
      errors.push(`depends on itself`);
      continue;
    }
    const dependency = resolve(d.packageId, d.version);
    if (!dependency) errors.push(`depends on ${d.packageId} ${d.version}, which isn't in the library`);
    for (const e of dependency?.elements ?? []) reachable.set(e.id, e);
    dependencyRelations.push(...(dependency?.relations ?? []));
  }

  for (const id of duplicates(pkg.elements.map((e) => e.id))) errors.push(`duplicate element ID ${id}`);
  for (const id of duplicates(pkg.relations.map((r) => r.id))) errors.push(`duplicate relation ID ${id}`);
  for (const id of duplicates(sources.map((s) => s.id))) errors.push(`duplicate source ID ${id}`);

  const elementsById = new Map(pkg.elements.map((e) => [e.id, e]));
  const prefix = pkg.idPrefix ?? libraryPrefix;
  for (const e of pkg.elements) {
    if (reachable.has(e.id)) errors.push(`element ${e.id} is already defined in a package this one depends on`);
    reachable.set(e.id, e);
  }
  const sourceIds = new Set(sources.map((s) => s.id));

  for (const e of pkg.elements) {
    if (!elementTypes[e.type]) errors.push(`element ${e.id} has unknown type "${e.type}"`);
    // The ID names its package's prefix and its type, which keeps IDs and page URLs unique per type.
    if (!e.id.startsWith(`${prefix}:`)) errors.push(`element ${e.id} doesn't start with the package's prefix "${prefix}"`);
    else if (!e.id.startsWith(`${prefix}:${e.type}:`)) errors.push(`element ${e.id} doesn't match its type "${e.type}"`);
    if (e.type === 'resource' && BEFORE_060.has(pkg.schemaVersion)) errors.push(`element ${e.id}: resources are new in schema 0.6.0`);
    for (const s of e.sourceIds ?? []) {
      if (!sourceIds.has(s)) errors.push(`element ${e.id} cites unknown source ${s}`);
    }
    if (e.replacedBy && !elementsById.has(e.replacedBy)) {
      errors.push(`element ${e.id} is replaced by unknown element ${e.replacedBy}`);
    }
    if (e.type === 'implementationPattern' || e.type === 'solution') errors.push(...patternProblems(e));
    if (!BEFORE_040.has(pkg.schemaVersion)) {
      if (e.type === 'measure') errors.push(`element ${e.id}: since schema 0.4.0, a measure is part of its outcome`);
      for (const s of measuresIn(e).flatMap((m) => m.sourceIds ?? [])) if (!sourceIds.has(s)) errors.push(`a measure of ${e.id} cites unknown source ${s}`);
    }
  }
  // A measure's ID is unique in its package, since discovery answers and tools name it as <prefix>:measure:<id>.
  for (const id of duplicates(pkg.elements.flatMap((e) => measuresIn(e).map((m) => m.id)))) errors.push(`two measures have the ID ${id}`);

  const edges = new Set<string>();
  for (const r of pkg.relations) {
    const from = reachable.get(r.from);
    const to = reachable.get(r.to);
    if (!from) errors.push(`relation ${r.id} starts at unknown element ${r.from}`);
    if (!to) errors.push(`relation ${r.id} ends at unknown element ${r.to}`);
    // A package describes how its own elements connect, not how other packages' do.
    if (from && to && !elementsById.has(r.from) && !elementsById.has(r.to)) {
      errors.push(`relation ${r.id} only links elements from other packages`);
    }
    const predicate = predicates[r.predicate];
    if (!predicate) {
      errors.push(`relation ${r.id} uses unknown predicate "${r.predicate}"`);
    } else if (from && to && (!predicate.from.includes(from.type) || !predicate.to.includes(to.type))) {
      errors.push(`relation ${r.id}: "${r.predicate}" can't link ${from.type} ${r.from} to ${to.type} ${r.to}`);
    }
    for (const s of r.sourceIds ?? []) {
      if (!sourceIds.has(s)) errors.push(`relation ${r.id} cites unknown source ${s}`);
    }
    if (r.coverage && r.predicate !== 'candidate_pattern') errors.push(`relation ${r.id}: only a candidate pattern has coverage`);
    if (r.predicate === 'measured_by' && !BEFORE_040.has(pkg.schemaVersion)) errors.push(`relation ${r.id}: since schema 0.4.0, an outcome lists its measures instead`);
    if (r.from === r.to) errors.push(`relation ${r.id} links ${r.from} to itself`);
    if (r.predicate === 'helps_with' && BEFORE_060.has(pkg.schemaVersion)) errors.push(`relation ${r.id}: helps_with is new in schema 0.6.0`);
    if (r.way !== undefined) {
      // The way names one of a pattern's ways: the one that has the need, or the one the resource helps with.
      const pattern = r.predicate === 'depends_on' ? from : r.predicate === 'helps_with' ? to : undefined;
      if (r.predicate !== 'depends_on' && r.predicate !== 'helps_with') errors.push(`relation ${r.id}: only depends_on and helps_with name a way`);
      else if (pattern && !waysOf(pattern).includes(r.way)) errors.push(`relation ${r.id}: ${pattern.id} has no way "${r.way}"`);
    }
    const edge = `${r.from} ${r.predicate} ${r.to}`;
    if (edges.has(edge)) errors.push(`relation ${r.id} repeats ${edge}`);
    edges.add(edge);
  }

  errors.push(...missionProblems(pkg, [...dependencyRelations, ...pkg.relations]));
  // Discovery answers can point at an outcome's measure, by its ID: <prefix>:measure:<id>, with its outcome's prefix.
  const targets = new Map(reachable);
  for (const e of reachable.values()) for (const m of measuresIn(e)) targets.set(measureId(e, m.id), e);
  errors.push(...assessmentProblems(pkg.assessments ?? [], targets));
  return errors;
}

/** An outcome's measures, since schema 0.4.0. */
const measuresIn = (e: Element) => (e.type === 'outcome' && Array.isArray(e.attributes?.measures) ? (e.attributes.measures as { id: string; sourceIds?: string[] }[]) : []);
const waysOf = (e: Element) => (Array.isArray(e.attributes?.ways) ? (e.attributes.ways as { id: string }[]).map((w) => w.id) : []);
/** A measure's ID, as discovery answers and tools name it: its outcome's prefix, then measure and its own ID. */
export const measureId = (outcome: Pick<Element, 'id'>, id: string) => `${outcome.id.split(':')[0]}:measure:${id}`;
/** Schema versions before 0.6.0, which have no resources or ID prefixes of their own. */
const BEFORE_060 = new Set(['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0']);
/** Schema versions before 0.4.0, which have example solutions, and measures as elements of their own. */
const BEFORE_040 = new Set(['0.1.0', '0.2.0', '0.3.0']);
/**
 * Since schema 0.4.0, a mission's own patterns are its architecture, so a
 * package has no solutions. The patterns a mission's capabilities point to
 * include whatever they need, whichever way they're sourced.
 */
function missionProblems(pkg: BlueprintPackage, relations: Relation[]): string[] {
  if (BEFORE_040.has(pkg.schemaVersion)) return [];
  const errors: string[] = [];
  for (const e of pkg.elements) if (e.type === 'solution') errors.push(`element ${e.id}: since schema 0.4.0, a mission's patterns are its architecture, so there are no solutions`);
  for (const r of pkg.relations) {
    if (r.predicate === 'includes' || r.predicate === 'supports') errors.push(`relation ${r.id}: since schema 0.4.0, there are no solutions to link`);
  }
  const from = (predicate: string, ids: Set<string>, end: 'from' | 'to') =>
    new Set(relations.filter((r) => r.predicate === predicate && ids.has(end === 'from' ? r.from : r.to)).map((r) => (end === 'from' ? r.to : r.from)));
  for (const mission of pkg.elements.filter((e) => e.type === 'mission')) {
    const outcomes = from('seeks', new Set([mission.id]), 'from');
    const capabilities = from('contributes_to', outcomes, 'to');
    const patterns = from('candidate_pattern', capabilities, 'from');
    for (const pattern of patterns) {
      for (const need of relations.filter((r) => r.predicate === 'depends_on' && r.from === pattern && !r.way)) {
        if (!patterns.has(need.to)) errors.push(`mission ${mission.id}: ${pattern} needs ${need.to}, but none of the mission's capabilities points to it`);
      }
    }
  }
  return errors;
}

/**
 * A pattern's or solution's own fields, when it has them: a known approach
 * and role, and lists of short statements. Other attributes, such as those
 * in older packages, pass.
 */
function patternProblems(e: Element): string[] {
  const errors: string[] = [];
  const a = e.attributes ?? {};
  const what = e.type === 'solution' ? 'solution' : 'pattern';
  if ('approach' in a && !(typeof a.approach === 'string' && patternApproaches[a.approach])) {
    errors.push(`${what} ${e.id} has unknown approach ${JSON.stringify(a.approach)}`);
  }
  // A pattern's layer, called its role before schema 0.4.0.
  for (const key of ['layer', 'role']) {
    const value = a[key];
    if (key in a && !(typeof value === 'string' && (patternLayers[value] || earlierLayers[value]))) {
      errors.push(`${what} ${e.id} has unknown ${key} ${JSON.stringify(value)}`);
    }
  }
  const ways = waysOf(e);
  if (new Set(ways).size !== ways.length) errors.push(`${what} ${e.id} has two ways with the same ID`);
  for (const field of Object.keys(patternFields)) {
    if (!(field in a)) continue;
    const list = a[field];
    if (!Array.isArray(list) || !list.length || list.some((s) => typeof s !== 'string' || !s.trim())) {
      errors.push(`${what} ${e.id} needs ${field} to be a list of statements`);
    }
  }
  return errors;
}

const CHOICE = new Set(['single-choice', 'multiple-choice']);

/**
 * Question sets: IDs that name what they are, choices with distinct values,
 * and mappings that use a real answer and point at a real element. Text and
 * number answers are recorded as said, so they don't map to anything.
 */
function assessmentProblems(assessments: Assessment[], elementsById: Map<string, Element>): string[] {
  const errors: string[] = [];
  for (const id of duplicates(assessments.map((a) => a.id))) errors.push(`duplicate assessment ID ${id}`);
  const questions = assessments.flatMap((a) => a.questions);
  for (const id of duplicates(questions.map((q) => q.id))) errors.push(`duplicate question ID ${id}`);

  for (const a of assessments) {
    if (!/^assessment:[a-z0-9][a-z0-9-]*$/.test(a.id)) errors.push(`assessment ${a.id} should look like assessment:<name>`);
    if (!a.questions.length) errors.push(`assessment ${a.id} has no questions`);
  }
  for (const q of questions) {
    if (!/^question:[a-z0-9][a-z0-9-]*$/.test(q.id)) errors.push(`question ${q.id} should look like question:<name>`);
    const options = q.options ?? [];
    const choice = CHOICE.has(q.kind);
    if (choice && options.length < 2) errors.push(`question ${q.id} needs at least two options`);
    if (!choice && options.length) errors.push(`question ${q.id} is ${q.kind}, so it can't have options`);
    for (const v of duplicates(options.map((o) => o.value))) errors.push(`question ${q.id} repeats option ${v}`);

    const answers = choice ? new Set(options.map((o) => o.value)) : q.kind === 'boolean' ? new Set(['true', 'false']) : new Set<string>();
    for (const m of q.candidateMappings ?? []) {
      if (!answers.size) {
        errors.push(`question ${q.id} is ${q.kind}, so its answers can't map to elements`);
        break;
      }
      if (!answers.has(m.answerValue)) errors.push(`question ${q.id} maps answer "${m.answerValue}", which isn't one of its answers`);
      if (!elementsById.has(m.elementId)) errors.push(`question ${q.id} maps to unknown element ${m.elementId}`);
    }
    const pairs = (q.candidateMappings ?? []).map((m) => `${m.answerValue} → ${m.elementId}`);
    for (const pair of duplicates(pairs)) errors.push(`question ${q.id} repeats mapping ${pair}`);
  }
  return errors;
}
