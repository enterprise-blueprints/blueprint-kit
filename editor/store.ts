// What the editor reads and writes. source/*.yaml stays the one place your
// content lives, so everything here edits those files in place, leaving their
// comments and the fields it doesn't know about as they are. The compiler and
// the validator decide whether the result is good, as they do for a hand edit.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, isMap, isSeq, parse, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';
import { compareVersions } from '../src/lib/format.ts';
import { elementTypes, groupings, predicates, statuses } from '../src/lib/vocabulary.ts';

/** A link to an element, by its full ID, with what the link can say about itself. */
export interface Link {
  to: string;
  way?: string;
  coverage?: 'partial';
  note?: string;
}

export interface MeasureFields {
  /** Absent on a new measure, which takes one from its title. */
  id?: string;
  title: string;
  description: string;
}

/** An element as the editor's form shows it. */
export interface ElementFields {
  /** The folder under source/ it's in. */
  package: string;
  type: string;
  title: string;
  description: string;
  status?: string;
  /** Fields written on the element by name, such as kind, theme, stage, or url. */
  values?: Record<string, string>;
  /** A resource's other details, such as an edition. */
  details?: Record<string, string>;
  tagline?: string;
  principles?: string[];
  measures?: MeasureFields[];
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
  ways: { id: string; title: string }[];
}

/** What each type's form holds: the fields written by name, in file order, and the links it edits each way. */
export const forms: Record<string, { values: string[]; links: string[]; incoming: string[] }> = {
  mission: { values: [], links: ['seeks'], incoming: [] },
  outcome: { values: ['theme'], links: [], incoming: ['seeks', 'contributes_to'] },
  capability: { values: ['stage'], links: ['contributes_to', 'candidate_pattern', 'satisfies'], incoming: [] },
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
      return pkg.elements
        .filter((e) => predicates.helps_with.to.includes(e.type) && e.status !== 'deprecated')
        .map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          typeLabel: elementTypes[e.type].label,
          packageTitle: pkg.title,
          folder: name,
          own: isOwn,
          ways: Array.isArray(e.attributes?.ways) ? (e.attributes.ways as { id: string; title: string }[]).map((w) => ({ id: w.id, title: w.title })) : [],
        }));
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
    ...(raw.way ? { way: String(raw.way) } : {}),
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
    ...(type === 'mission' ? { tagline: String(attributes.tagline ?? ''), principles: asList(attributes.principles).map(String) } : {}),
    ...(type === 'outcome' ? { measures: (asList(raw.measures) as Raw[]).map((m) => ({ id: String(m.id), title: String(m.title ?? ''), description: String(m.description ?? '') })) } : {}),
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
  const base =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'item';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

function check(input: ElementFields, targets: Target[], before: Raw | undefined) {
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
    if (!input.links?.contributes_to?.length) problems.push('Choose at least one outcome it contributes to.');
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
      else if (link.way && !target.ways.some((w) => w.id === link.way)) problems.push(`${target.title} has no way called ${link.way}.`);
    }
  }
  for (const predicate of form.incoming) {
    for (const id of input.incoming?.[predicate] ?? []) {
      const target = targets.find((t) => t.id === id);
      if (!target) problems.push(`Can't find ${id}.`);
      else if (!predicates[predicate].from.includes(target.type)) problems.push(`${target.title} can't go there.`);
    }
  }
  if (problems.length) throw new EditError(problems.join('\n'));
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
  const fields = ['way', 'coverage', 'note'] as const;
  return links.map((link) => {
    const before = existing.find((entry) => linkOf(entry, predicate, packageName, targets).to === link.to);
    const merged: Raw = typeof before === 'object' && before !== null ? { ...(before as Raw) } : { to: before ?? writtenTo(link, predicate, packageName, targets) };
    for (const field of fields) {
      if (link[field]) merged[field] = link[field];
      else delete merged[field];
    }
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

/** Adds the packages a change's links need to its package.yaml, the way you'd add them by hand. */
function addDependencies(edits: Edits, root: string, packageName: string, needed: string[]) {
  const doc = edits.doc(join(root, 'source', packageName, 'package.yaml'));
  const have = asList((doc.toJS() as Raw).dependencies).map(String);
  const missing = [...new Set(needed)].filter((f) => f !== packageName && !have.includes(f));
  if (!missing.length) return;
  const list = doc.get('dependencies');
  if (isSeq(list)) for (const name of missing) list.add(doc.createNode(name));
  else doc.set('dependencies', doc.createNode(missing));
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
  check(input, targets, before);

  const id = input.id ?? newId(input.title, readElements(root, targets).filter((e) => e.type === type).map((e) => e.id));
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
  for (const predicate of form.links) {
    setField(doc, map, predicate, writtenLinks(asList(before?.[predicate]), input.links?.[predicate] ?? [], predicate, input.package, targets));
  }

  const targetOf = (from: string) => targets.find((t) => t.id === from);
  const reached = form.links.flatMap((p) => (input.links?.[p] ?? []).map((l) => targetOf(l.to)?.folder ?? input.package));
  for (const predicate of form.incoming) {
    const next = input.incoming?.[predicate] ?? [];
    const current = input.id ? readIncoming(root, input.package, predicate, elementId, targets) : [];
    for (const from of next.filter((f) => !current.includes(f))) addIncoming(edits, root, input.package, predicate, targetOf(from)!, id, targets);
    for (const from of current.filter((f) => !next.includes(f))) {
      const target = targetOf(from);
      if (target) removeIncoming(edits, root, input.package, predicate, target, elementId, targets);
    }
    reached.push(...next.map((f) => targetOf(f)!.folder));
  }
  addDependencies(edits, root, input.package, reached);
  return { id, undo: edits.commit() };
}

/**
 * Takes an element out of source/, with every link to it there. Published
 * versions keep it; the next release won't have it. The validator still gets
 * the last word, on anything else that names it, such as a discovery answer.
 */
export function deleteElement(root: string, packageName: string, type: string, id: string, targets: Target[]): { undo: () => void } {
  if (!forms[type]) throw new EditError(`The editor doesn't handle ${type}.`);
  if (!sourcePackages(root).includes(packageName)) throw new EditError(`There's no package called ${packageName}.`);
  const edits = new Edits();
  const { seq } = edits.list(join(root, 'source', packageName, fileOf(type)));
  const at = itemIndex(seq, id);
  if (at < 0) throw new EditError(`There's no ${elementTypes[type].label.toLowerCase()} called ${id} in ${packageName}.`);
  seq.items.splice(at, 1);

  const elementId = fullIdOf(root, packageName, type, id);
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
