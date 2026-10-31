// Builds blueprint packages from the source files people edit, and decides
// which version each one publishes as.
//
// Each package's source is a folder of YAML under source/<package>/:
// package.yaml, sources.yaml, one file per element type (capabilities.yaml,
// patterns.yaml, …) listing its elements in order with their links, links.yaml
// for links from other packages' elements, and discovery.yaml. The library is
// released as one version: every package in a release has its version and
// builds on the others at that version. Versions are never written by hand:
// when any source no longer matches the published release, every package
// gets the next one. A release that isn't published yet is rebuilt in place.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compareVersions } from './format.ts';
import { elementTypes, groupings, libraryPrefix, predicates, resourceFields } from './vocabulary.ts';
import type { Assessment, BlueprintPackage, Element, Question, Relation, Source } from './package.ts';

type Raw = Record<string, unknown>;

export interface PackageSource {
  /** The folder name, shared by source/<name>/ and content/<name>/. */
  name: string;
  meta: Raw;
  /** Folder names of the packages it builds on. */
  dependencies: string[];
  sources: Raw[];
  /** In vocabulary type order, then file order. */
  elements: { type: string; raw: Raw }[];
  links: Raw[];
  discovery: Raw[];
}

/** "capabilities" → "capability", for element files named after their type's section. */
const typeOfSection = Object.fromEntries(Object.entries(elementTypes).map(([type, info]) => [info.section, type]));
const PACKAGE_KEYS = ['schemaVersion', 'packageId', 'idPrefix', 'title', 'description', 'publisher', 'license', 'domain', 'jurisdictions', 'tags', 'dependencies'];
const ELEMENT_KEYS = ['id', 'title', 'description', 'status', 'replacedBy', 'sources', 'tags', 'jurisdictions', 'applicabilityNotes', 'attributes', 'measures', ...resourceFields, ...new Set(Object.values(groupings).map((g) => g.field))];
const MEASURE_KEYS = ['id', 'title', 'description', 'sources'];
const LINK_KEYS = ['to', 'note', 'sources', 'id', 'coverage', 'way'];

// Written out in full, since Node runs this file without compiling it.
export class SourceError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Source problems:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

export function readSources(root: string): PackageSource[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(root, d.name);
      const files = Object.fromEntries(
        readdirSync(dir)
          .filter((f) => f.endsWith('.yaml'))
          .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
      );
      return parseSource(d.name, files);
    });
}

/** Reads one package's files, given as file name → text. */
export function parseSource(name: string, files: Record<string, string>): PackageSource {
  const problems: string[] = [];
  const at = (file: string) => `source/${name}/${file}`;
  const load = (file: string): unknown => {
    if (files[file] === undefined) return undefined;
    try {
      return parse(files[file]);
    } catch (e) {
      problems.push(`${at(file)}: ${(e as Error).message}`);
      return undefined;
    }
  };
  const list = (file: string): Raw[] => {
    const value = load(file);
    if (value == null) return [];
    if (!Array.isArray(value)) {
      problems.push(`${at(file)}: should be a list`);
      return [];
    }
    return value as Raw[];
  };

  const known = new Set(['package.yaml', 'sources.yaml', 'links.yaml', 'discovery.yaml', ...Object.keys(typeOfSection).map((s) => `${s}.yaml`)]);
  for (const file of Object.keys(files)) {
    if (!known.has(file)) problems.push(`${at(file)}: unknown file. Element files are named for their type, such as capabilities.yaml.`);
  }
  const meta = (load('package.yaml') ?? {}) as Raw;
  if (files['package.yaml'] === undefined) problems.push(`${at('package.yaml')}: missing`);
  for (const key of Object.keys(meta)) {
    if (key === 'version' || key === 'publishedAt') problems.push(`${at('package.yaml')}: "${key}" is set when the package is built, not by hand`);
    else if (!PACKAGE_KEYS.includes(key)) problems.push(`${at('package.yaml')}: unknown field "${key}"`);
  }
  const elements = Object.values(elementTypes).flatMap((info) =>
    list(`${info.section}.yaml`).map((raw) => ({ type: typeOfSection[info.section], raw })),
  );
  if (problems.length) throw new SourceError(problems);
  return {
    name,
    meta,
    dependencies: (meta.dependencies as string[] | undefined) ?? [],
    sources: list('sources.yaml'),
    elements,
    links: list('links.yaml'),
    discovery: list('discovery.yaml'),
  };
}

/** A package another one builds on, as it will be published. */
export interface Resolved {
  packageId: string;
  version: string;
  /** The prefix of its element IDs, when it isn't the library's own. */
  idPrefix?: string;
}

const strings = (value: unknown): string[] => (value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]);
const slugOf = (id: string) => id.split(':').at(-1)!;

/**
 * Builds the package a source describes, at the given version and date,
 * pinned to the given versions of the packages it builds on.
 */
export function compilePackage(src: PackageSource, deps: Record<string, Resolved>, version: string, publishedAt: string): BlueprintPackage {
  const problems: string[] = [];
  const m = src.meta;
  const at = (file: string, what?: string) => `source/${src.name}/${file}${what ? ` (${what})` : ''}`;

  // Every element ID starts with the package's prefix, such as eb:capability:case-management.
  const prefix = (m.idPrefix as string | undefined) ?? libraryPrefix;
  const own = new Set(src.elements.flatMap(({ type, raw }) => [`${type}:${raw.id}`, ...(Array.isArray(raw.measures) ? (raw.measures as Raw[]).map((x) => `measure:${x.id}`) : [])]));
  const dependencyPrefixes = [...new Set(src.dependencies.map((name) => deps[name]?.idPrefix ?? libraryPrefix))];

  /**
   * "capability:case-management" → "eb:capability:case-management": the
   * package's own element, or else one from the packages it builds on, when
   * they share a prefix. Otherwise the reference says its prefix.
   */
  const ref = (text: string, where: string): string => {
    const parts = text.split(':');
    const [type, key] = parts.length === 3 ? parts.slice(1) : parts;
    if (!key || parts.length > 3 || !elementTypes[type]) {
      problems.push(`${where}: "${text}" should name a type and a key, such as capability:case-management`);
      return text;
    }
    if (parts.length === 3) return text;
    if (own.has(text) || !dependencyPrefixes.length) return `${prefix}:${text}`;
    if (dependencyPrefixes.length === 1) return `${dependencyPrefixes[0]}:${text}`;
    problems.push(`${where}: "${text}" could be in more than one of the packages this one builds on, so it needs a prefix, such as ${dependencyPrefixes[0]}:${text}`);
    return text;
  };

  const sources: Source[] = src.sources.map((s) => ({ ...s, id: `src:${s.id}` }) as Source);

  const elements: Element[] = src.elements.map(({ type, raw }) => {
    const where = at(`${elementTypes[type].section}.yaml`, String(raw.id));
    for (const key of Object.keys(raw)) {
      if (!ELEMENT_KEYS.includes(key) && !predicates[key]) problems.push(`${where}: unknown field "${key}"`);
    }
    if (!raw.id) problems.push(`${where}: needs an id`);
    const e: Element = {
      id: `${prefix}:${type}:${raw.id}`,
      type,
      title: raw.title as string,
      description: raw.description as string,
      status: (raw.status as Element['status']) ?? 'reference',
    };
    if (raw.replacedBy) e.replacedBy = `${prefix}:${type}:${raw.replacedBy}`;
    if (raw.sources) e.sourceIds = strings(raw.sources).map((s) => `src:${s}`);
    if (raw.tags) e.tags = raw.tags as string[];
    if (raw.jurisdictions) e.jurisdictions = raw.jurisdictions as string[];
    if (raw.applicabilityNotes) e.applicabilityNotes = raw.applicabilityNotes as string;
    if (raw.attributes) e.attributes = raw.attributes as Record<string, unknown>;
    // An outcome's measures are written under it and published in its attributes.
    if (raw.measures !== undefined) {
      if (type !== 'outcome') problems.push(`${where}: only an outcome has measures`);
      const measures = (Array.isArray(raw.measures) ? raw.measures : []) as Raw[];
      for (const m of measures) for (const key of Object.keys(m)) if (!MEASURE_KEYS.includes(key)) problems.push(`${where}: unknown field "${key}" in a measure`);
      e.attributes = {
        ...e.attributes,
        measures: measures.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          ...(m.sources ? { sourceIds: strings(m.sources).map((s) => `src:${s}`) } : {}),
        })),
      };
    }
    // An outcome's theme, a capability's stage, or a requirement's or resource's kind is written on it and published in its attributes.
    for (const field of new Set(Object.values(groupings).map((g) => g.field))) {
      if (raw[field] === undefined) continue;
      const g = groupings[type];
      if (g?.field !== field) {
        const types = Object.entries(groupings).filter(([, x]) => x.field === field).map(([t]) => `a ${t}`);
        problems.push(`${where}: only ${new Intl.ListFormat('en', { type: 'disjunction' }).format(types)} has a ${field}`);
      } else if (!g.groups[raw[field] as string]) problems.push(`${where}: unknown ${field} "${raw[field]}", which should be one of ${Object.keys(g.groups).join(', ')}`);
      e.attributes = { ...e.attributes, [field]: raw[field] };
    }
    // A resource's link, who made it, and when it was checked, likewise.
    for (const field of resourceFields) {
      if (raw[field] === undefined) continue;
      if (type !== 'resource') problems.push(`${where}: only a resource has a ${field}`);
      e.attributes = { ...e.attributes, [field]: String(raw[field]) };
    }
    return e;
  });

  // Links on an element, then links from other packages' elements, each in the order written.
  const relations: Relation[] = [];
  const addLinks = (from: string, raw: Raw, where: string) => {
    for (const [predicate, info] of Object.entries(predicates)) {
      if (raw[predicate] === undefined) continue;
      const entries = Array.isArray(raw[predicate]) ? (raw[predicate] as unknown[]) : [raw[predicate]];
      for (const entry of entries) {
        const link = (typeof entry === 'object' && entry !== null ? entry : { to: entry }) as Raw;
        for (const key of Object.keys(link)) if (!LINK_KEYS.includes(key)) problems.push(`${where}: unknown field "${key}" in a ${predicate} link`);
        const target = String(link.to);
        // A bare key names an element of the one type this link can reach.
        const to = target.includes(':')
          ? ref(target, where)
          : info.to.length === 1
            ? ref(`${info.to[0]}:${target}`, where)
            : (problems.push(`${where}: "${predicate}" can reach more than one type, so "${target}" needs its type`), target);
        const r: Relation = {
          id: link.id ? `rel:${link.id}` : `rel:${slugOf(from)}-${predicate.replace(/_/g, '-')}-${slugOf(to)}`,
          from,
          predicate,
          to,
        };
        if (link.coverage !== undefined) r.coverage = link.coverage as Relation['coverage'];
        if (link.way !== undefined) r.way = String(link.way);
        if (link.note) r.description = link.note as string;
        if (link.sources) r.sourceIds = strings(link.sources).map((s) => `src:${s}`);
        relations.push(r);
      }
    }
  };
  src.elements.forEach(({ type, raw }, i) => addLinks(elements[i].id, raw, at(`${elementTypes[type].section}.yaml`, String(raw.id))));
  for (const raw of src.links) {
    const where = at('links.yaml', String(raw.from));
    for (const key of Object.keys(raw)) if (key !== 'from' && !predicates[key]) problems.push(`${where}: unknown field "${key}"`);
    addLinks(ref(String(raw.from), where), raw, where);
  }

  const assessments: Assessment[] = src.discovery.map((set) => {
    const a: Assessment = { id: `assessment:${set.id}`, title: set.title as string, questions: [] };
    if (set.description) a.description = set.description as string;
    a.questions = ((set.questions as Raw[]) ?? []).map((q) => {
      const where = at('discovery.yaml', `${set.id} / ${q.id}`);
      const question: Question = { id: `question:${q.id}`, prompt: q.prompt as string, kind: q.kind as Question['kind'] };
      if (q.options) {
        // Each option is written "value: label".
        question.options = (q.options as Raw[]).map((o) => {
          const [value, label] = Object.entries(o)[0] ?? [];
          return { value: String(value), label: String(label) };
        });
      }
      if (q.points) {
        // A group names the answers that point to one or more elements, for one reason.
        question.candidateMappings = (q.points as Raw[]).flatMap((group) =>
          strings(group.to).flatMap((target) =>
            strings(group.when).map((answerValue) => ({ answerValue, elementId: ref(target, where), interpretation: group.why as string })),
          ),
        );
      }
      return question;
    });
    return a;
  });

  const dependencies = src.dependencies.map((name) => {
    const d = deps[name];
    if (!d) problems.push(`${at('package.yaml')}: builds on "${name}", which isn't a package under source/`);
    return { packageId: d?.packageId ?? name, version: d?.version ?? '0.0.0' };
  });

  if (problems.length) throw new SourceError(problems);
  return {
    schemaVersion: m.schemaVersion as BlueprintPackage['schemaVersion'],
    packageId: m.packageId as string,
    ...(m.idPrefix ? { idPrefix: prefix } : {}),
    version,
    title: m.title as string,
    description: m.description as string,
    publisher: m.publisher as BlueprintPackage['publisher'],
    license: m.license as string,
    publishedAt,
    domain: m.domain as string,
    ...(m.jurisdictions ? { jurisdictions: m.jurisdictions as string[] } : {}),
    ...(m.tags ? { tags: m.tags as string[] } : {}),
    ...(dependencies.length ? { dependencies } : {}),
    ...(sources.length ? { sources } : {}),
    elements,
    relations,
    ...(assessments.length ? { assessments } : {}),
  };
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => equal((a as Raw)[k], (b as Raw)[k]));
}

function groupBy<T>(list: T[], key: (x: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const x of list) (groups[key(x)] ??= []).push(x);
  return groups;
}

/**
 * Whether two packages say the same thing, apart from their version and date.
 * What the pages show in order stays in order: elements within a type, and
 * one element's links of one kind. The order across types, or of unrelated
 * links, carries no meaning.
 */
export function sameContent(a: BlueprintPackage, b: BlueprintPackage): boolean {
  const rest = (p: BlueprintPackage) => {
    const { version: _v, publishedAt: _d, elements: _e, relations: _r, ...others } = p;
    return others;
  };
  const links = (p: BlueprintPackage) => groupBy(p.relations, (r) => `${r.from} ${r.predicate}`);
  return equal(rest(a), rest(b)) && equal(groupBy(a.elements, (e) => e.type), groupBy(b.elements, (e) => e.type)) && equal(links(a), links(b));
}

/** What changed from one version to the next, in a few words. */
export function describeChange(before: BlueprintPackage, after: BlueprintPackage): string {
  const parts: string[] = [];
  const count = <T>(list: T[], noun: string) => `${list.length} ${noun}${list.length === 1 ? '' : 's'}`;
  const ids = (p: BlueprintPackage) => new Map(p.elements.map((e) => [e.id, e]));
  const was = ids(before), now = ids(after);
  const added = [...now.keys()].filter((id) => !was.has(id));
  const removed = [...was.keys()].filter((id) => !now.has(id));
  const edited = [...now.keys()].filter((id) => was.has(id) && !equal(was.get(id), now.get(id)));
  if (added.length) parts.push(`${count(added, 'element')} added`);
  if (removed.length) parts.push(`${count(removed, 'element')} removed`);
  if (edited.length) parts.push(`${count(edited, 'element')} edited`);
  const rel = (p: BlueprintPackage) => new Set(p.relations.map((r) => JSON.stringify([r.id, r.from, r.predicate, r.to, r.description, r.sourceIds])));
  const rb = rel(before), ra = rel(after);
  const linksChanged = [...ra].filter((r) => !rb.has(r)).length + [...rb].filter((r) => !ra.has(r)).length;
  if (linksChanged) parts.push('links changed');
  const builds = (p: BlueprintPackage) => (p.dependencies ?? []).map((d) => d.packageId).join(' ');
  if (builds(before) !== builds(after)) parts.push('builds on other packages');
  if (!equal(before.assessments, after.assessments)) parts.push('discovery questions changed');
  if (!equal(before.sources, after.sources)) parts.push('sources changed');
  const meta = (p: BlueprintPackage) => [p.title, p.description, p.tags, p.jurisdictions, p.domain, p.license, p.publisher, p.schemaVersion];
  if (!equal(meta(before), meta(after))) parts.push('package details changed');
  return parts.join(', ') || 'order changed';
}

const nextMinor = (v: string) => {
  const [major, minor] = v.split('.').map(Number);
  return `${major}.${minor + 1}.0`;
};
const newest = (versions: string[]) => [...versions].sort(compareVersions).at(-1);

export interface Step {
  name: string;
  /** The version in the release: the release's own, or a retired package's last. */
  version: string;
  /** The package to write as content/<name>/<version>/blueprint.json, when it changed. */
  write?: BlueprintPackage;
  /** Unpublished versions that are no longer needed. */
  remove: string[];
  /** No source any more, so it isn't in the release. Its published versions stay. */
  retired?: boolean;
  reason: string;
}

/**
 * Decides the release. When the sources match the newest published release,
 * every package stays on it. Otherwise every package gets the next release:
 * the unpublished one already there, rebuilt, or the minor version after the
 * newest published one. A package in content/ with no source is retired.
 * Another publisher's packages can build on the library's published ones,
 * given in `external` by folder name at the version they build on.
 */
export function plan(
  sources: PackageSource[],
  content: Record<string, Record<string, BlueprintPackage>>,
  isPublished: (name: string, version: string) => boolean,
  today: string,
  external: Record<string, Resolved> = {},
): Step[] {
  const names = sources.map((s) => s.name);
  for (const s of sources) {
    for (const d of s.dependencies) {
      if (!names.includes(d) && !external[d]) throw new SourceError([`source/${s.name}/package.yaml: builds on "${d}", which isn't a package under source/`]);
    }
  }
  const have = (name: string) => content[name] ?? {};
  const all = Object.keys(content).flatMap((name) => Object.keys(have(name)).map((version) => ({ name, version })));
  const release = newest(all.filter((v) => isPublished(v.name, v.version)).map((v) => v.version));
  const drafts = (name: string) => Object.keys(have(name)).filter((v) => !isPublished(name, v));
  const pins = (version: string): Record<string, Resolved> => ({
    ...external,
    ...Object.fromEntries(sources.map((s) => [s.name, { packageId: s.meta.packageId as string, version, ...(s.meta.idPrefix ? { idPrefix: s.meta.idPrefix as string } : {}) }])),
  });
  const build = (src: PackageSource, version: string, date: string) => compilePackage(src, pins(version), version, date);
  const retired = Object.keys(content)
    .filter((name) => !names.includes(name))
    .map((name): Step => {
      const last = newest(Object.keys(have(name)).filter((v) => isPublished(name, v))) ?? '';
      return { name, version: last, remove: drafts(name), retired: true, reason: 'retired, with its published versions kept' };
    });

  const inRelease = release ? all.filter((v) => v.version === release && isPublished(v.name, v.version)).map((v) => v.name) : [];
  const unchanged =
    release &&
    inRelease.length === names.length &&
    sources.every((src) => inRelease.includes(src.name) && sameContent(build(src, release, have(src.name)[release].publishedAt), have(src.name)[release]));
  if (unchanged) {
    return [
      ...sources.map((src): Step => {
        const remove = drafts(src.name);
        return { name: src.name, version: release, remove, reason: remove.length ? `back to ${release}, as published` : 'unchanged' };
      }),
      ...retired,
    ];
  }

  const version = newest(all.filter((v) => !isPublished(v.name, v.version) && (!release || compareVersions(v.version, release) > 0)).map((v) => v.version)) ?? (release ? nextMinor(release) : '0.1.0');
  return [
    ...sources.map((src): Step => {
      const remove = drafts(src.name).filter((v) => v !== version);
      const draft = isPublished(src.name, version) ? undefined : have(src.name)[version];
      if (draft && sameContent(build(src, version, draft.publishedAt), draft)) return { name: src.name, version, remove, reason: 'unpublished, up to date' };
      const pkg = build(src, version, today);
      const last = newest(Object.keys(have(src.name)).filter((v) => isPublished(src.name, v)));
      const before = last && have(src.name)[last];
      // Each release builds on its own packages, so the versions it builds on don't count as a change.
      const own = before && sameContent({ ...before, ...(pkg.dependencies && { dependencies: pkg.dependencies }) }, pkg);
      const reason = !before ? 'new package' : own ? 'no changes of its own' : describeChange(before, pkg);
      return { name: src.name, version, write: pkg, remove, reason };
    }),
    ...retired,
  ];
}
