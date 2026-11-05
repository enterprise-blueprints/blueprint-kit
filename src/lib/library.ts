// Loads the packages the pages show, validates them, and indexes them. A
// site's own packages are every version under content/<name>/<version>/, and
// the pages show its current release: the packages at the newest version,
// which build on each other at that version. Earlier versions stay published
// exactly as they were, and so do the versions of a package that was retired.
// A package can build on another, such as a mission package on the common
// one, and point at its elements.
//
// A publisher's site, made with the Blueprint Kit, also holds the library's
// packages under library/packages/, at the release its site config names. The
// library packages its own build on, and the ones those build on, are shown
// too, with pages under library/ that link to the library's own. Any
// validation problem in the site's own packages stops the build.

import { site } from '../site';
import { measureId, validatePackage, type Assessment, type BlueprintPackage, type Element, type Question, type Relation, type Source } from './package';
import { elementTypes, groupings, libraryPrefix, patternApproaches, patternFields, patternLayers, predicates, resourceKinds, type ElementTypeInfo } from './vocabulary';
import { href } from './paths';
import { compareVersions } from './format';
import type { SearchItem } from './search';

export interface LibraryElement extends Element {
  package: BlueprintPackage;
  typeInfo: ElementTypeInfo;
  slug: string;
  url: string;
  /** Its page on the library's site, for a library element on a publisher's site. */
  canonicalUrl?: string;
}

export interface RelationGroup {
  heading: string;
  /** Distinct notes on the relations in this group. */
  notes: string[];
  elements: LibraryElement[];
  /** What each link says, by the element at its other end: its note, and whether it covers only part of a capability. */
  links: Map<string, { note?: string; partial: boolean }>;
}

/** A package version as stored: its folder under content/, its exact text, and its data. */
export interface PackageFile {
  name: string;
  text: string;
  data: BlueprintPackage;
  /** True for a package in the current release, the version the pages show. */
  latest: boolean;
}

const glob = (files: Record<string, string>, root: string) =>
  Object.entries(files).map(([path, text]) => {
    const [name, version] = path.slice(root.length).split('/');
    return { path, name, version, text, data: JSON.parse(text) as BlueprintPackage };
  });
const ownFiles = glob(import.meta.glob<string>('/content/*/*/blueprint.json', { query: '?raw', import: 'default', eager: true }), '/content/');
// Only on a publisher's site, which syncs them from the library.
const upstreamFiles = glob(import.meta.glob<string>('/library/packages/*/*/blueprint.json', { query: '?raw', import: 'default', eager: true }), '/library/packages/');

/** The library a publisher's site builds on, with the address its pages and packages are under. */
export const upstream = site.upstream && { ...site.upstream, base: site.upstream.url.endsWith('/') ? site.upstream.url : `${site.upstream.url}/` };

function load(): { own: PackageFile[]; upstream: { name: string; data: BlueprintPackage }[]; builtOn: BlueprintPackage[] } {
  const errors: string[] = [];
  const loaded: Omit<PackageFile, 'latest'>[] = [];
  // Dependencies resolve against every package there is, valid or not; their own problems are reported on their own.
  const all = [...ownFiles, ...upstreamFiles];
  const resolve = (packageId: string, version: string) => all.find((p) => p.data.packageId === packageId && p.data.version === version)?.data;
  for (const { path, name, version, text, data } of ownFiles) {
    const problems = validatePackage(data, resolve);
    errors.push(...problems.map((p) => `${path}: ${p}`));
    if (problems.length) continue;
    if (data.version !== version) errors.push(`${path}: the folder says ${version} but the package says ${data.version}`);
    loaded.push({ name, text, data });
  }

  // Every version of a package lives in one folder, under one package ID.
  const folderOf = new Map<string, string>();
  for (const { name, data } of loaded) {
    const folder = folderOf.get(data.packageId);
    if (folder && folder !== name) errors.push(`package ${data.packageId} is in both content/${folder} and content/${name}`);
    folderOf.set(data.packageId, name);
  }
  const versions = new Map<string, Omit<PackageFile, 'latest'>[]>();
  for (const file of loaded) versions.set(file.name, [...(versions.get(file.name) ?? []), file]);
  for (const [name, list] of versions) {
    if (new Set(list.map((f) => f.data.packageId)).size > 1) errors.push(`content/${name} holds more than one package ID`);
    list.sort((a, b) => compareVersions(a.data.version, b.data.version));
  }

  // The pages show the current release, whose packages build on each other at its version.
  const release = loaded.map((f) => f.data.version).sort(compareVersions).at(-1);
  const current = [...versions.values()].map((list) => list.at(-1)!.data).filter((pkg) => pkg.version === release);
  for (const pkg of current) {
    for (const d of pkg.dependencies ?? []) {
      if (folderOf.has(d.packageId) && d.version !== release) errors.push(`${pkg.packageId} ${pkg.version} builds on ${d.packageId} ${d.version}, not on the release`);
    }
  }

  // The library's packages that the site's own build on, and the ones those build on.
  const shown: { name: string; data: BlueprintPackage }[] = [];
  const add = (packageId: string, version: string) => {
    const file = upstreamFiles.find((f) => f.data.packageId === packageId && f.data.version === version);
    if (!file || shown.some((s) => s.data === file.data)) return;
    shown.push(file);
    for (const d of file.data.dependencies ?? []) add(d.packageId, d.version);
  };
  for (const pkg of current) for (const d of pkg.dependencies ?? []) add(d.packageId, d.version);
  const builtOn = shown.map((s) => s.data);
  // The rest of the release, on a site that shows it all.
  if (site.upstream?.showAll) {
    for (const file of upstreamFiles) {
      if (file.data.version === site.upstream.release && !shown.some((s) => s.data.packageId === file.data.packageId)) shown.push(file);
    }
  }
  for (const pkg of current) {
    const prefix = pkg.idPrefix ?? libraryPrefix;
    if (shown.some((s) => (s.data.idPrefix ?? libraryPrefix) === prefix)) errors.push(`${pkg.packageId}: the "${prefix}" prefix is the library's, so name an idPrefix of your own`);
  }

  // Element IDs are unique across the packages the pages show.
  const seen = new Map<string, string>();
  for (const pkg of [...current, ...shown.map((s) => s.data)]) {
    const measureIds = pkg.elements.flatMap((e) => (Array.isArray(e.attributes?.measures) ? (e.attributes.measures as { id: string }[]).map((m) => measureId(e, m.id)) : []));
    for (const id of [...pkg.elements.map((e) => e.id), ...measureIds]) {
      const other = seen.get(id);
      if (other) errors.push(`element ${id} is defined in both ${other} and ${pkg.packageId}`);
      seen.set(id, pkg.packageId);
    }
  }
  if (!ownFiles.length) errors.push('no packages found under content/. Run pnpm content:build.');
  if (errors.length) {
    throw new Error(`Blueprint package validation failed:\n  ${errors.join('\n  ')}`);
  }
  return { own: [...versions.values()].flatMap((list) => list.map((f) => ({ ...f, latest: f.data.version === release }))), upstream: shown, builtOn };
}

const loaded = load();
/** Every version of the site's own packages, oldest first within each package. */
export const packageFiles = loaded.own;
/** The site's own packages in its current release. */
export const ownPackages = packageFiles.filter((f) => f.latest).map((f) => f.data);
/** The packages the pages show: the site's own, then, on a publisher's site, the library's they build on, and the rest of the library's if it shows them all. */
export const packages = [...ownPackages, ...loaded.upstream.map((f) => f.data)];
/** The site's current release, which every one of its own packages has. */
export const release = ownPackages[0]?.version;

/** Whether a package is the site's own, rather than one of the library's on a publisher's site. */
export const isOwn = (pkg: BlueprintPackage) => ownPackages.includes(pkg);

/** Whether a package is one the site uses: its own, or one of the library's they build on, rather than the rest of the library. */
export const inUse = (pkg: BlueprintPackage) => isOwn(pkg) || loaded.builtOn.includes(pkg);

/**
 * Whether an item is the library's, on a publisher's site, and worth marking
 * as such: everywhere, or, given the package of the page or mission it's in,
 * only among the publisher's own items.
 */
export const fromLibrary = (item: { package: BlueprintPackage }, within?: BlueprintPackage) =>
  !isOwn(item.package) && (!within || isOwn(within));

const folders = new Map<BlueprintPackage, string>([...packageFiles.map((f) => [f.data, f.name] as const), ...loaded.upstream.map((f) => [f.data, f.name] as const)]);

/** Where to download a package: from this site, or a library package from the library's. */
export function downloadUrl(pkg: BlueprintPackage): string {
  const path = `packages/${folders.get(pkg)}/${pkg.version}/blueprint.json`;
  return isOwn(pkg) ? href(path) : new URL(path, upstream!.base).href;
}

export const elements: LibraryElement[] = packages.flatMap((pkg) =>
  pkg.elements.map((e) => {
    const typeInfo = elementTypes[e.type];
    const slug = e.id.split(':')[2];
    const path = `${typeInfo.section}/${slug}/`;
    return isOwn(pkg)
      ? { ...e, package: pkg, typeInfo, slug, url: href(path) }
      : { ...e, package: pkg, typeInfo, slug, url: href(`library/${path}`), canonicalUrl: new URL(path, upstream!.base).href };
  }),
);

const byId = new Map(elements.map((e) => [e.id, e]));
const relations: (Relation & { package: BlueprintPackage })[] = packages.flatMap((p) => p.relations.map((r) => ({ ...r, package: p })));

export function elementsOfType(type: string): LibraryElement[] {
  return elements.filter((e) => e.type === type);
}

/** Types that have at least one element, in vocabulary order. */
export function typesInUse(): [string, ElementTypeInfo][] {
  return Object.entries(elementTypes).filter(([type]) => elements.some((e) => e.type === type));
}

/**
 * Elements linked to this one by a predicate, in either direction. With
 * `within`, only relations those packages define count, so a mission sees
 * what a shared capability does for it and not for other missions.
 */
export function related(
  element: LibraryElement,
  predicate: string,
  direction: 'outgoing' | 'incoming',
  within?: BlueprintPackage[],
): LibraryElement[] {
  return relationsOf(element, predicate, direction)
    .filter((r) => !within || within.includes(r.package))
    .map((r) => byId.get(direction === 'outgoing' ? r.to : r.from)!);
}

function relationsOf(element: LibraryElement, predicate: string, direction: 'outgoing' | 'incoming') {
  return relations.filter(
    (r) => r.predicate === predicate && (direction === 'outgoing' ? r.from : r.to) === element.id,
  );
}

/** A package and the packages it builds on, as the pages show them. */
function scopeOf(pkg: BlueprintPackage): BlueprintPackage[] {
  return [pkg, ...packages.filter((p) => pkg.dependencies?.some((d) => d.packageId === p.packageId))];
}

/**
 * An element's relationships, grouped by predicate and direction. A
 * relationship that reads the same both ways, such as "works well with", is
 * one group.
 */
export function relationGroups(element: LibraryElement): RelationGroup[] {
  const groups: RelationGroup[] = [];
  for (const [name, info] of Object.entries(predicates)) {
    for (const direction of ['outgoing', 'incoming'] as const) {
      const rels = relationsOf(element, name, direction).filter((r) => !(r.way && name === 'depends_on' && direction === 'outgoing'));
      if (!rels.length) continue;
      const others = related(element, name, direction);
      const links = new Map(rels.map((r, i) => [others[i].id, { ...(r.description && { note: r.description }), partial: r.coverage === 'partial' }]));
      const same = groups.find((g) => g.heading === info[direction]);
      if (same) {
        same.elements.push(...others.filter((e) => !same.links.has(e.id)));
        for (const [id, l] of links) if (!same.links.has(id)) same.links.set(id, l);
        same.notes = [...new Set([...same.notes, ...rels.flatMap((r) => (r.description ? [r.description] : []))])];
        continue;
      }
      groups.push({
        heading: info[direction],
        notes: [...new Set(rels.flatMap((r) => (r.description ? [r.description] : [])))],
        elements: others,
        links,
      });
    }
  }
  return groups;
}

/** Whether a candidate pattern covers only part of a capability. */
export function coversPartly(capability: LibraryElement, pattern: LibraryElement): boolean {
  return relations.some((r) => r.from === capability.id && r.predicate === 'candidate_pattern' && r.to === pattern.id && r.coverage === 'partial');
}

/** A way to tell how an outcome is going, listed on the outcome since schema 0.4.0. */
export interface Measure {
  id: string;
  /** The ID discovery answers and tools name it by, such as eb:measure:<id>. */
  elementId: string;
  title: string;
  description: string;
  sourceIds?: string[];
  outcome: LibraryElement;
  /** Its place on the outcome's page. */
  url: string;
}

/** An outcome's measures, in order. */
export function measuresOf(outcome: LibraryElement): Measure[] {
  const list = outcome.attributes?.measures;
  return Array.isArray(list)
    ? (list as Omit<Measure, 'outcome' | 'url' | 'elementId'>[]).map((m) => ({ ...m, elementId: measureId(outcome, m.id), outcome, url: `${outcome.url}#measure-${m.id}` }))
    : [];
}

/** What a discovery answer can point at: an element, or an outcome's measure. */
export type DiscoveryTarget = Pick<LibraryElement, 'id' | 'type' | 'title' | 'url' | 'package'>;

export function discoveryTarget(id: string): DiscoveryTarget | undefined {
  const element = elements.find((e) => e.id === id);
  if (element) return element;
  const measure = elements.flatMap(measuresOf).find((m) => m.elementId === id);
  return measure && { id, type: 'measure', title: measure.title, url: measure.url, package: measure.outcome.package };
}

export interface MissionBlueprint {
  outcomes: { outcome: LibraryElement; measures: Measure[]; capabilities: LibraryElement[] }[];
  /** The mission's own capabilities first, then shared ones from packages it builds on. */
  capabilities: {
    capability: LibraryElement;
    /** The package it comes from, when that isn't the mission's own. */
    sharedFrom?: BlueprintPackage;
    outcomes: LibraryElement[];
    requirements: LibraryElement[];
    patterns: LibraryElement[];
  }[];
  measures: Measure[];
  requirements: LibraryElement[];
  patterns: LibraryElement[];
}

/**
 * Everything under a mission, band by band: the outcomes it seeks and their
 * measures, the capabilities that contribute to them (or, in older packages,
 * support the mission directly), and those capabilities' requirements and
 * candidate patterns. Only the mission's package and the packages it builds
 * on count, so a shared capability brings what it does for this mission.
 */
export function missionBlueprint(mission: LibraryElement): MissionBlueprint {
  const unique = (list: LibraryElement[]) => [...new Set(list)];
  const scope = scopeOf(mission.package);
  const outcomes = related(mission, 'seeks', 'outgoing', scope).map((outcome) => ({
    outcome,
    measures: measuresOf(outcome),
    capabilities: related(outcome, 'contributes_to', 'incoming', scope),
  }));
  const found = unique([...outcomes.flatMap((o) => o.capabilities), ...related(mission, 'supports_mission', 'incoming', scope)]);
  // In the order their packages define them, the mission's own first.
  const order = (e: LibraryElement) => (e.package === mission.package ? 0 : 1) * 1e6 + elements.indexOf(e);
  const capabilities = found
    .sort((a, b) => order(a) - order(b))
    .map((capability) => ({
      capability,
      ...(capability.package !== mission.package && { sharedFrom: capability.package }),
      outcomes: outcomes.filter((o) => o.capabilities.includes(capability)).map((o) => o.outcome),
      requirements: related(capability, 'satisfies', 'outgoing', scope),
      patterns: related(capability, 'candidate_pattern', 'outgoing', scope),
    }));
  return {
    outcomes,
    capabilities,
    measures: outcomes.flatMap((o) => o.measures),
    requirements: unique(capabilities.flatMap((c) => c.requirements)),
    patterns: unique(capabilities.flatMap((c) => c.patterns)).sort((a, b) => order(a) - order(b)),
  };
}

/** A resource's own fields, since schema 0.6.0. */
export interface ResourceDetails {
  /** Its kind's label, such as "Video". */
  kind: string;
  url: string;
  /** Who made it, when that isn't the package's publisher. */
  by?: string;
  lastReviewedAt?: string;
}

export function resourceDetails(resource: LibraryElement): ResourceDetails {
  const a = resource.attributes ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    kind: resourceKinds.groups[String(a.kind)]?.label ?? String(a.kind),
    url: String(a.url),
    by: text(a.by),
    lastReviewedAt: text(a.lastReviewedAt),
  };
}

export interface ElementResource {
  resource: LibraryElement;
  details: ResourceDetails;
  /** The pattern's way it's about, when it's about one. */
  way?: { id: string; title: string };
  note?: string;
}

/** The resources that help with an element, a publisher's own first, then in the order their packages list them, kind by kind. */
export function resourcesFor(element: LibraryElement): ElementResource[] {
  const ways = Array.isArray(element.attributes?.ways) ? (element.attributes.ways as { id: string; title: string }[]) : [];
  const kinds = Object.keys(resourceKinds.groups);
  return relationsOf(element, 'helps_with', 'incoming')
    .map((r) => {
      const resource = byId.get(r.from)!;
      const way = r.way ? ways.find((w) => w.id === r.way) : undefined;
      return { resource, details: resourceDetails(resource), ...(way && { way: { id: way.id, title: way.title } }), ...(r.description && { note: r.description }) };
    })
    .sort((a, b) => Number(isOwn(b.resource.package)) - Number(isOwn(a.resource.package)) || kinds.indexOf(String(a.resource.attributes?.kind)) - kinds.indexOf(String(b.resource.attributes?.kind)));
}

/** What a resource helps with, in the order it lists them, with the pattern's way when a link names one. */
export function helpsWith(resource: LibraryElement): { element: LibraryElement; way?: { id: string; title: string } }[] {
  return relationsOf(resource, 'helps_with', 'outgoing').map((r) => {
    const element = byId.get(r.to)!;
    const ways = Array.isArray(element.attributes?.ways) ? (element.attributes.ways as { id: string; title: string }[]) : [];
    const way = r.way ? ways.find((w) => w.id === r.way) : undefined;
    return { element, ...(way && { way: { id: way.id, title: way.title } }) };
  });
}

/** What a relation between two elements says about itself, such as a mission's caveat on a shared pattern. */
export function relationNote(from: LibraryElement, predicate: string, to: LibraryElement): string | undefined {
  return relations.find((r) => r.from === from.id && r.predicate === predicate && r.to === to.id)?.description;
}

export interface PatternDetails {
  /** How it's sourced, in a few words: its one way's or solution's approach, such as "Configure a product", or how many there are. */
  sourcing?: string;
  /** The layer of the architecture it belongs to, such as "business-applications". */
  layer?: string;
  fields: { key: string; label: string; items: string[] }[];
  /** Its ways to source it, each with what it needs: since schema 0.7.0, the solutions that implement it. */
  ways: PatternWay[];
}

export interface PatternWay {
  /** The way's ID, or the solution's key. */
  id: string;
  /** The solution it is, since schema 0.7.0. Before then, a way is part of its pattern. */
  solution?: LibraryElement;
  /** The approach's label, such as "Configure a product". */
  approach: string;
  title: string;
  description?: string;
  fields: { key: string; label: string; items: string[] }[];
  /** Patterns this way can't work without. */
  needs: { pattern: LibraryElement; note?: string }[];
}

/**
 * An implementation pattern's or solution's own fields, in vocabulary order,
 * and a pattern's ways to source it: since schema 0.7.0, the solutions that
 * implement it, a publisher's own first; before then, the ways it lists.
 */
export function patternDetails(pattern: LibraryElement): PatternDetails {
  const a = pattern.attributes ?? {};
  const fieldsOf = (o: Record<string, unknown>) =>
    Object.entries(patternFields).flatMap(([key, f]) => (Array.isArray(o[key]) ? [{ key, label: f.label, items: o[key] as string[] }] : []));
  const approach = (value: unknown) => patternApproaches[String(value)] ?? String(value);
  const listed = Array.isArray(a.ways) ? (a.ways as Record<string, unknown>[]) : [];
  const solutions = pattern.type === 'implementationPattern' ? relationsOf(pattern, 'implements', 'incoming').map((r) => byId.get(r.from)!) : [];
  solutions.sort((x, y) => Number(isOwn(y.package)) - Number(isOwn(x.package)));
  const ways: PatternWay[] = listed.length
    ? listed.map((w) => ({
        id: String(w.id),
        approach: approach(w.approach),
        title: String(w.title),
        description: typeof w.description === 'string' ? w.description : undefined,
        fields: fieldsOf(w),
        needs: relationsOf(pattern, 'depends_on', 'outgoing')
          .filter((r) => r.way === w.id)
          .map((r) => ({ pattern: byId.get(r.to)!, note: r.description })),
      }))
    : solutions.map((s) => ({
        id: s.id.split(':').at(-1)!,
        solution: s,
        approach: approach(s.attributes?.approach),
        title: s.title,
        description: s.description,
        fields: fieldsOf(s.attributes ?? {}),
        needs: relationsOf(s, 'depends_on', 'outgoing').map((r) => ({ pattern: byId.get(r.to)!, note: r.description })),
      }));
  const sourcing =
    pattern.type === 'solution'
      ? approach(a.approach)
      : ways.length === 1
        ? ways[0].approach
        : ways.length
          ? `${ways.length} ${listed.length ? 'ways to source it' : 'solutions'}`
          : undefined;
  return {
    sourcing,
    // Called its role before schema 0.4.0.
    layer: [a.layer, a.role].find((l): l is string => typeof l === 'string' && Boolean(patternLayers[l])),
    fields: fieldsOf(a),
    ways,
  };
}



export interface LayerGroup<T> {
  layer: string | undefined;
  label: string;
  hint?: string;
  items: T[];
}

/** Patterns grouped by the part they play, in vocabulary order, with any that have no role last. */
export function byLayer<T>(items: T[], patternOf: (item: T) => LibraryElement): LayerGroup<T>[] {
  const layers: (string | undefined)[] = [...Object.keys(patternLayers), undefined];
  return layers
    .map((layer) => ({
      layer,
      label: layer ? patternLayers[layer].label : 'Other patterns',
      hint: layer ? patternLayers[layer].hint : undefined,
      items: items.filter((i) => patternDetails(patternOf(i)).layer === layer),
    }))
    .filter((g) => g.items.length);
}

/** The principles a mission's architecture follows. */
export function principlesOf(mission: LibraryElement): string[] {
  const list = mission.attributes?.principles;
  return Array.isArray(list) ? (list as string[]) : [];
}

/** A mission's tagline, the phrase under its plain name, such as "Acquiring goods and services for the government". */
export const tagline = (e: LibraryElement): string | undefined => (typeof e.attributes?.tagline === 'string' ? e.attributes.tagline : undefined);

/**
 * A short label for where a package applies, such as "U.S. federal", for a badge
 * beside names that don't say it themselves.
 */
export function scopeLabel(pkg: BlueprintPackage): string | undefined {
  const scopes = pkg.jurisdictions ?? [];
  return scopes.length > 0 && scopes.every((j) => j.startsWith('United States — federal')) ? 'U.S. federal' : undefined;
}

/** "Common Capabilities" for "Common Capabilities — Shared Across Missions". */
export const shortTitle = (pkg: BlueprintPackage) => pkg.title.split(' — ')[0];

export interface IndexGroup {
  /** The anchor for the group on its index page. */
  id: string;
  label: string;
  hint?: string;
  items: LibraryElement[];
}

/** The predicate that names each item's parent on an index page, such as the capability a requirement belongs to. */
// On the index, a requirement says the capability it belongs to, and a solution the pattern it implements.
const parentLinks: Record<string, [string, 'incoming' | 'outgoing']> = { requirement: ['satisfies', 'incoming'], solution: ['implements', 'outgoing'] };

/** The group an outcome, capability, or requirement names, since schema 0.5.0, with the address of its place on the index page. */
export function groupOf(e: LibraryElement): { id: string; label: string; hint: string; url: string } | undefined {
  const grouping = groupings[e.type];
  const id = e.attributes?.[grouping?.field ?? ''];
  const group = typeof id === 'string' ? grouping.groups[id] : undefined;
  return group && { id: id as string, ...group, url: href(`${e.typeInfo.section}/#${id}`) };
}

/** Missions first in title order, then the packages they build on, so a group lists each mission's items together. */
const packageOrder = (pkg: BlueprintPackage) => [!elements.some((e) => e.package === pkg && e.type === 'mission'), shortTitle(pkg)] as const;
const byPackage = (a: LibraryElement, b: LibraryElement) => {
  const [x, y] = [packageOrder(a.package), packageOrder(b.package)];
  return Number(x[0]) - Number(y[0]) || x[1].localeCompare(y[1]);
};

/**
 * An index page's items, grouped: patterns by layer, and outcomes,
 * capabilities, and requirements by the group each names, in the order the
 * vocabulary lists them, so a group gathers items from every mission. Items
 * that name no group come last. Missions and solutions are few enough to list
 * whole. One group means no grouping.
 */
export function indexGroups(type: string): IndexGroup[] {
  const items = elementsOfType(type).filter((e) => e.status !== 'deprecated');
  // A layer's hint is written for one office's patterns; its first sentence fits the whole library.
  if (type === 'implementationPattern') return byLayer(items, (p) => p).map((g) => ({ id: g.layer ?? 'other', label: g.label, hint: g.hint?.split(/(?<=\.) /)[0], items: g.items }));
  const grouping = groupings[type];
  if (!grouping) return [{ id: 'all', label: '', items }];
  const sorted = [...items].sort(byPackage);
  const groups: IndexGroup[] = Object.entries(grouping.groups).map(([id, g]) => ({ id, label: g.label, hint: g.hint, items: sorted.filter((e) => groupOf(e)?.id === id) }));
  groups.push({ id: 'other', label: 'Not grouped yet', items: sorted.filter((e) => !groupOf(e)) });
  const shown = groups.filter((g) => g.items.length);
  return shown.length > 1 ? shown : [{ id: 'all', label: '', items }];
}

/** Each item's parent within its own package, such as a requirement's capability, for the index pages. */
export function indexParents(type: string): Map<string, LibraryElement> | undefined {
  const link = parentLinks[type];
  if (!link) return undefined;
  const [predicate, direction] = link;
  const parents = new Map<string, LibraryElement>();
  for (const e of elementsOfType(type)) {
    const parent = related(e, predicate, direction, [e.package])[0];
    if (parent) parents.set(e.id, parent);
  }
  return parents;
}

/** The packages that build on this one, such as the mission packages that build on the common one. */
export function dependents(pkg: BlueprintPackage): BlueprintPackage[] {
  return packages.filter((p) => p.dependencies?.some((d) => d.packageId === pkg.packageId));
}

/** Other packages whose relations or discovery answers point at this element. */
export function usedBy(element: LibraryElement): BlueprintPackage[] {
  return packages.filter(
    (p) =>
      p !== element.package &&
      (p.relations.some((r) => r.from === element.id || r.to === element.id) ||
        (p.assessments ?? []).some((a) => a.questions.some((q) => q.candidateMappings?.some((m) => m.elementId === element.id)))),
  );
}

/** What an element cites, its outcome's measures included. */
const citedIds = (element: LibraryElement) => [...new Set([...(element.sourceIds ?? []), ...measuresOf(element).flatMap((m) => m.sourceIds ?? [])])];

export function sourcesOf(element: LibraryElement): Source[] {
  const sources = element.package.sources ?? [];
  return citedIds(element).map((id) => sources.find((s) => s.id === id)!);
}

export interface LibrarySource extends Source {
  package: BlueprintPackage;
  citedBy: LibraryElement[];
}

export const sources: LibrarySource[] = packages.flatMap((pkg) =>
  (pkg.sources ?? []).map((s) => ({
    ...s,
    package: pkg,
    citedBy: elements.filter((e) => e.package === pkg && citedIds(e).includes(s.id)),
  })),
);

/** The most recent review date among the given sources. */
export function lastReviewed(list: Source[]): string | undefined {
  return list.map((s) => s.lastReviewedAt).filter(Boolean).sort().at(-1);
}

export interface LibraryQuestion extends Question {
  assessment: Assessment;
  package: BlueprintPackage;
  /** The anchor on its discovery page. */
  url: string;
}

export interface LibraryAssessment extends Assessment {
  package: BlueprintPackage;
  slug: string;
  url: string;
  /** Its page on the library's site, for a library discovery set on a publisher's site. */
  canonicalUrl?: string;
}

export const assessments: LibraryAssessment[] = packages.flatMap((pkg) =>
  (pkg.assessments ?? []).map((a) => {
    const slug = a.id.split(':')[1];
    const path = `discovery/${slug}/`;
    return { ...a, package: pkg, slug, url: href(isOwn(pkg) ? path : `library/${path}`), ...(!isOwn(pkg) && { canonicalUrl: new URL(path, upstream!.base).href }) };
  }),
);

/** Discovery questions with an answer that points to this element, and the answers that do. */
export function questionsAbout(element: LibraryElement): { question: LibraryQuestion; answers: { label: string; interpretation: string }[] }[] {
  // An outcome's questions include those that point at its measures.
  const ids = new Set([element.id, ...measuresOf(element).map((m) => m.elementId)]);
  return assessments.flatMap((a) =>
    a.questions.flatMap((q) => {
      const mappings = (q.candidateMappings ?? []).filter((m) => ids.has(m.elementId));
      if (!mappings.length) return [];
      const label = (value: string) => q.options?.find((o) => o.value === value)?.label ?? (value === 'true' ? 'Yes' : value === 'false' ? 'No' : value);
      // Answers that mean the same thing for this element are listed together.
      const byMeaning = new Map<string, string[]>();
      for (const m of mappings) byMeaning.set(m.interpretation, [...(byMeaning.get(m.interpretation) ?? []), m.answerValue]);
      const every = (values: string[]) => (q.options?.length ?? 2) === values.length;
      // Each label is a whole answer, so several are quoted: “A” or “B”.
      const either = (values: string[]) =>
        values.length === 1 ? label(values[0]) : new Intl.ListFormat('en', { type: 'disjunction' }).format(values.map((v) => `“${label(v)}”`));
      return [
        {
          question: { ...q, assessment: a, package: a.package, url: `${a.url}#${q.id.split(':')[1]}` },
          answers: [...byMeaning].map(([interpretation, values]) => ({
            label: every(values) && values.length > 1 ? 'Any answer' : either(values),
            interpretation,
          })),
        },
      ];
    }),
  );
}

/** Everything the site's search looks through, each with what it can be found by. */
export function searchIndex(): SearchItem[] {
  const current = elements.filter((e) => e.status !== 'deprecated');
  const from = (pkg: BlueprintPackage) => shortTitle(pkg);
  const ways = (e: LibraryElement) => (Array.isArray(e.attributes?.ways) ? (e.attributes.ways as { title: string }[]).map((w) => w.title) : []);
  // Several packages can cite one source, which is one result.
  const distinct = sources.filter((s, i) => sources.findIndex((x) => x.url === s.url) === i);
  return [
    ...current.map((e) => ({ title: e.title, type: e.type, label: e.typeInfo.label, package: from(e.package), url: e.url, text: [e.description, tagline(e), ...ways(e)].filter(Boolean).join(' ') })),
    ...current.flatMap(measuresOf).map((m) => ({ title: m.title, type: 'measure', label: 'Measure', package: from(m.outcome.package), url: m.url, text: m.description })),
    ...assessments.flatMap((a) => [
      { title: a.title, type: 'discovery', label: 'Question set', package: from(a.package), url: a.url, text: a.description },
      ...a.questions.map((q) => ({ title: q.prompt, type: 'discovery', label: 'Discovery question', package: from(a.package), url: `${a.url}#${q.id.split(':')[1]}`, text: q.options?.map((o) => o.label).join(' ') })),
    ]),
    ...distinct.map((s) => ({ title: s.title, type: 'source', label: 'Source', package: from(s.package), url: s.url, text: s.note, external: true })),
  ];
}
