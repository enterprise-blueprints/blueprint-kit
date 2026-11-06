// What the editor reads and writes. source/*.yaml stays the one place your
// content lives, so everything here edits those files in place, leaving their
// comments and the fields it doesn't know about as they are. The compiler and
// the validator decide whether the result is good, as they do for a hand edit.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, isMap, isScalar, isSeq, parse, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';
import { compareVersions } from '../src/lib/format.ts';
import { idFromTitle } from '../src/lib/format.ts';
import { componentTiers, elementTypes, exposures, groupings, hostings, patternLayers, predicates, sourceKinds, statuses } from '../src/lib/vocabulary.ts';

/** A link to an element, by its full ID, with what the link can say about itself. */
export interface Link {
  to: string;
  coverage?: 'partial';
  note?: string;
}

export interface MeasureFields {
  /** Absent on a new measure, which takes one from its title. */
  id?: string;
  title: string;
  description: string;
}

/** What a pattern and each of its solutions can say about themselves, one statement to an item. */
const STATEMENTS = ['strengths', 'fitsWhen', 'watchFor'] as const;

/**
 * What a pattern says about itself, which it holds in its attributes. A
 * solution holds the statements too, without a layer or parts.
 */
export interface PatternFields {
  layer?: string;
  parts?: string[];
  strengths?: string[];
  fitsWhen?: string[];
  watchFor?: string[];
}

/**
 * A solution's component as its form shows it. The key names it on the form,
 * its ID for one that's saved, so what it sends to can name a part that's new.
 */
export interface ComponentFields {
  key: string;
  id?: string;
  title: string;
  description?: string;
  tier: string;
  technology?: string;
  exposure?: string;
  /** The keys of the other parts it sends to. */
  sendsTo?: string[];
  /** The patterns, by full ID, it makes the solution's connection to: some of the solution's needs. */
  needs?: string[];
}

/** An element as the editor's form shows it. */
export interface ElementFields {
  /** The folder under source/ it's in. */
  package: string;
  type: string;
  title: string;
  description: string;
  status?: string;
  /** The ID for a new one, from its form. Without it, one comes from the title. */
  chosenId?: string;
  /** On a capability, what varies from one office to another. */
  applicabilityNotes?: string;
  /** Fields written on the element by name, such as kind, theme, stage, or url. */
  values?: Record<string, string>;
  /** A resource's other details, such as an edition. */
  details?: Record<string, string>;
  tagline?: string;
  principles?: string[];
  measures?: MeasureFields[];
  pattern?: PatternFields;
  /** A solution's components, since schema 0.8.0. */
  components?: ComponentFields[];
  /** The IDs of the sources it cites, from its own package's sources.yaml. */
  sources?: string[];
  /** What it links to, by predicate. */
  links?: Record<string, Link[]>;
  /** What links to it, by predicate, as full IDs. */
  incoming?: Record<string, string[]>;
}

export interface EditorElement extends ElementFields {
  id: string;
  /** Its full ID, as the pages know it. */
  elementId: string;
}

/** A reference a package cites. */
export interface SourceFields {
  /** The folder under source/ it's in. */
  package: string;
  /** Absent on a new source, which takes one from `chosenId` or its title. */
  id?: string;
  chosenId?: string;
  title: string;
  url: string;
  kind: string;
  publicationDate?: string;
  lastReviewedAt: string;
  note?: string;
}

export interface EditorSource extends SourceFields {
  id: string;
  /** Its ID as the pages know it, and its package's, which together say which source a page means. */
  sourceId: string;
  packageId: string;
}

/** The kinds of discovery question, in the words the pages use. */
export const questionKinds: Record<string, string> = {
  'single-choice': 'Choose one',
  'multiple-choice': 'Choose any that apply',
  boolean: 'Yes or no',
  number: 'A number',
  text: 'In their own words',
};
const CHOICE = ['single-choice', 'multiple-choice'];

/** One answer to a question. A new one takes its value from its label, and until then `key` stands for it. */
export interface AnswerFields {
  value?: string;
  key?: string;
  label: string;
}

/** Answers that point to elements, for one reason, by answer value or key, and full ID. */
export interface PointFields {
  when: string[];
  to: string[];
  why: string;
}

export interface QuestionFields {
  package: string;
  /** The ID of the set it's in. Absent when it starts a new one, which `newSet` describes. */
  set?: string;
  newSet?: { title: string; description?: string };
  id?: string;
  /** The ID for a new one, from its form. Without it, one comes from the question. */
  chosenId?: string;
  prompt: string;
  kind: string;
  options?: AnswerFields[];
  points?: PointFields[];
}

export interface EditorQuestion extends QuestionFields {
  set: string;
  id: string;
  questionId: string;
}

export interface SetFields {
  package: string;
  id: string;
  title: string;
  description?: string;
}

export interface EditorSet extends SetFields {
  assessmentId: string;
  packageId: string;
  questions: EditorQuestion[];
}

/** A new package. Its publisher's details come from your other packages, or from here if it's the first. */
export interface PackageFields {
  title: string;
  description: string;
  /** Its folder under source/. Without it, one comes from the title. */
  chosenId?: string;
  prefix?: string;
  publisher?: string;
}

/** Something an element can link to. */
export interface Target {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  packageTitle: string;
  /** The folder its package is in, under content/ or library/packages/, which is what a package.yaml depends on. */
  folder: string;
  /** Whether it's one of your own, rather than the library's. */
  own: boolean;
}

/** What each type's form holds: the fields written by name, in file order, and the links it edits each way. */
export const forms: Record<string, { values: string[]; links: string[]; incoming: string[] }> = {
  mission: { values: [], links: ['seeks'], incoming: [] },
  outcome: { values: ['theme'], links: [], incoming: ['seeks', 'contributes_to'] },
  capability: { values: ['stage'], links: ['contributes_to', 'candidate_pattern', 'satisfies'], incoming: [] },
  requirement: { values: ['kind'], links: [], incoming: ['satisfies'] },
  implementationPattern: { values: [], links: ['depends_on', 'works_with'], incoming: ['candidate_pattern', 'implements'] },
  solution: { values: ['approach', 'hostedBy', 'url', 'by', 'lastReviewedAt'], links: ['implements', 'depends_on'], incoming: [] },
  resource: { values: ['kind', 'url', 'by', 'lastReviewedAt'], links: ['helps_with'], incoming: [] },
};

/** A problem with what the form sent, in words for the person filling it in. */
export class EditError extends Error {}

type Raw = Record<string, unknown>;
type PackageFile = {
  packageId: string;
  title: string;
  elements: { id: string; type: string; title: string; status?: string; attributes?: Raw }[];
  relations?: { from: string; predicate: string; to: string }[];
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const asList = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const fileOf = (type: string) => `${elementTypes[type].section}.yaml`;
const keyOf = (id: string) => id.split(':').at(-1)!;

export const sourcePackages = (root: string) => folders(join(root, 'source'));

function packageMeta(root: string, name: string): Raw {
  return (parse(readFileSync(join(root, 'source', name, 'package.yaml'), 'utf8')) ?? {}) as Raw;
}

const prefixOf = (root: string, name: string) => String(packageMeta(root, name).idPrefix ?? 'eb');
const fullIdOf = (root: string, name: string, type: string, id: string) => `${prefixOf(root, name)}:${type}:${id}`;

/** The source packages, with the title each one's package.yaml gives it. */
export function packageList(root: string): { name: string; title: string }[] {
  return sourcePackages(root).map((name) => ({ name, title: String((packageMeta(root, name).title as string | undefined) ?? name) }));
}

/** Your own newest packages, and the library's at its release. */
function builtPackages(root: string, libraryRelease: string): { name: string; own: boolean; pkg: PackageFile }[] {
  const own = folders(join(root, 'content')).flatMap((name) => {
    const newest = folders(join(root, 'content', name)).sort(compareVersions).at(-1);
    return newest ? [{ name, own: true, path: join(root, 'content', name, newest, 'blueprint.json') }] : [];
  });
  const library = folders(join(root, 'library', 'packages')).map((name) => ({ name, own: false, path: join(root, 'library', 'packages', name, libraryRelease, 'blueprint.json') }));
  return [...own, ...library].filter((p) => existsSync(p.path)).map(({ name, own: isOwn, path }) => ({ name, own: isOwn, pkg: readJson<PackageFile>(path) }));
}

/** The capabilities that could bring a pattern into a mission, for saying what would fix a missing one. */
export function capabilitiesProviding(root: string, libraryRelease: string, patternId: string, targets: Target[]): Target[] {
  const ids = builtPackages(root, libraryRelease).flatMap(({ pkg }) => (pkg.relations ?? []).filter((r) => r.predicate === 'candidate_pattern' && r.to === patternId).map((r) => r.from));
  return [...new Set(ids)].flatMap((id) => targets.filter((t) => t.id === id));
}

/** Everything an element can link to: your own newest packages, and the library's at its release. */
export function readTargets(root: string, libraryRelease: string): Target[] {
  return builtPackages(root, libraryRelease)
    .flatMap(({ name, own: isOwn, pkg }) => {
      const target = (id: string, title: string, type: string): Target => ({ id, title, type, typeLabel: elementTypes[type].label, packageTitle: pkg.title, folder: name, own: isOwn });
      return pkg.elements
        .filter((e) => predicates.helps_with.to.includes(e.type) && e.status !== 'deprecated')
        .flatMap((e) => [
          target(e.id, e.title, e.type),
          // An outcome's measures aren't elements, but a discovery answer can point to one.
          ...(asList(e.attributes?.measures) as Raw[]).map((m) => target(`${e.id.split(':')[0]}:measure:${m.id}`, String(m.title), 'measure')),
        ]);
    });
}

/** "capability:records" → the full ID it means in this package, the way the compiler reads it. */
function fullId(to: string, packageName: string, targets: Target[]): string {
  if (to.split(':').length === 3) return to;
  const matches = targets.filter((t) => t.id.endsWith(`:${to}`));
  return (matches.find((t) => t.folder === packageName) ?? matches[0])?.id ?? to;
}

/** A link as written, with the type a bare key leaves out. */
function linkOf(entry: unknown, predicate: string, packageName: string, targets: Target[]): Link {
  const raw = (typeof entry === 'object' && entry !== null ? entry : { to: entry }) as Raw;
  const to = String(raw.to);
  return {
    to: fullId(to.includes(':') ? to : `${predicates[predicate].to[0]}:${to}`, packageName, targets),
    ...(raw.coverage ? { coverage: raw.coverage as 'partial' } : {}),
    ...(raw.note ? { note: String(raw.note) } : {}),
  };
}

function itemsIn(root: string, name: string, file: string): Raw[] {
  const path = join(root, 'source', name, file);
  return existsSync(path) ? ((parse(readFileSync(path, 'utf8')) ?? []) as Raw[]) : [];
}

/** What links to an element, among its own package's elements and in its links.yaml. */
function readIncoming(root: string, name: string, predicate: string, elementId: string, targets: Target[]): string[] {
  const points = (raw: Raw) => asList(raw[predicate]).some((entry) => linkOf(entry, predicate, name, targets).to === elementId);
  return [
    ...predicates[predicate].from.flatMap((type) => itemsIn(root, name, fileOf(type)).filter(points).map((raw) => fullIdOf(root, name, type, String(raw.id)))),
    ...itemsIn(root, name, 'links.yaml').filter(points).map((raw) => fullId(String(raw.from), name, targets)),
  ];
}

const statementsIn = (raw: Raw, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => raw[k] !== undefined).map((k) => [k, asList(raw[k]).map(String)]));

function patternFrom(attributes: Raw): PatternFields {
  return { layer: String(attributes.layer ?? ''), ...statementsIn(attributes, ['parts', ...STATEMENTS]) };
}

function elementFrom(root: string, name: string, type: string, raw: Raw, targets: Target[]): EditorElement {
  const form = forms[type];
  const id = String(raw.id);
  const elementId = fullIdOf(root, name, type, id);
  const attributes = (raw.attributes ?? {}) as Raw;
  return {
    package: name,
    type,
    id,
    elementId,
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    status: String(raw.status ?? 'reference'),
    values: Object.fromEntries(form.values.filter((v) => raw[v] !== undefined).map((v) => [v, String(raw[v])])),
    ...(type === 'resource' && raw.attributes ? { details: Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, String(v)])) } : {}),
    ...(type === 'capability' && raw.applicabilityNotes ? { applicabilityNotes: String(raw.applicabilityNotes) } : {}),
    ...(type === 'mission' ? { tagline: String(attributes.tagline ?? ''), principles: asList(attributes.principles).map(String) } : {}),
    ...(type === 'outcome' ? { measures: (asList(raw.measures) as Raw[]).map((m) => ({ id: String(m.id), title: String(m.title ?? ''), description: String(m.description ?? '') })) } : {}),
    ...(type === 'implementationPattern' ? { pattern: patternFrom(attributes) } : {}),
    ...(type === 'solution' ? { pattern: statementsIn(attributes, STATEMENTS), components: componentsFrom(raw, name, targets) } : {}),
    ...(type !== 'resource' ? { sources: asList(raw.sources).map(String) } : {}),
    links: Object.fromEntries(form.links.map((p) => [p, asList(raw[p]).map((entry) => linkOf(entry, p, name, targets))])),
    incoming: Object.fromEntries(form.incoming.map((p) => [p, readIncoming(root, name, p, elementId, targets)])),
  };
}

/** Every element of the types the editor handles under source/, as its form shows it. */
export function readElements(root: string, targets: Target[]): EditorElement[] {
  return sourcePackages(root).flatMap((name) =>
    Object.keys(forms).flatMap((type) => itemsIn(root, name, fileOf(type)).map((raw) => elementFrom(root, name, type, raw, targets))),
  );
}

/** A short ID from a title, such as "records-assessment", that isn't taken. */
export function newId(title: string, taken: string[]): string {
  const base = idFromTitle(title) || 'item';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The ID for something new: the one chosen on its form, if it can be used, or one from its title. */
function idFor(chosen: string | undefined, title: string, taken: string[]): string {
  const wanted = chosen?.trim();
  if (!wanted) return newId(title, taken);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(wanted)) throw new EditError(`“${wanted}” won’t work as an ID. Use lowercase letters and numbers, with hyphens between words.`);
  if (taken.includes(wanted)) throw new EditError(`The ID ${wanted} is already in use, so choose another.`);
  return wanted;
}

function check(input: ElementFields & { id?: string }, targets: Target[], before: Raw | undefined, current: Record<string, string[]>) {
  const { type } = input;
  const form = forms[type];
  const values = input.values ?? {};
  const problems: string[] = [];
  if (!input.title?.trim()) problems.push('Give it a title.');
  if (!input.description?.trim()) problems.push('Give it a description.');
  if (type !== 'resource' && !statuses[input.status ?? '']) problems.push('Choose a status.');
  if (type === 'resource') {
    if (!groupings.resource.groups[values.kind]) problems.push('Choose what kind of resource it is.');
    if (!/^https?:\/\/\S+$/.test(values.url ?? '')) problems.push('Give it a link that starts with http:// or https://.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.lastReviewedAt ?? '')) problems.push('Say when it was last checked, as a date.');
    if (!input.links?.helps_with?.length) problems.push('Choose at least one thing it helps with.');
    for (const key of Object.keys(input.details ?? {})) if (!/^[A-Za-z][\w-]*$/.test(key)) problems.push(`"${key}" won't work as a detail's name. Use letters and numbers, with no spaces.`);
  }
  if (type === 'outcome' && !groupings.outcome.groups[values.theme]) problems.push('Choose what the public gets from it.');
  if (type === 'capability') {
    if (!groupings.capability.groups[values.stage]) problems.push('Choose its stage of the work.');
    // Only a new one, in a package with outcomes: a shared capability gets its outcomes from other packages' links.yaml.
    const hasOutcomes = targets.some((t) => t.type === 'outcome' && t.folder === input.package);
    if (!before && hasOutcomes && !input.links?.contributes_to?.length) problems.push('Choose at least one outcome it contributes to.');
  }
  if (type === 'requirement') {
    if (!groupings.requirement.groups[values.kind]) problems.push('Choose what kind of requirement it is.');
    const capabilities = input.incoming?.satisfies ?? [];
    const added = capabilities.filter((id) => !current.satisfies.includes(id));
    if (!capabilities.length) problems.push('Choose the capability it belongs to.');
    else if (capabilities.length > 1 && added.length) problems.push('A requirement belongs to one capability.');
    for (const target of targets.filter((t) => added.includes(t.id) && t.folder !== input.package)) problems.push(`${target.title} is in another package, and a requirement belongs to a capability in its own.`);
  }
  if (type === 'implementationPattern' && !patternLayers[input.pattern?.layer ?? '']) problems.push('Choose its layer.');
  if (type === 'solution') {
    if (!groupings.solution.groups[values.approach]) problems.push('Choose its approach.');
    if (!input.links?.implements?.length) problems.push('Choose at least one pattern it implements.');
    if (values.url?.trim() && !/^https?:\/\/\S+$/.test(values.url.trim())) problems.push('Give it a link that starts with http:// or https://.');
    if (values.lastReviewedAt && !/^\d{4}-\d{2}-\d{2}$/.test(values.lastReviewedAt)) problems.push('Say when its link was last checked, as a date.');
    if (values.hostedBy && !hostings[values.hostedBy]) problems.push('Choose who runs it.');
    const needs = new Set((input.links?.depends_on ?? []).map((l) => l.to));
    for (const c of input.components ?? []) {
      if (!c.title?.trim()) problems.push('Give each component a title.');
      if (!componentTiers[c.tier]) problems.push(`Choose a tier for ${c.title?.trim() || 'each component'}.`);
      if (c.exposure && !exposures[c.exposure]) problems.push(`Choose whether ${c.title?.trim() || 'each component'} is public-facing.`);
      for (const n of c.needs ?? []) if (!needs.has(n)) problems.push(`${c.title?.trim() || 'A component'} connects to a pattern the solution doesn't need. Add it to Needs, or untick it.`);
    }
  }
  for (const m of input.measures ?? []) if (!m.title?.trim() || !m.description?.trim()) problems.push('Give each measure a title and a description.');

  // A link already there stays, even to something the form can't offer now, such as a deprecated item.
  const had = (predicate: string, id: string) => asList(before?.[predicate]).some((entry) => linkOf(entry, predicate, input.package, targets).to === id);
  for (const predicate of form.links) {
    for (const link of input.links?.[predicate] ?? []) {
      const target = targets.find((t) => t.id === link.to);
      if (!target) {
        if (!had(predicate, link.to)) problems.push(`Can't find ${link.to}.`);
      } else if (!predicates[predicate].to.includes(target.type)) problems.push(`${target.title} can't go there.`);
      else if (target.type === type && target.folder === input.package && keyOf(target.id) === input.id) problems.push('It can’t link to itself.');
    }
  }
  for (const predicate of form.incoming) {
    for (const id of input.incoming?.[predicate] ?? []) {
      const target = targets.find((t) => t.id === id);
      if (!target) {
        if (!current[predicate].includes(id)) problems.push(`Can't find ${id}.`);
      } else if (!predicates[predicate].from.includes(target.type)) problems.push(`${target.title} can't go there.`);
    }
  }
  if (problems.length) throw new EditError([...new Set(problems)].join('\n'));
}

/** The files one change touches, read once and written together, so it can be undone as a whole. */
class Edits {
  private files = new Map<string, { doc: Document; text: string | null }>();

  doc(path: string): Document {
    let file = this.files.get(path);
    if (!file) {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
      const doc = text === null ? new Document([]) : parseDocument(text);
      if (doc.errors.length) throw new EditError(`${path} has a YAML problem: ${doc.errors[0].message}`);
      file = { doc, text };
      this.files.set(path, file);
    }
    return file.doc;
  }

  list(path: string): { doc: Document; seq: YAMLSeq } {
    const doc = this.doc(path);
    if (!isSeq(doc.contents)) doc.contents = doc.createNode([]) as never;
    return { doc, seq: doc.contents as unknown as YAMLSeq };
  }

  /** Writes what changed, and returns how to put it all back. */
  commit(): () => void {
    const written: { path: string; text: string | null }[] = [];
    for (const [path, { doc, text }] of this.files) {
      const next = doc.toString({ lineWidth: 0 });
      if (next === text || (text === null && !(doc.contents as unknown as YAMLSeq).items?.length)) continue;
      writeFileSync(path, next);
      written.push({ path, text });
    }
    return () => {
      for (const { path, text } of written) text === null ? rmSync(path) : writeFileSync(path, text);
    };
  }
}

const itemIndex = (seq: YAMLSeq, id: string) => seq.items.findIndex((item) => isMap(item) && String(item.get('id')) === id);
const spaced = <T>(node: T, seq: YAMLSeq) => {
  if (seq.items.length) (node as { spaceBefore?: boolean }).spaceBefore = true;
  return node;
};

/** Sets a field to a value, or takes it away when it has none, leaving it alone when it's the same. */
function setField(doc: Document, map: YAMLMap, key: string, value: unknown) {
  const empty = value === undefined || value === '' || (typeof value === 'object' && value !== null && !Object.keys(value).length);
  if (empty) map.delete(key);
  else if (!same((map.toJSON() as Raw)[key], value)) map.set(key, doc.createNode(value));
}

/** A link as it's written: a bare key for your own package's element where the link can only mean one type. */
function writtenTo(link: Link, predicate: string, packageName: string, targets: Target[]): string {
  const target = targets.find((t) => t.id === link.to);
  if (target?.folder !== packageName) return link.to;
  return predicates[predicate].to.length === 1 ? keyOf(link.to) : `${target.type}:${keyOf(link.to)}`;
}

/** The links as written, keeping an existing link's own form and any fields the form doesn't show. */
function writtenLinks(existing: unknown[], links: Link[], predicate: string, packageName: string, targets: Target[]): unknown[] {
  const fields = ['coverage', 'note'] as const;
  return links.map((link) => {
    const before = existing.find((entry) => linkOf(entry, predicate, packageName, targets).to === link.to);
    const merged: Raw = typeof before === 'object' && before !== null ? { ...(before as Raw) } : { to: before ?? writtenTo(link, predicate, packageName, targets) };
    for (const field of fields) {
      if (link[field]) merged[field] = link[field];
      else delete merged[field];
    }
    if (same(merged, before)) return before;
    return Object.keys(merged).length === 1 ? merged.to : merged;
  });
}

/** Adds to a list of links on an item, in the style it's already written in. */
function addLink(doc: Document, map: YAMLMap, predicate: string, value: string) {
  const list = map.get(predicate, true);
  if (isSeq(list)) list.add(doc.createNode(value));
  else map.set(predicate, doc.createNode([...asList((map.toJSON() as Raw)[predicate]), value]));
}

/** Takes a link to an element out of an item, and the list too if that empties it. */
function removeLink(doc: Document, map: YAMLMap, predicate: string, isIt: (entry: unknown) => boolean): boolean {
  const list = map.get(predicate, true);
  const entries = asList((map.toJSON() as Raw)[predicate]);
  if (!entries.some(isIt)) return false;
  const left = entries.filter((entry) => !isIt(entry));
  if (!left.length) map.delete(predicate);
  else if (isSeq(list)) list.items = list.items.filter((_, i) => !isIt(entries[i]));
  else map.set(predicate, doc.createNode(left));
  return true;
}

const hasLinks = (map: YAMLMap) => Object.keys(predicates).some((p) => map.has(p));

function addIncoming(edits: Edits, root: string, name: string, predicate: string, from: Target, key: string, targets: Target[]) {
  if (from.folder === name) {
    const { doc, seq } = edits.list(join(root, 'source', name, fileOf(from.type)));
    const at = itemIndex(seq, keyOf(from.id));
    if (at >= 0) return addLink(doc, seq.items[at] as YAMLMap, predicate, key);
  }
  // Another package's element can't be changed here, so the link is written from this package's side.
  const { doc, seq } = edits.list(join(root, 'source', name, 'links.yaml'));
  const existing = seq.items.find((item) => isMap(item) && fullId(String(item.get('from')), name, targets) === from.id) as YAMLMap | undefined;
  if (existing) return addLink(doc, existing, predicate, key);
  const entry = doc.createNode({ from: from.id, [predicate]: [key] }) as YAMLMap;
  (entry.get(predicate, true) as unknown as YAMLSeq).flow = true;
  seq.add(spaced(entry, seq));
}

function removeIncoming(edits: Edits, root: string, name: string, predicate: string, from: Target, elementId: string, targets: Target[]) {
  const isIt = (entry: unknown) => linkOf(entry, predicate, name, targets).to === elementId;
  if (from.folder === name) {
    const { doc, seq } = edits.list(join(root, 'source', name, fileOf(from.type)));
    const at = itemIndex(seq, keyOf(from.id));
    if (at >= 0 && removeLink(doc, seq.items[at] as YAMLMap, predicate, isIt)) return;
  }
  const { doc, seq } = edits.list(join(root, 'source', name, 'links.yaml'));
  for (const item of [...seq.items]) {
    if (!isMap(item) || fullId(String(item.get('from')), name, targets) !== from.id) continue;
    if (removeLink(doc, item as YAMLMap, predicate, isIt) && !hasLinks(item as YAMLMap)) seq.items.splice(seq.items.indexOf(item), 1);
  }
}

/** The maps in a file that holds a list of them, as this change has them so far. */
function mapsIn(edits: Edits, path: string): YAMLMap[] {
  const { contents } = edits.doc(path);
  return isSeq(contents) ? (contents.items.filter(isMap) as YAMLMap[]) : [];
}

/** The maps in a list under a key of a map. */
const mapsUnder = (map: YAMLMap, key: string): YAMLMap[] => {
  const list = map.get(key, true);
  return isSeq(list) ? (list.items.filter(isMap) as YAMLMap[]) : [];
};

/**
 * A package that builds on one prefix can leave it off, as in capability:records.
 * Once it builds on a second, the compiler can't tell which is meant, so its
 * references to what it builds on are written out in full.
 */
function writeOutReferences(edits: Edits, root: string, name: string, prefix: string) {
  const itemsOf = (file: string) => mapsIn(edits, join(root, 'source', name, file));
  const elementFiles = Object.entries(elementTypes).map(([type, info]) => ({ type, file: `${info.section}.yaml` }));
  const own = new Set(
    elementFiles.flatMap(({ type, file }) =>
      itemsOf(file).flatMap((item) => [`${type}:${item.get('id')}`, ...(asList((item.toJSON() as Raw).measures) as Raw[]).map((m) => `measure:${m.id}`)]),
    ),
  );
  const writeOut = (node: unknown, type?: string) => {
    if (isSeq(node)) for (const item of node.items) writeOut(item, type);
    else if (isMap(node)) writeOut(node.get('to', true), type);
    else if (isScalar(node)) {
      const text = String(node.value);
      const written = text.includes(':') || !type ? text : `${type}:${text}`;
      if (written.split(':').length === 2 && !own.has(written)) node.value = `${prefix}:${written}`;
    }
  };
  const writeOutLinks = (item: YAMLMap) => {
    for (const [predicate, info] of Object.entries(predicates)) if (item.has(predicate)) writeOut(item.get(predicate, true), info.to.length === 1 ? info.to[0] : undefined);
  };
  for (const { file } of elementFiles) itemsOf(file).forEach(writeOutLinks);
  for (const item of itemsOf('links.yaml')) {
    writeOut(item.get('from', true));
    writeOutLinks(item);
  }
  for (const set of itemsOf('discovery.yaml')) {
    for (const question of mapsUnder(set, 'questions')) for (const group of mapsUnder(question, 'points')) writeOut(group.get('to', true));
  }
}

/** Adds the packages a change's links need to its package.yaml, the way you'd add them by hand. */
function addDependencies(edits: Edits, root: string, packageName: string, needed: string[], targets: Target[]) {
  const doc = edits.doc(join(root, 'source', packageName, 'package.yaml'));
  const have = asList((doc.toJS() as Raw).dependencies).map(String);
  const missing = [...new Set(needed)].filter((f) => f !== packageName && !have.includes(f));
  if (!missing.length) return;
  const list = doc.get('dependencies');
  if (isSeq(list)) for (const name of missing) list.add(doc.createNode(name));
  else doc.set('dependencies', doc.createNode(missing));

  const prefixes = (names: string[]) => [...new Set(names.map((f) => (sourcePackages(root).includes(f) ? prefixOf(root, f) : (targets.find((t) => t.folder === f)?.id.split(':')[0] ?? 'eb'))))];
  const before = prefixes(have);
  if (before.length === 1 && prefixes([...have, ...missing]).length > 1) writeOutReferences(edits, root, packageName, before[0]);
}

/** A mission's tagline and principles, set in its attributes beside whatever else is there. */
function setMissionAttributes(doc: Document, map: YAMLMap, input: ElementFields) {
  const principles = (input.principles ?? []).map((p) => p.trim()).filter(Boolean);
  if (!map.has('attributes') && !input.tagline?.trim() && !principles.length) return;
  if (!isMap(map.get('attributes', true))) map.set('attributes', doc.createNode({}));
  const attributes = map.get('attributes', true) as unknown as YAMLMap;
  setField(doc, attributes, 'tagline', input.tagline?.trim());
  setField(doc, attributes, 'principles', principles);
  if (!attributes.items.length) map.delete('attributes');
}

/** Measures in the form's order, each keeping its ID and anything the form doesn't show, such as its sources. */
function writtenMeasures(before: Raw | undefined, measures: MeasureFields[], taken: string[]) {
  const had = asList(before?.measures) as Raw[];
  const used = [...taken];
  return measures.map((m) => {
    const existing = had.find((x) => String(x.id) === m.id);
    if (existing) return { ...existing, title: m.title.trim(), description: m.description.trim() };
    const id = newId(m.title, used);
    used.push(id);
    return { id, title: m.title.trim(), description: m.description.trim() };
  });
}

const statementsOf = (list: string[] = []) => list.map((s) => s.trim()).filter(Boolean);

/** A solution's components as its form shows them, each need as a pattern's full ID. */
function componentsFrom(raw: Raw, packageName: string, targets: Target[]): ComponentFields[] {
  return (asList(raw.components) as Raw[]).map((c) => ({
    key: String(c.id),
    id: String(c.id),
    title: String(c.title ?? ''),
    ...(c.description ? { description: String(c.description) } : {}),
    tier: String(c.tier ?? ''),
    ...(c.technology ? { technology: String(c.technology) } : {}),
    ...(c.exposure ? { exposure: String(c.exposure) } : {}),
    sendsTo: asList(c.sendsTo).map(String),
    needs: asList(c.needs).map((n) => fullId(String(n).includes(':') ? String(n) : `implementationPattern:${n}`, packageName, targets)),
  }));
}

/**
 * Components in the form's order. A saved one keeps its ID; a new one gets one
 * from its title, unique among its solution's. What each sends to is written
 * by ID, and its needs as the solution's own are.
 */
function writtenComponents(before: Raw | undefined, components: ComponentFields[], packageName: string, targets: Target[]) {
  const had = new Set((asList(before?.components) as Raw[]).map((c) => String(c.id)));
  const used: string[] = [];
  const ids = new Map<string, string>();
  for (const c of components) {
    const id = c.id && had.has(c.id) ? c.id : newId(c.title, [...used, ...had]);
    used.push(id);
    ids.set(c.key, id);
  }
  return components.map((c) => {
    const sendsTo = (c.sendsTo ?? []).flatMap((k) => (ids.has(k) && k !== c.key ? [ids.get(k)!] : []));
    const needs = (c.needs ?? []).map((n) => writtenTo({ to: n }, 'depends_on', packageName, targets));
    return {
      id: ids.get(c.key)!,
      title: c.title.trim(),
      ...(c.description?.trim() ? { description: c.description.trim() } : {}),
      tier: c.tier,
      ...(c.technology?.trim() ? { technology: c.technology.trim() } : {}),
      ...(c.exposure ? { exposure: c.exposure } : {}),
      ...(sendsTo.length ? { sendsTo } : {}),
      ...(needs.length ? { needs } : {}),
    };
  });
}

/** A pattern's layer and statements, or a solution's statements, set in its attributes, which go when they're empty. */
function setPatternAttributes(doc: Document, map: YAMLMap, pattern: PatternFields, type: string) {
  if (!isMap(map.get('attributes', true))) map.set('attributes', doc.createNode({}));
  const attributes = map.get('attributes', true) as unknown as YAMLMap;
  if (type === 'implementationPattern') setField(doc, attributes, 'layer', pattern.layer);
  for (const key of type === 'implementationPattern' ? (['parts', ...STATEMENTS] as const) : STATEMENTS) setField(doc, attributes, key, statementsOf(pattern[key]));
  if (!attributes.items.length) map.delete('attributes');
}

/**
 * Adds an element, or changes the one with this ID, writing its file, any
 * other files its links reach, and package.yaml when they reach a new package.
 * An ID never changes once it's made, since tools link to it. Returns the ID,
 * and how to undo everything.
 */
export function saveElement(root: string, input: ElementFields & { id?: string }, targets: Target[]): { id: string; undo: () => void } {
  const { type } = input;
  const form = forms[type];
  if (!form) throw new EditError(`The editor doesn't handle ${type}.`);
  if (!sourcePackages(root).includes(input.package)) throw new EditError(`There's no package called ${input.package}.`);

  const edits = new Edits();
  const { doc, seq } = edits.list(join(root, 'source', input.package, fileOf(type)));
  const at = input.id ? itemIndex(seq, input.id) : -1;
  if (input.id && at < 0) throw new EditError(`There's no ${elementTypes[type].label.toLowerCase()} called ${input.id} in ${input.package}.`);
  const before = at >= 0 ? ((seq.items[at] as YAMLMap).toJSON() as Raw) : undefined;
  const current = Object.fromEntries(form.incoming.map((p) => [p, input.id ? readIncoming(root, input.package, p, fullIdOf(root, input.package, type, input.id), targets) : []]));
  check(input, targets, before, current);

  const id = input.id ?? idFor(input.chosenId, input.title, readElements(root, targets).filter((e) => e.type === type).map((e) => e.id));
  const elementId = fullIdOf(root, input.package, type, id);
  let map: YAMLMap;
  if (at >= 0) map = seq.items[at] as YAMLMap;
  else {
    map = spaced(doc.createNode({ id }) as YAMLMap, seq);
    seq.add(map);
  }

  const values = input.values ?? {};
  const [group, ...rest] = form.values;
  setField(doc, map, 'title', input.title.trim());
  if (group) setField(doc, map, group, values[group]);
  // Reference is what a missing status means, so a file that leaves it out stays that way.
  if (type !== 'resource' && !(input.status === 'reference' && before?.status === undefined)) setField(doc, map, 'status', input.status);
  for (const field of rest) setField(doc, map, field, values[field]?.trim());
  setField(doc, map, 'description', input.description.trim());
  if (type !== 'resource' && input.sources && !same(asList(before?.sources).map(String), input.sources)) setField(doc, map, 'sources', input.sources);

  // A form that doesn't send it leaves it, and one that sends it empty clears it.
  if (type === 'capability' && input.applicabilityNotes !== undefined) setField(doc, map, 'applicabilityNotes', input.applicabilityNotes.trim());

  if (type === 'resource') {
    const had = (before?.attributes ?? {}) as Raw;
    const details = Object.entries(input.details ?? {}).map(([k, v]) => [k, had[k] !== undefined && String(had[k]) === v ? had[k] : v]);
    setField(doc, map, 'attributes', Object.fromEntries(details));
  }
  if (type === 'mission') setMissionAttributes(doc, map, input);
  if (type === 'outcome') {
    const taken = itemsIn(root, input.package, fileOf('outcome')).flatMap((o) => (asList(o.measures) as Raw[]).map((m) => String(m.id)));
    setField(doc, map, 'measures', writtenMeasures(before, input.measures ?? [], taken));
  }
  if (type === 'implementationPattern' || type === 'solution') setPatternAttributes(doc, map, input.pattern ?? {}, type);
  if (type === 'solution' && input.components !== undefined) setField(doc, map, 'components', writtenComponents(before, input.components, input.package, targets));
  for (const predicate of form.links) {
    setField(doc, map, predicate, writtenLinks(asList(before?.[predicate]), input.links?.[predicate] ?? [], predicate, input.package, targets));
  }

  const targetOf = (from: string) => targets.find((t) => t.id === from);
  const reached = form.links.flatMap((p) => (input.links?.[p] ?? []).map((l) => targetOf(l.to)?.folder ?? input.package));
  for (const predicate of form.incoming) {
    const next = input.incoming?.[predicate] ?? [];
    const had = current[predicate];
    for (const from of next.filter((f) => !had.includes(f))) addIncoming(edits, root, input.package, predicate, targetOf(from)!, id, targets);
    for (const from of had.filter((f) => !next.includes(f))) {
      const target = targetOf(from);
      if (target) removeIncoming(edits, root, input.package, predicate, target, elementId, targets);
    }
    reached.push(...next.map((f) => targetOf(f)?.folder ?? input.package));
  }
  addDependencies(edits, root, input.package, reached, targets);
  return { id, undo: edits.commit() };
}

/**
 * Takes an element out of source/, with every link to it there. Published
 * versions keep it; the next release won't have it. A resource has to help with
 * something and a requirement has to belong to a capability, so one that has
 * only this is left for you to decide about. The validator still gets the last
 * word, on anything else that names it.
 */
export function deleteElement(root: string, packageName: string, type: string, id: string, targets: Target[]): { undo: () => void } {
  if (!forms[type]) throw new EditError(`The editor doesn't handle ${type}.`);
  if (!sourcePackages(root).includes(packageName)) throw new EditError(`There's no package called ${packageName}.`);
  const edits = new Edits();
  const { seq } = edits.list(join(root, 'source', packageName, fileOf(type)));
  const at = itemIndex(seq, id);
  if (at < 0) throw new EditError(`There's no ${elementTypes[type].label.toLowerCase()} called ${id} in ${packageName}.`);
  const measures = (asList(((seq.items[at] as YAMLMap).toJSON() as Raw).measures) as Raw[]).map((m) => fullIdOf(root, packageName, 'measure', String(m.id)));
  seq.items.splice(at, 1);

  const elementId = fullIdOf(root, packageName, type, id);
  const all = readElements(root, targets);
  const stranded = [
    ...all.filter((e) => e.type === 'resource' && e.links?.helps_with?.length && e.links.helps_with.every((l) => l.to === elementId)).map((e) => `“${e.title}” helps only with this, so change or delete that resource first.`),
    ...all.filter((e) => e.type === 'requirement' && e.incoming?.satisfies?.length && e.incoming.satisfies.every((c) => c === elementId)).map((e) => `“${e.title}” belongs only to this, so move or delete that requirement first.`),
  ];
  if (stranded.length) throw new EditError(stranded.join('\n'));
  const linksTo = Object.entries(predicates).filter(([, info]) => info.to.includes(type));
  for (const name of sourcePackages(root)) {
    for (const [predicate, info] of linksTo) {
      const isIt = (entry: unknown) => linkOf(entry, predicate, name, targets).to === elementId;
      for (const from of info.from) {
        if (!forms[from] || !existsSync(join(root, 'source', name, fileOf(from)))) continue;
        const { doc, seq: items } = edits.list(join(root, 'source', name, fileOf(from)));
        for (const item of items.items) if (isMap(item)) removeLink(doc, item as YAMLMap, predicate, isIt);
      }
    }
    removePoints(edits, join(root, 'source', name, 'discovery.yaml'), name, [elementId, ...measures], targets);
    const path = join(root, 'source', name, 'links.yaml');
    if (!existsSync(path)) continue;
    const { doc, seq: links } = edits.list(path);
    for (const item of [...links.items]) {
      if (!isMap(item)) continue;
      const map = item as YAMLMap;
      const fromIt = fullId(String(map.get('from')), name, targets) === elementId;
      for (const [predicate] of linksTo) removeLink(doc, map, predicate, (entry) => linkOf(entry, predicate, name, targets).to === elementId);
      if (fromIt || !hasLinks(map)) links.items.splice(links.items.indexOf(item), 1);
    }
  }
  return { undo: edits.commit() };
}

/** Takes what discovery answers say about these elements out of a discovery file, and any point left with nothing to point to. */
function removePoints(edits: Edits, path: string, name: string, ids: string[], targets: Target[]) {
  if (!existsSync(path)) return;
  const { doc } = edits.list(path);
  const isIt = (entry: unknown) => ids.includes(fullId(String(entry), name, targets));
  for (const set of mapsIn(edits, path)) {
    for (const question of mapsUnder(set, 'questions')) {
      const points = question.get('points', true);
      if (!isSeq(points)) continue;
      for (const group of mapsUnder(question, 'points')) if (removeLink(doc, group, 'to', isIt) && !group.has('to')) points.items.splice(points.items.indexOf(group), 1);
      if (!points.items.length) question.delete('points');
    }
  }
}

const needPackage = (root: string, name: string) => {
  if (!sourcePackages(root).includes(name)) throw new EditError(`There's no package called ${name}.`);
};

/** The sources in your packages, as the form shows them. */
export function readSources(root: string): EditorSource[] {
  return sourcePackages(root).flatMap((name) => {
    const packageId = String(packageMeta(root, name).packageId);
    return itemsIn(root, name, 'sources.yaml').map((raw) => ({
      package: name,
      id: String(raw.id),
      sourceId: `src:${raw.id}`,
      packageId,
      title: String(raw.title ?? ''),
      url: String(raw.url ?? ''),
      kind: String(raw.kind ?? ''),
      lastReviewedAt: String(raw.lastReviewedAt ?? ''),
      ...(raw.publicationDate ? { publicationDate: String(raw.publicationDate) } : {}),
      ...(raw.note ? { note: String(raw.note) } : {}),
    }));
  });
}

const isDate = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');

/** Adds a source, or changes the one with this ID, whose ID stays as it is, since what cites it names it. */
export function saveSource(root: string, input: SourceFields): { id: string; undo: () => void } {
  needPackage(root, input.package);
  const problems: string[] = [];
  if (!input.title?.trim()) problems.push('Give it a title.');
  if (!/^https?:\/\/\S+$/.test(input.url ?? '')) problems.push('Give it a link that starts with http:// or https://.');
  if (!sourceKinds[input.kind]) problems.push('Choose what kind of source it is.');
  if (!isDate(input.lastReviewedAt)) problems.push('Say when it was last checked, as a date.');
  if (input.publicationDate && !isDate(input.publicationDate)) problems.push('Give its publication date as a date, or leave it out.');
  if (problems.length) throw new EditError(problems.join('\n'));

  const edits = new Edits();
  const { doc, seq } = edits.list(join(root, 'source', input.package, 'sources.yaml'));
  const at = input.id ? itemIndex(seq, input.id) : -1;
  if (input.id && at < 0) throw new EditError(`There's no source called ${input.id} in ${input.package}.`);
  const id = input.id ?? idFor(input.chosenId, input.title, seq.items.filter(isMap).map((item) => String((item as YAMLMap).get('id'))));
  let map: YAMLMap;
  if (at >= 0) map = seq.items[at] as YAMLMap;
  else {
    map = spaced(doc.createNode({ id }) as YAMLMap, seq);
    seq.add(map);
  }
  setField(doc, map, 'title', input.title.trim());
  setField(doc, map, 'url', input.url.trim());
  setField(doc, map, 'kind', input.kind);
  setField(doc, map, 'publicationDate', input.publicationDate);
  setField(doc, map, 'lastReviewedAt', input.lastReviewedAt);
  setField(doc, map, 'note', input.note?.trim());
  return { id, undo: edits.commit() };
}

/** Takes a source out, and every citation of it in its package: on elements, their measures, and their links. */
export function deleteSource(root: string, packageName: string, id: string): { undo: () => void } {
  needPackage(root, packageName);
  const edits = new Edits();
  const path = (file: string) => join(root, 'source', packageName, file);
  const { seq } = edits.list(path('sources.yaml'));
  const at = itemIndex(seq, id);
  if (at < 0) throw new EditError(`There's no source called ${id} in ${packageName}.`);
  seq.items.splice(at, 1);

  const isIt = (entry: unknown) => String(entry) === id;
  for (const file of [...Object.values(elementTypes).map((info) => `${info.section}.yaml`), 'links.yaml']) {
    if (!existsSync(path(file))) continue;
    const { doc } = edits.list(path(file));
    for (const item of mapsIn(edits, path(file))) {
      removeLink(doc, item, 'sources', isIt);
      for (const measure of mapsUnder(item, 'measures')) removeLink(doc, measure, 'sources', isIt);
      for (const predicate of Object.keys(predicates)) for (const link of mapsUnder(item, predicate)) removeLink(doc, link, 'sources', isIt);
    }
  }
  return { undo: edits.commit() };
}

function questionFrom(name: string, set: string, raw: Raw, targets: Target[]): EditorQuestion {
  return {
    package: name,
    set,
    id: String(raw.id),
    questionId: `question:${raw.id}`,
    prompt: String(raw.prompt ?? ''),
    kind: String(raw.kind ?? ''),
    // Each option is written "value: label".
    options: (asList(raw.options) as Raw[]).map((o) => {
      const [value, label] = Object.entries(o)[0] ?? [];
      return { value: String(value), label: String(label) };
    }),
    points: (asList(raw.points) as Raw[]).map((p) => ({ when: asList(p.when).map(String), to: asList(p.to).map((to) => fullId(String(to), name, targets)), why: String(p.why ?? '') })),
  };
}

/** The discovery sets in your packages, as the forms show them. */
export function readDiscovery(root: string, targets: Target[]): EditorSet[] {
  return sourcePackages(root).flatMap((name) => {
    const packageId = String(packageMeta(root, name).packageId);
    return itemsIn(root, name, 'discovery.yaml').map((raw) => ({
      package: name,
      id: String(raw.id),
      assessmentId: `assessment:${raw.id}`,
      packageId,
      title: String(raw.title ?? ''),
      ...(raw.description ? { description: String(raw.description) } : {}),
      questions: (asList(raw.questions) as Raw[]).map((q) => questionFrom(name, String(raw.id), q, targets)),
    }));
  });
}

/** Changes a set's title and description. A new set comes with its first question, through saveQuestion. */
export function saveSet(root: string, input: SetFields): { id: string; undo: () => void } {
  needPackage(root, input.package);
  if (!input.title?.trim()) throw new EditError('Give it a title.');
  const edits = new Edits();
  const { doc, seq } = edits.list(join(root, 'source', input.package, 'discovery.yaml'));
  const at = itemIndex(seq, input.id);
  if (at < 0) throw new EditError(`There's no question set called ${input.id} in ${input.package}.`);
  const map = seq.items[at] as YAMLMap;
  setField(doc, map, 'title', input.title.trim());
  setField(doc, map, 'description', input.description?.trim());
  return { id: input.id, undo: edits.commit() };
}

export function deleteSet(root: string, packageName: string, id: string): { undo: () => void } {
  needPackage(root, packageName);
  const edits = new Edits();
  const { seq } = edits.list(join(root, 'source', packageName, 'discovery.yaml'));
  const at = itemIndex(seq, id);
  if (at < 0) throw new EditError(`There's no question set called ${id} in ${packageName}.`);
  seq.items.splice(at, 1);
  return { undo: edits.commit() };
}

function checkQuestion(input: QuestionFields, targets: Target[], had: string[]) {
  const problems: string[] = [];
  if (input.newSet && !input.newSet.title?.trim()) problems.push('Give the set a title.');
  if (!input.prompt?.trim()) problems.push('Write the question.');
  if (!questionKinds[input.kind]) problems.push('Choose how it’s answered.');
  const options = input.options ?? [];
  if (CHOICE.includes(input.kind)) {
    if (options.length < 2) problems.push('Give it at least two answers.');
    if (options.some((o) => !o.label?.trim())) problems.push('Give each answer some words.');
  }
  for (const point of input.points ?? []) {
    if (!point.when?.length) problems.push('Choose which answers each pointer is for.');
    if (!point.to?.length) problems.push('Choose what each pointer points to.');
    if (!point.why?.trim()) problems.push('Say why each pointer matters.');
    for (const to of point.to ?? []) if (!had.includes(to) && !targets.some((t) => t.id === to)) problems.push(`Can't find ${to}.`);
  }
  if (problems.length) throw new EditError([...new Set(problems)].join('\n'));
}

/** How a point names an element: by type and key in its own package, and in full otherwise. */
function writtenPoint(to: string, packageName: string, targets: Target[]) {
  const target = targets.find((t) => t.id === to);
  return target?.folder === packageName ? `${target.type}:${keyOf(to)}` : to;
}

const oneOrMany = <T>(list: T[]) => (list.length === 1 ? list[0] : list);

/**
 * Adds a question, or changes the one with this ID, along with a new set when
 * it starts one, since a set has to have a question. Answers keep their values
 * and questions their IDs, since what's been recorded names them.
 */
export function saveQuestion(root: string, input: QuestionFields, targets: Target[]): { id: string; set: string; undo: () => void } {
  needPackage(root, input.package);
  const edits = new Edits();
  const { doc, seq } = edits.list(join(root, 'source', input.package, 'discovery.yaml'));
  const at = input.set ? itemIndex(seq, input.set) : -1;
  if (input.set ? at < 0 : !input.newSet) throw new EditError(`There's no question set called ${input.set} in ${input.package}.`);

  const sets = seq.items.filter(isMap) as YAMLMap[];
  const inSet = at >= 0 ? mapsUnder(seq.items[at] as YAMLMap, 'questions') : [];
  const asked = input.id ? inSet.find((q) => String(q.get('id')) === input.id) : undefined;
  if (input.id && !asked) throw new EditError(`There's no question called ${input.id} in that set.`);
  const before = asked ? questionFrom(input.package, input.set!, asked.toJSON() as Raw, targets) : undefined;

  const choice = CHOICE.includes(input.kind);
  const answerable = choice || input.kind === 'boolean';
  const points = answerable ? (input.points ?? []) : [];
  checkQuestion({ ...input, points }, targets, (before?.points ?? []).flatMap((p) => p.to));

  // New answers take values from their words, and the pointers' keys become those values.
  const used = (before?.options ?? []).map((o) => o.value!);
  const valueOf = new Map<string, string>();
  const answers = (choice ? (input.options ?? []) : []).map((o) => {
    const value = o.value ?? newId(o.label, used);
    used.push(value);
    valueOf.set(o.key ?? value, value);
    return { value, label: o.label.trim() };
  });
  const pointing = points.map((p) => ({ when: p.when.map((w) => valueOf.get(w) ?? w), to: p.to, why: p.why.trim() }));

  let setMap: YAMLMap;
  let setId = input.set;
  if (at >= 0) setMap = seq.items[at] as YAMLMap;
  else {
    setId = newId(input.newSet!.title, sets.map((s) => String(s.get('id'))));
    const description = input.newSet!.description?.trim();
    setMap = spaced(doc.createNode({ id: setId, title: input.newSet!.title.trim(), ...(description ? { description } : {}), questions: [] }) as YAMLMap, seq);
    seq.add(setMap);
  }
  const id = input.id ?? idFor(input.chosenId, input.prompt, sets.flatMap((s) => mapsUnder(s, 'questions').map((q) => String(q.get('id')))));
  let map: YAMLMap;
  if (asked) map = asked;
  else {
    map = doc.createNode({ id }) as YAMLMap;
    (setMap.get('questions', true) as unknown as YAMLSeq).add(map);
  }
  setField(doc, map, 'prompt', input.prompt.trim());
  setField(doc, map, 'kind', input.kind);
  if (!same(before?.options ?? [], answers)) setField(doc, map, 'options', answers.map((a) => ({ [a.value]: a.label })));
  if (!same(before?.points ?? [], pointing)) {
    setField(doc, map, 'points', pointing.map((p) => ({ when: oneOrMany(p.when), to: oneOrMany(p.to.map((to) => writtenPoint(to, input.package, targets))), why: p.why })));
  }
  addDependencies(edits, root, input.package, pointing.flatMap((p) => p.to.map((to) => targets.find((t) => t.id === to)?.folder ?? input.package)), targets);
  return { id, set: setId!, undo: edits.commit() };
}

export function deleteQuestion(root: string, packageName: string, set: string, id: string): { undo: () => void } {
  needPackage(root, packageName);
  const edits = new Edits();
  const { seq } = edits.list(join(root, 'source', packageName, 'discovery.yaml'));
  const at = itemIndex(seq, set);
  if (at < 0) throw new EditError(`There's no question set called ${set} in ${packageName}.`);
  const questions = (seq.items[at] as YAMLMap).get('questions', true) as unknown as YAMLSeq;
  const index = itemIndex(questions, id);
  if (index < 0) throw new EditError(`There's no question called ${id} in that set.`);
  if (questions.items.length === 1) throw new EditError('A set needs at least one question, so delete the set instead.');
  questions.items.splice(index, 1);
  return { undo: edits.commit() };
}

const newestSchema = (root: string) =>
  readdirSync(join(root, 'schemas'))
    .filter((f) => f.startsWith('blueprint-package-'))
    .map((f) => f.replace(/^blueprint-package-|\.schema\.json$/g, ''))
    .sort(compareVersions)
    .at(-1);

/**
 * Starts a package: a folder under source/ with a package.yaml. It takes its
 * publisher's details from your first package, so your packages agree, or from
 * the form if it's your first. It builds on nothing until a link needs it to.
 */
export function addPackage(root: string, input: PackageFields): { name: string; undo: () => void } {
  const existing = sourcePackages(root);
  const template = existing.length ? packageMeta(root, existing[0]) : undefined;
  const prefix = String(template?.idPrefix ?? input.prefix ?? '').trim();
  const publisher = template?.publisher ?? { name: input.publisher?.trim() };
  const problems: string[] = [];
  if (!input.title?.trim()) problems.push('Give it a title.');
  if (!input.description?.trim()) problems.push('Give it a description.');
  if (!/^[a-z][a-z0-9]*$/.test(prefix)) problems.push('Give it an ID prefix of lowercase letters and numbers, such as acme.');
  else if (!template && prefix === 'eb') problems.push('The prefix eb is the library’s, so pick one of your own.');
  if (!(publisher as Raw).name) problems.push('Say who publishes it.');
  if (problems.length) throw new EditError(problems.join('\n'));

  // A folder named like one of the library's packages couldn't be told apart in dependencies.
  const name = idFor(input.chosenId, input.title, [...existing, ...folders(join(root, 'library', 'packages'))]);
  const doc = new Document({
    schemaVersion: template?.schemaVersion ?? newestSchema(root),
    packageId: template ? String(template.packageId).replace(/[^.]+$/, name) : `org.${prefix}.${name}`,
    idPrefix: prefix,
    title: input.title.trim(),
    description: input.description.trim(),
    publisher,
    license: template?.license ?? 'CC-BY-4.0',
    domain: template?.domain ?? 'public-sector',
  });
  doc.commentBefore = ' The package itself. Its version and date are set when it is built (pnpm content:build).';
  const folder = join(root, 'source', name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.yaml'), doc.toString({ lineWidth: 0 }));
  return { name, undo: () => rmSync(folder, { recursive: true }) };
}
