// What the editor reads and writes. source/*.yaml stays the one place your
// content lives, so everything here edits those files in place, leaving their
// comments and the fields it doesn't know about as they are. The compiler and
// the validator decide whether the result is good, as they do for a hand edit.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, isMap, isSeq, parse, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';
import { compareVersions } from '../src/lib/format.ts';
import { elementTypes, predicates, resourceKinds } from '../src/lib/vocabulary.ts';

/** What a resource helps with: an element's full ID, and one of a pattern's ways or a note, if it has them. */
export interface Link {
  to: string;
  way?: string;
  note?: string;
}

/** A resource as the editor's form shows it. */
export interface ResourceFields {
  title: string;
  kind: string;
  url: string;
  by?: string;
  lastReviewedAt: string;
  description: string;
  attributes?: Record<string, string>;
  links: Link[];
}

export interface EditorResource extends ResourceFields {
  /** The folder under source/ it's in. */
  package: string;
  id: string;
  /** Its full ID, as the pages know it. */
  elementId: string;
}

/** Something a resource can help with. */
export interface Target {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  packageTitle: string;
  /** The folder its package is in, under content/ or library/packages/, which is what a package.yaml depends on. */
  folder: string;
  ways: { id: string; title: string }[];
}

/** A problem with what the form sent, in words for the person filling it in. */
export class EditError extends Error {}

type Raw = Record<string, unknown>;
type PackageFile = { packageId: string; title: string; elements: { id: string; type: string; title: string; status?: string; attributes?: Raw }[] };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const write = (doc: Document) => doc.toString({ lineWidth: 0 });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const sourcePackages = (root: string) => folders(join(root, 'source'));

/** The source packages, with the title each one's package.yaml gives it. */
export function packageList(root: string): { name: string; title: string }[] {
  return sourcePackages(root).map((name) => ({ name, title: String((packageMeta(root, name).title as string | undefined) ?? name) }));
}

function packageMeta(root: string, name: string): Raw {
  return (parse(readFileSync(join(root, 'source', name, 'package.yaml'), 'utf8')) ?? {}) as Raw;
}

/** Everything a resource can help with: your own newest packages, and the library's at its release. */
export function readTargets(root: string, libraryRelease: string): Target[] {
  const own = folders(join(root, 'content')).flatMap((name) => {
    const newest = folders(join(root, 'content', name)).sort(compareVersions).at(-1);
    return newest ? [{ name, path: join(root, 'content', name, newest, 'blueprint.json') }] : [];
  });
  const library = folders(join(root, 'library', 'packages')).map((name) => ({ name, path: join(root, 'library', 'packages', name, libraryRelease, 'blueprint.json') }));
  return [...own, ...library]
    .filter((p) => existsSync(p.path))
    .flatMap(({ name, path }) => {
      const pkg = readJson<PackageFile>(path);
      return pkg.elements
        .filter((e) => predicates.helps_with.to.includes(e.type) && e.status !== 'deprecated')
        .map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          typeLabel: elementTypes[e.type].label,
          packageTitle: pkg.title,
          folder: name,
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

const linkOf = (entry: unknown, packageName: string, targets: Target[]): Link => {
  const raw = (typeof entry === 'object' && entry !== null ? entry : { to: entry }) as Raw;
  return { to: fullId(String(raw.to), packageName, targets), ...(raw.way ? { way: String(raw.way) } : {}), ...(raw.note ? { note: String(raw.note) } : {}) };
};

const asList = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** Every resource under source/, as the form shows it. */
export function readResources(root: string, targets: Target[]): EditorResource[] {
  return sourcePackages(root).flatMap((name) => {
    const path = join(root, 'source', name, 'resources.yaml');
    if (!existsSync(path)) return [];
    const prefix = String(packageMeta(root, name).idPrefix ?? 'eb');
    return ((parse(readFileSync(path, 'utf8')) ?? []) as Raw[]).map((raw) => ({
      package: name,
      id: String(raw.id),
      elementId: `${prefix}:resource:${raw.id}`,
      title: String(raw.title ?? ''),
      kind: String(raw.kind ?? ''),
      url: String(raw.url ?? ''),
      ...(raw.by ? { by: String(raw.by) } : {}),
      lastReviewedAt: String(raw.lastReviewedAt ?? ''),
      description: String(raw.description ?? ''),
      ...(raw.attributes ? { attributes: Object.fromEntries(Object.entries(raw.attributes as Raw).map(([k, v]) => [k, String(v)])) } : {}),
      links: asList(raw.helps_with).map((entry) => linkOf(entry, name, targets)),
    }));
  });
}

/** A short ID from a title, such as "records-assessment", that no other resource here has. */
export function newId(title: string, taken: string[]): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'resource';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

function check(fields: ResourceFields, targets: Target[]) {
  const problems: string[] = [];
  if (!fields.title?.trim()) problems.push('Give it a title.');
  if (!fields.description?.trim()) problems.push('Give it a description.');
  if (!resourceKinds.groups[fields.kind]) problems.push('Choose what kind of resource it is.');
  if (!/^https?:\/\/\S+$/.test(fields.url ?? '')) problems.push('Give it a link that starts with http:// or https://.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.lastReviewedAt ?? '')) problems.push('Say when it was last checked, as a date.');
  if (!fields.links?.length) problems.push('Choose at least one thing it helps with.');
  for (const key of Object.keys(fields.attributes ?? {})) if (!/^[A-Za-z][\w-]*$/.test(key)) problems.push(`"${key}" won't work as a detail's name. Use letters and numbers, with no spaces.`);
  for (const link of fields.links ?? []) {
    const target = targets.find((t) => t.id === link.to);
    if (!target) problems.push(`Can't find ${link.to}.`);
    else if (link.way && !target.ways.some((w) => w.id === link.way)) problems.push(`${target.title} has no way called ${link.way}.`);
  }
  if (problems.length) throw new EditError(problems.join('\n'));
}

function resourcesDoc(path: string): { doc: Document; seq: YAMLSeq; text: string | null } {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const doc = text === null ? new Document([]) : parseDocument(text);
  if (doc.errors.length) throw new EditError(`${path} has a YAML problem: ${doc.errors[0].message}`);
  if (!isSeq(doc.contents)) doc.contents = doc.createNode([]) as never;
  return { doc, seq: doc.contents as unknown as YAMLSeq, text };
}

const itemIndex = (seq: YAMLSeq, id: string) => seq.items.findIndex((item) => isMap(item) && String(item.get('id')) === id);

/** Sets a field to a value, or takes it away when it has none, leaving it alone when it's the same. */
function setField(doc: Document, map: YAMLMap, key: string, value: unknown) {
  const empty = value === undefined || value === '' || (typeof value === 'object' && value !== null && !Object.keys(value).length);
  if (empty) map.delete(key);
  else if (!same((map.toJSON() as Raw)[key], value)) map.set(key, doc.createNode(value));
}

/** The links as written, keeping an existing link's own form and any fields the form doesn't show. */
function writtenLinks(existing: unknown[], links: Link[], packageName: string, targets: Target[]): unknown[] {
  return links.map((link) => {
    const before = existing.find((entry) => linkOf(entry, packageName, targets).to === link.to);
    const extras = { ...(link.way ? { way: link.way } : {}), ...(link.note ? { note: link.note } : {}) };
    if (before === undefined) return Object.keys(extras).length ? { to: link.to, ...extras } : link.to;
    const raw = (typeof before === 'object' && before !== null ? before : { to: before }) as Raw;
    const { way: _way, note: _note, ...rest } = raw;
    const merged: Raw = { ...rest, ...extras };
    return Object.keys(merged).length === 1 ? merged.to : merged;
  });
}

/** Adds the packages a resource's links need to its package.yaml, the way you'd add them by hand. */
function addDependencies(root: string, packageName: string, links: Link[], targets: Target[]): (() => void) | undefined {
  const path = join(root, 'source', packageName, 'package.yaml');
  const text = readFileSync(path, 'utf8');
  const doc = parseDocument(text);
  const have = asList(doc.toJS().dependencies).map(String);
  const needed = [...new Set(links.map((l) => targets.find((t) => t.id === l.to)!.folder))].filter((f) => f !== packageName && !have.includes(f));
  if (!needed.length) return undefined;
  const list = doc.get('dependencies');
  if (isSeq(list)) for (const name of needed) list.add(doc.createNode(name));
  else doc.set('dependencies', doc.createNode(needed));
  writeFileSync(path, write(doc));
  return () => writeFileSync(path, text);
}

/**
 * Adds a resource, or changes the one with this ID, writing resources.yaml and,
 * when its links reach a new package, package.yaml. An ID never changes once
 * it's made, since tools link to it. Returns what it did, and how to undo it.
 */
export function saveResource(root: string, input: ResourceFields & { package: string; id?: string }, targets: Target[]): { id: string; undo: () => void } {
  if (!sourcePackages(root).includes(input.package)) throw new EditError(`There's no package called ${input.package}.`);
  check(input, targets);
  const path = join(root, 'source', input.package, 'resources.yaml');
  const { doc, seq, text } = resourcesDoc(path);
  const at = input.id ? itemIndex(seq, input.id) : -1;
  if (input.id && at < 0) throw new EditError(`There's no resource called ${input.id} in ${input.package}.`);
  const id = input.id ?? newId(input.title, readResources(root, targets).map((r) => r.id));

  let map: YAMLMap;
  if (at >= 0) map = seq.items[at] as YAMLMap;
  else {
    map = doc.createNode({ id }) as YAMLMap;
    if (seq.items.length) (map as unknown as { spaceBefore: boolean }).spaceBefore = true;
    seq.add(map);
  }
  const before = map.toJSON() as Raw;
  const attributes = Object.fromEntries(
    Object.entries(input.attributes ?? {}).map(([k, v]) => {
      const had = (before.attributes as Raw | undefined)?.[k];
      return [k, had !== undefined && String(had) === v ? had : v];
    }),
  );
  setField(doc, map, 'title', input.title.trim());
  setField(doc, map, 'kind', input.kind);
  setField(doc, map, 'url', input.url.trim());
  setField(doc, map, 'by', input.by?.trim());
  setField(doc, map, 'lastReviewedAt', input.lastReviewedAt);
  setField(doc, map, 'description', input.description.trim());
  setField(doc, map, 'attributes', attributes);
  setField(doc, map, 'helps_with', writtenLinks(asList(before.helps_with), input.links, input.package, targets));

  writeFileSync(path, write(doc));
  const undoDependencies = addDependencies(root, input.package, input.links, targets);
  return { id, undo: () => (undoDependencies?.(), text === null ? rmSync(path) : writeFileSync(path, text)) };
}

/** Takes a resource out of source/. Published versions keep it; the next release won't have it. */
export function deleteResource(root: string, packageName: string, id: string): { undo: () => void } {
  if (!sourcePackages(root).includes(packageName)) throw new EditError(`There's no package called ${packageName}.`);
  const path = join(root, 'source', packageName, 'resources.yaml');
  const { doc, seq, text } = resourcesDoc(path);
  const at = itemIndex(seq, id);
  if (at < 0) throw new EditError(`There's no resource called ${id} in ${packageName}.`);
  seq.items.splice(at, 1);
  writeFileSync(path, write(doc));
  return { undo: () => writeFileSync(path, text ?? '') };
}
