// Your packages, and the library release they build on, as the pages show
// them. Every version of every package in content/ is checked against its
// schema and the library's packages it builds on, and any problem stops the
// build. Your own elements get pages here; the library's link to its site.

import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import kitText from '../kit.yaml?raw';
import vocabularyText from '../library/vocabulary.json?raw';
import { compareVersions } from './lib/format';
import { measureId, validatePackage, type BlueprintPackage, type Element, type Relation } from './lib/package';
import { href } from './lib/paths';
import { elementTypes, groupings, predicates, resourceKinds, type ElementTypeInfo } from './lib/vocabulary';

export const kit = parse(kitText) as {
  site: { title: string; description: string; accent?: string };
  library: { url: string; release: string };
};
export const libraryUrl = kit.library.url.endsWith('/') ? kit.library.url : `${kit.library.url}/`;
export const libraryRelease = String(kit.library.release);
const vocabulary = JSON.parse(vocabularyText) as { types: Record<string, { label: string; page: string }> };

interface PackageFile {
  /** Its folder, under content/ or library/packages/. */
  name: string;
  text: string;
  data: BlueprintPackage;
}

const read = (files: Record<string, string>, depth: number): PackageFile[] =>
  Object.entries(files).map(([path, text]) => ({ name: path.split('/')[depth], text, data: JSON.parse(text) as BlueprintPackage }));
const ownFiles = read(import.meta.glob<string>('/content/*/*/blueprint.json', { query: '?raw', import: 'default', eager: true }), 2);
const libraryFiles = read(import.meta.glob<string>('/library/packages/*/*/blueprint.json', { query: '?raw', import: 'default', eager: true }), 3);

function load() {
  const all = [...ownFiles, ...libraryFiles];
  const resolve = (packageId: string, version: string) => all.find((f) => f.data.packageId === packageId && f.data.version === version)?.data;
  const errors = ownFiles.flatMap((f) => validatePackage(f.data, resolve).map((p) => `content/${f.name}/${f.data.version}: ${p}`));
  for (const f of ownFiles) if ((f.data.idPrefix ?? 'eb') === 'eb') errors.push(`content/${f.name}/${f.data.version}: the "eb" prefix is the library's, so name an idPrefix of your own`);
  if (!ownFiles.length) errors.push('no packages under content/. Run pnpm content:build.');
  if (errors.length) throw new Error(`Package validation failed:\n  ${errors.join('\n  ')}`);
  const release = ownFiles.map((f) => f.data.version).sort(compareVersions).at(-1)!;
  return { release, current: ownFiles.filter((f) => f.data.version === release) };
}

const loaded = load();
/** Your release: the version every current package has. */
export const release = loaded.release;
export const packages = loaded.current.map((f) => f.data);

/** Every package version you publish, with its digest, newest last. */
export const published = ownFiles
  .map((f) => ({ ...f, path: `packages/${f.name}/${f.data.version}/blueprint.json`, sha256: createHash('sha256').update(f.text, 'utf8').digest('hex'), latest: f.data.version === release }))
  .sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.data.version, b.data.version));
export const downloadUrl = (pkg: BlueprintPackage) => href(published.find((p) => p.data === pkg)!.path);

export interface KitElement extends Element {
  package: BlueprintPackage;
  typeInfo: ElementTypeInfo;
  slug: string;
  url: string;
}

export const elements: KitElement[] = packages.flatMap((pkg) =>
  pkg.elements.map((e) => {
    const typeInfo = elementTypes[e.type];
    const slug = e.id.split(':')[2];
    return { ...e, package: pkg, typeInfo, slug, url: href(`${typeInfo.section}/${slug}/`) };
  }),
);
const relations: Relation[] = packages.flatMap((p) => p.relations);

// The library's elements at the release you build on, for names and links.
const libraryElements = new Map(
  libraryFiles.filter((f) => f.data.version === libraryRelease).flatMap((f) => f.data.elements.map((e) => [e.id, e] as const)),
);

/** Something a link points at: one of your elements, with its page here, or the library's, with its page there. */
export interface Target {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  url: string;
  fromLibrary: boolean;
}

export function target(id: string): Target {
  const own = elements.find((e) => e.id === id);
  if (own) return { id, title: own.title, type: own.type, typeLabel: own.typeInfo.label, url: own.url, fromLibrary: false };
  const e = libraryElements.get(id)!;
  const page = vocabulary.types[e.type]?.page;
  return {
    id,
    title: e.title,
    type: e.type,
    typeLabel: vocabulary.types[e.type]?.label ?? e.type,
    url: page ? new URL(page.replace('{key}', id.split(':')[2]), new URL('vocabulary.json', libraryUrl)).href : libraryUrl,
    fromLibrary: true,
  };
}

/** A pattern's way, by its ID, wherever the pattern is defined. */
function wayTitle(patternId: string, way: string): string | undefined {
  const pattern = elements.find((e) => e.id === patternId) ?? libraryElements.get(patternId);
  const ways = Array.isArray(pattern?.attributes?.ways) ? (pattern.attributes.ways as { id: string; title: string }[]) : [];
  return ways.find((w) => w.id === way)?.title;
}

export interface Link {
  target: Target;
  /** The way of a pattern the link is about, and a note the link carries. */
  way?: string;
  note?: string;
  partial: boolean;
}

/** An element's links, grouped under the library's headings, both ways. A resource's "helps with" comes first. */
export function linksOf(element: KitElement): { heading: string; links: Link[] }[] {
  const groups: { heading: string; links: Link[] }[] = [];
  for (const [name, info] of Object.entries(predicates)) {
    for (const direction of ['outgoing', 'incoming'] as const) {
      // Resources that help with an element are listed as resources.
      if (name === 'helps_with' && direction === 'incoming') continue;
      const rels = relations.filter((r) => r.predicate === name && (direction === 'outgoing' ? r.from : r.to) === element.id);
      if (!rels.length) continue;
      const links = rels.map((r) => ({
        target: target(direction === 'outgoing' ? r.to : r.from),
        ...(r.way && { way: wayTitle(r.to, r.way) ?? r.way }),
        ...(r.description && { note: r.description }),
        partial: r.coverage === 'partial',
      }));
      const group = { heading: info[direction], links };
      if (name === 'helps_with') groups.unshift(group);
      else groups.push(group);
    }
  }
  return groups;
}

export interface ResourceDetails {
  kind: string;
  kindLabel: string;
  url: string;
  by?: string;
  lastReviewedAt?: string;
  /** Anything else it says about itself, such as a service's typical length. */
  extra: [string, string][];
}

export function resourceDetails(resource: KitElement): ResourceDetails {
  const { kind, url, by, lastReviewedAt, ...extra } = resource.attributes ?? {};
  return {
    kind: String(kind),
    kindLabel: resourceKinds.groups[String(kind)]?.label ?? String(kind),
    url: String(url),
    ...(typeof by === 'string' && { by }),
    ...(typeof lastReviewedAt === 'string' && { lastReviewedAt }),
    extra: Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  };
}

export const resources = elements.filter((e) => e.type === 'resource');

/** Your resources, kind by kind, in the library's order of kinds. */
export function resourcesByKind(list = resources) {
  return Object.entries(resourceKinds.groups)
    .map(([id, g]) => ({ id, label: g.label, hint: g.hint, items: list.filter((r) => r.attributes?.kind === id) }))
    .filter((g) => g.items.length);
}

/** The resources that help with one of your elements. */
export const resourcesFor = (element: KitElement) => resources.filter((r) => relations.some((l) => l.from === r.id && l.predicate === 'helps_with' && l.to === element.id));

/** An outcome's measures, which are part of it. */
export function measuresOf(e: KitElement): { id: string; elementId: string; title: string; description: string }[] {
  const list = e.attributes?.measures;
  return Array.isArray(list) ? (list as { id: string; title: string; description: string }[]).map((m) => ({ ...m, elementId: measureId(e, m.id) })) : [];
}

/** The group an outcome, capability, requirement, or resource names, such as a capability's stage. */
export function groupLabel(e: KitElement): string | undefined {
  const g = groupings[e.type];
  const id = g && e.attributes?.[g.field];
  return typeof id === 'string' ? g.groups[id]?.label : undefined;
}

/** Your element types that have elements, resources first, then in the library's order. */
export function typesInUse(): [string, ElementTypeInfo][] {
  const used = Object.entries(elementTypes).filter(([type]) => elements.some((e) => e.type === type));
  return [...used.filter(([t]) => t === 'resource'), ...used.filter(([t]) => t !== 'resource')];
}
