// The editor on the pages, with `pnpm editor`, on the library's site and on
// publishers': a bar across the top, a button
// wherever something can be added or changed, and a form. The pages mark those
// places with data-resources-for, data-resource-id, data-element, data-detail,
// data-source, data-assessment, data-question, and data-package, and otherwise
// don't know about the editor. After a save the page reloads, showing the real
// result.

import './client.css';
import { idFromTitle } from '../src/lib/format.ts';

interface Link { to: string; coverage?: 'partial'; note?: string }
interface Measure { id?: string; title: string; description: string }
/** A pattern's layer and statements; a solution's statements. */
interface Pattern { layer?: string; parts?: string[]; strengths?: string[]; fitsWhen?: string[]; watchFor?: string[] }
interface Item {
  package: string; type: string; id: string; elementId: string; title: string; description: string; status?: string; applicabilityNotes?: string;
  values?: Record<string, string>; details?: Record<string, string>; tagline?: string; principles?: string[];
  measures?: Measure[]; pattern?: Pattern; sources?: string[]; links?: Record<string, Link[]>; incoming?: Record<string, string[]>;
}
interface Source { package: string; id: string; sourceId: string; packageId: string; title: string; url: string; kind: string; publicationDate?: string; lastReviewedAt: string; note?: string }
interface Answer { key?: string; value?: string; label: string }
interface Point { when: string[]; to: string[]; why: string }
interface Question { package: string; set: string; id: string; questionId: string; prompt: string; kind: string; options?: Answer[]; points?: Point[] }
interface QuestionSet { package: string; id: string; assessmentId: string; packageId: string; title: string; description?: string; questions: Question[] }
interface Target { id: string; title: string; type: string; typeLabel: string; packageTitle: string; folder: string; own: boolean }
interface Choice { id: string; label: string; hint?: string }
interface State {
  release?: string; draft?: boolean; problems?: string[]; today: string;
  /** A publisher's site, rather than the library, which publishes by pushing to main. */
  publisher: boolean;
  packages: { name: string; title: string }[];
  groups: Record<string, Choice[]>;
  patternFields: Choice[];
  statuses: Choice[];
  sections: Record<string, string>;
  elements: Item[];
  sources: Source[];
  discovery: QuestionSet[];
  targets: Target[];
}
/** What a new element starts with, when it's added from somewhere in particular. */
interface Start {
  package?: string;
  links?: Record<string, Link[]>;
  incoming?: Record<string, string[]>;
  /** What to offer first in the outcomes it could contribute to. */
  suggest?: string[];
  /** Go to its page once it's saved, as something new from the bar does. */
  thenGo?: boolean;
}

type Props = Record<string, string | boolean | ((e: Event) => void)>;

const names: Record<string, { a: string; word: string }> = {
  mission: { a: 'a mission', word: 'mission' },
  outcome: { a: 'an outcome', word: 'outcome' },
  capability: { a: 'a capability', word: 'capability' },
  requirement: { a: 'a requirement', word: 'requirement' },
  implementationPattern: { a: 'a pattern', word: 'pattern' },
  solution: { a: 'a solution', word: 'solution' },
  resource: { a: 'a resource', word: 'resource' },
};

/** Makes an element, with its attributes, handlers, and children. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== 'list') (el as unknown as Record<string, unknown>)[key] = value;
    else if (value !== false) el.setAttribute(key, String(value));
  }
  el.append(...children.filter((c): c is Node | string => Boolean(c)));
  return el;
}

/** The ID of something new, which follows what it's named from until someone changes it. */
function idInput(from: HTMLInputElement | HTMLTextAreaElement) {
  const id = h('input', { value: idFromTitle(from.value), pattern: '[a-z0-9]+(-[a-z0-9]+)*', title: 'Lowercase letters and numbers, with hyphens between words', autocomplete: 'off', spellcheck: false });
  let chosen = false;
  id.addEventListener('input', () => { chosen = id.value !== ''; });
  from.addEventListener('input', () => { if (!chosen) id.value = idFromTitle(from.value); });
  return id;
}
const ID_HINT = 'Short and lasting. It’s in this item’s web address and in every link to it, so it can’t change later.';

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`/__editor/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as { problems?: string[] };
  if (!res.ok) throw new Error((data.problems ?? ['That didn’t work.']).join('\n'));
  return data;
}

const SELECTED = 'site-editor-selected';

/** Reloads the page, coming back to what was selected in the explorer. */
function reloadHere() {
  const selected = document.querySelector<HTMLElement>('.ex-card[aria-pressed="true"]')?.dataset.node;
  if (selected) sessionStorage.setItem(SELECTED, selected);
  location.reload();
}

function restoreSelection() {
  const selected = sessionStorage.getItem(SELECTED);
  sessionStorage.removeItem(SELECTED);
  if (selected) document.querySelector<HTMLElement>(`.ex-card[data-node="${CSS.escape(selected)}"]`)?.click();
}

const onSite = (path: string) => `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}${path}`;
const pageOf = (state: State, type: string, id: string) => onSite(`${state.sections[type]}/${id}/`);

function problemList(box: HTMLElement, message: string) {
  box.replaceChildren(...message.split('\n').map((line) => h('p', {}, line)));
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

interface PickerOptions {
  /** The types it can link to. */
  types: string[];
  /** Only your own items, for links the library can't be on the other end of. */
  ownOnly?: boolean;
  placeholder: string;
  /** Offers saying a pattern covers only part, with a note about it. */
  coverage?: boolean;
  /** Offers a note about each link. */
  note?: boolean;
  /** Takes one item, not a list. */
  one?: boolean;
  /** Only items in this package. */
  inPackage?: string;
  /** An item not to offer, which is the one being edited. */
  not?: string;
  /** Items to offer before any search. */
  suggest?: string[];
  /** What to search, when it isn't everything an element can link to. */
  pool?: () => Target[];
  /** Offers making a new item, which it's then given to add. */
  create?: { label: string; open: (add: (target: Target) => void) => void };
}

/** The list of what an item links to, and the search that adds to it. */
function linkPicker(state: State, links: Link[], options: PickerOptions) {
  const pool = () => options.pool?.() ?? state.targets;
  const find = (id: string) => pool().find((t) => t.id === id);
  const chosen = h('ul', { className: 'site-editor-links' });
  const results = h('ul', { className: 'site-editor-results', hidden: true });
  const suggestions = h('div', { className: 'site-editor-suggest' });
  const search = h('input', { type: 'search', placeholder: options.placeholder, autocomplete: 'off', 'aria-label': options.placeholder });

  const extras = (link: Link) => {
    const parts: HTMLElement[] = [];
    if (options.coverage) {
      parts.push(h('label', { className: 'site-editor-check' },
        h('input', { type: 'checkbox', checked: link.coverage === 'partial', onchange: (e: Event) => (link.coverage = (e.target as HTMLInputElement).checked ? 'partial' : undefined) }),
        ' Covers part of it'));
    }
    return parts;
  };

  const drawChosen = () => {
    chosen.replaceChildren(
      ...links.map((link, i) => {
        const target = find(link.to);
        const note = (options.coverage || options.note) && h('input', { className: 'site-editor-links__note', value: link.note ?? '', placeholder: 'A note about this link, if it needs one', 'aria-label': 'A note about this link', oninput: (e: Event) => (link.note = (e.target as HTMLInputElement).value.trim() || undefined) });
        return h('li', {},
          h('span', { className: 'site-editor-links__name' }, h('strong', {}, target?.title ?? link.to), h('small', {}, target ? ` ${target.typeLabel} · ${target.packageTitle}` : '')),
          ...extras(link),
          h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': `Remove ${target?.title ?? link.to}`, onclick: () => { links.splice(i, 1); redraw(); } }, '✕'),
          note);
      }),
    );
  };

  const drawSuggestions = () => {
    const open = (options.suggest ?? []).flatMap((id) => (find(id) && !links.some((l) => l.to === id) ? [find(id)!] : []));
    suggestions.replaceChildren(...open.map((t) => h('button', { type: 'button', onclick: () => add(t) }, `+ ${t.title}`)));
  };

  const redraw = () => {
    drawChosen();
    drawSuggestions();
    search.hidden = Boolean(options.one && links.length);
  };

  const add = (target: Target) => {
    if (!links.some((l) => l.to === target.id)) links.push({ to: target.id });
    search.value = '';
    results.hidden = true;
    redraw();
    search.focus();
  };

  const matches = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return pool()
      .filter((t) => options.types.includes(t.type) && (!options.ownOnly || t.own) && (!options.inPackage || t.folder === options.inPackage) && t.id !== options.not && !links.some((l) => l.to === t.id))
      .filter((t) => words.every((w) => `${t.title} ${t.typeLabel} ${t.packageTitle}`.toLowerCase().includes(w)))
      .slice(0, 12);
  };

  search.addEventListener('input', () => {
    const found = matches();
    results.replaceChildren(
      ...found.map((t) => h('li', {}, h('button', { type: 'button', onclick: () => add(t) }, h('strong', {}, t.title), h('small', {}, ` ${t.typeLabel} · ${t.packageTitle}`)))),
    );
    results.hidden = !search.value.trim();
    if (!found.length && search.value.trim()) results.append(h('li', { className: 'site-editor-results__none' }, 'Nothing matches that.'));
  });
  // Enter takes the first match, rather than sending the form.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = matches()[0];
    if (first) add(first);
  });

  redraw();
  const create = options.create;
  return h('div', {}, chosen, suggestions, search, results,
    create && h('button', { type: 'button', className: 'site-editor-link', onclick: () => create.open(add) }, create.label));
}

/** Rows of free details, such as an edition or a contract vehicle. */
function detailRows(attributes: [string, string][]) {
  const rows = h('div', { className: 'site-editor-details' });
  const draw = () => {
    rows.replaceChildren(
      ...attributes.map((row, i) =>
        h('div', { className: 'site-editor-details__row' },
          h('input', { value: row[0], placeholder: 'Name, such as editions', 'aria-label': 'Detail name', oninput: (e: Event) => (row[0] = (e.target as HTMLInputElement).value) }),
          h('input', { value: row[1], placeholder: 'What it says', 'aria-label': 'Detail value', oninput: (e: Event) => (row[1] = (e.target as HTMLInputElement).value) }),
          h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Remove this detail', onclick: () => { attributes.splice(i, 1); draw(); } }, '✕'))),
      h('button', { type: 'button', className: 'site-editor-link', onclick: () => { attributes.push(['', '']); draw(); } }, '+ Add a detail'),
    );
  };
  draw();
  return rows;
}

/** Rows of an outcome's measures. */
function measureRows(measures: Measure[]) {
  const rows = h('div', { className: 'site-editor-measures' });
  const draw = () => {
    rows.replaceChildren(
      ...measures.map((m, i) =>
        h('div', { className: 'site-editor-measures__row' },
          h('input', { value: m.title, placeholder: 'What’s measured, such as share of the plan completed', 'aria-label': 'Measure title', oninput: (e: Event) => (m.title = (e.target as HTMLInputElement).value) }),
          h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Remove this measure', onclick: () => { measures.splice(i, 1); draw(); } }, '✕'),
          h('input', { value: m.description, placeholder: 'How it’s worked out', 'aria-label': 'Measure description', oninput: (e: Event) => (m.description = (e.target as HTMLInputElement).value) }))),
      h('button', { type: 'button', className: 'site-editor-link', onclick: () => { measures.push({ title: '', description: '' }); draw(); } }, '+ Add a measure'),
    );
  };
  draw();
  return rows;
}

const lines = (list: string[] = []) => list.join('\n');
const statements = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

const field = (label: string, control: HTMLElement, hint?: string) => h('label', { className: 'site-editor-field' }, h('span', {}, label), control, hint && h('small', {}, hint));
const group = (label: string, body: HTMLElement, hint?: string) => h('fieldset', {}, h('legend', {}, label), hint && h('small', {}, hint), body);
const options = (choices: Choice[], current?: string) => choices.map((c) => h('option', { value: c.id, selected: c.id === current }, c.label));
const asLinks = (ids: string[] = []): Link[] => ids.map((to) => ({ to }));

/** The form for adding an element of a type, or changing one of yours. */
function openForm(state: State, type: string, existing?: Item, start: Start = {}) {
  const name = names[type];
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const links: Record<string, Link[]> = { ...copy(start.links ?? {}), ...copy(existing?.links ?? {}) };
  const linksFor = (predicate: string) => (links[predicate] ??= []);
  const incoming: Record<string, Link[]> = Object.fromEntries(['seeks', 'contributes_to', 'satisfies', 'candidate_pattern', 'implements'].map((p) => [p, asLinks(existing?.incoming?.[p] ?? start.incoming?.[p])]));
  const details = Object.entries(existing?.details ?? {});
  const measures: Measure[] = copy(existing?.measures ?? []);
  const cited = asLinks(existing?.sources);

  const title = h('input', { value: existing?.title ?? '', required: true });
  const chosenId = idInput(title);
  const description = h('textarea', { rows: '4', required: true, value: existing?.description ?? '' });
  const status = h('select', {}, ...options(state.statuses, existing?.status ?? (state.publisher ? 'draft' : 'reference')));
  const inPackage = h('select', {}, ...state.packages.map((p) => h('option', { value: p.name, selected: p.name === defaultPackage(state, type, start) }, p.title)));
  const problems = h('div', { className: 'site-editor-problems', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', className: 'site-editor-primary' }, existing ? 'Save' : 'Add it');
  const close = () => dialog.close();
  const packageName = () => existing?.package ?? inPackage.value;
  // The package it will be in, which is what its sources have to come from.
  let home = packageName;

  // What's particular to each type, and how to read it back.
  const parts: (HTMLElement | false)[] = [];
  let read: () => Record<string, unknown> = () => ({});

  if (type === 'resource') {
    const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.resource, existing?.values?.kind));
    const checked = h('input', { type: 'date', value: existing?.values?.lastReviewedAt ?? state.today, required: true });
    const url = h('input', { type: 'url', value: existing?.values?.url ?? '', required: true, placeholder: 'https://' });
    const by = h('input', { value: existing?.values?.by ?? '' });
    parts.push(
      h('div', { className: 'site-editor-pair' }, field('Kind', kind), field('Last checked', checked)),
      field('Link', url),
      field('Description', description, 'What it is and who it’s for, in a sentence or two.'),
      group('Helps with', linkPicker(state, linksFor('helps_with'), { types: ['mission', 'outcome', 'capability', 'requirement', 'implementationPattern', 'solution'], placeholder: 'Search missions, outcomes, capabilities, requirements, patterns, and solutions', note: true })),
      field('By', by, 'Who made it, if it isn’t you.'),
      group('Other details', detailRows(details)),
    );
    read = () => ({
      values: { kind: kind.value, url: url.value, by: by.value, lastReviewedAt: checked.value },
      details: Object.fromEntries(details.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()])),
    });
  }

  if (type === 'mission') {
    const tagline = h('input', { value: existing?.tagline ?? '' });
    const principles = h('textarea', { rows: '4', value: (existing?.principles ?? []).join('\n') });
    parts.push(
      field('Status', status),
      field('Tagline', tagline, 'The phrase under its name, such as “Public access to agency records”.'),
      field('Description', description, 'Its purpose, in a sentence or two.'),
      field('Principles', principles, 'How its architecture should work, whichever way each part is sourced. One to a line.'),
      group('Outcomes it seeks', linkPicker(state, linksFor('seeks'), { types: ['outcome'], placeholder: 'Search outcomes' }), 'You can add outcomes from the mission’s page once it’s saved.'),
    );
    read = () => ({ tagline: tagline.value, principles: principles.value.split('\n') });
  }

  if (type === 'outcome') {
    const theme = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.outcome, existing?.values?.theme));
    parts.push(
      h('div', { className: 'site-editor-pair' }, field('What the public gets', theme), field('Status', status)),
      field('Description', description, 'The result, as someone outside the office would see it.'),
      group('Measures', measureRows(measures), 'Ways to tell how it’s going, such as a figure the office already reports.'),
      group('Missions that seek it', linkPicker(state, incoming.seeks, { types: ['mission'], ownOnly: true, placeholder: 'Search your missions' })),
      group('Capabilities that contribute', linkPicker(state, incoming.contributes_to, { types: ['capability'], placeholder: 'Search capabilities in any package' }), 'Choosing one from another package reuses it for this mission, without changing it.'),
    );
    read = () => ({ values: { theme: theme.value }, measures, incoming: { seeks: incoming.seeks.map((l) => l.to), contributes_to: incoming.contributes_to.map((l) => l.to) } });
  }

  if (type === 'capability') {
    const stage = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.capability, existing?.values?.stage));
    const varies = h('textarea', { rows: '3', value: existing?.applicabilityNotes ?? '' });
    parts.push(
      h('div', { className: 'site-editor-pair' }, field('Stage of the work', stage), field('Status', status)),
      field('Description', description, 'What must be possible. It usually starts “Ability to”.'),
      field('What varies', varies, 'What differs from one office to another, if anything. The page shows it as Applicability.'),
      group('Outcomes it contributes to', linkPicker(state, linksFor('contributes_to'), { types: ['outcome'], placeholder: 'Search outcomes', suggest: start.suggest })),
      group('Patterns that could provide it', linkPicker(state, linksFor('candidate_pattern'), { types: ['implementationPattern'], placeholder: 'Search patterns', coverage: true })),
      group('Requirements', linkPicker(state, linksFor('satisfies'), { types: ['requirement'], placeholder: 'Search requirements' })),
    );
    read = () => ({ values: { stage: stage.value }, applicabilityNotes: varies.value });
  }

  if (type === 'requirement') {
    const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.requirement, existing?.values?.kind));
    parts.push(
      h('div', { className: 'site-editor-pair' }, field('Kind', kind), field('Status', status)),
      field('Description', description, 'What it asks for, with any figure from the law or policy, such as 20 working days.'),
      group('Capability it belongs to', linkPicker(state, incoming.satisfies, { types: ['capability'], ownOnly: true, one: true, inPackage: existing?.package ?? start.package, placeholder: 'Search your capabilities' })),
    );
    // A requirement goes in its capability's package, so that's what says where.
    home = () => (existing ? existing.package : (state.targets.find((t) => t.id === incoming.satisfies[0]?.to)?.folder ?? inPackage.value));
    read = () => ({ values: { kind: kind.value }, incoming: { satisfies: incoming.satisfies.map((l) => l.to) }, package: home() });
  }

  if (type === 'implementationPattern') {
    const pattern: Pattern = copy(existing?.pattern ?? { layer: '' });
    const layer = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.layer, pattern.layer));
    const layerHint = () => state.groups.layer.find((l) => l.id === layer.value)?.hint ?? '';
    const layerField = field('Layer', layer, layerHint() || ' ');
    layer.addEventListener('change', () => (layerField.querySelector('small')!.textContent = layerHint()));
    const listOf = (id: string) => pattern[id as 'parts'];
    const areas = new Map(state.patternFields.map((f) => [f.id, h('textarea', { rows: '3', value: lines(listOf(f.id)) })]));
    parts.push(
      h('div', { className: 'site-editor-pair' }, layerField, field('Status', status)),
      field('Description', description, 'What it is, in a sentence or two. Patterns usually start “An example architecture:”.'),
      ...state.patternFields.map((f) => field(f.label, areas.get(f.id)!, `${f.hint} One to a line.`)),
      group('Solutions', linkPicker(state, incoming.implements, { types: ['solution'], placeholder: 'Search solutions' }), 'The ways to source it. Add one from the pattern’s page with + Add a solution.'),
      group('Capabilities it could provide', linkPicker(state, incoming.candidate_pattern, { types: ['capability'], placeholder: 'Search capabilities in any package' }), 'Choosing one from another package offers this pattern there, without changing it.'),
      group('Needs', linkPicker(state, linksFor('depends_on'), { types: ['implementationPattern'], placeholder: 'Search patterns', not: existing?.elementId, note: true }), 'Patterns it can’t work without, however it’s sourced. A mission with this pattern has to have them too.'),
      group('Works with', linkPicker(state, linksFor('works_with'), { types: ['implementationPattern'], placeholder: 'Search patterns', not: existing?.elementId, note: true })),
    );
    read = () => ({
      pattern: { ...pattern, layer: layer.value, ...Object.fromEntries(state.patternFields.map((f) => [f.id, statements(areas.get(f.id)!.value)])) },
      incoming: { candidate_pattern: incoming.candidate_pattern.map((l) => l.to), implements: incoming.implements.map((l) => l.to) },
    });
  }

  if (type === 'solution') {
    const pattern: Pattern = copy(existing?.pattern ?? {});
    const approach = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.solution, existing?.values?.approach));
    const approachHint = () => state.groups.solution.find((a) => a.id === approach.value)?.hint ?? '';
    const approachField = field('Approach', approach, approachHint() || ' ');
    approach.addEventListener('change', () => (approachField.querySelector('small')!.textContent = approachHint()));
    const said = state.patternFields.filter((f) => f.id !== 'parts');
    const areas = new Map(said.map((f) => [f.id, h('textarea', { rows: '2', value: lines(pattern[f.id as 'strengths']) })]));
    const url = h('input', { type: 'url', value: existing?.values?.url ?? '', placeholder: 'https://' });
    const by = h('input', { value: existing?.values?.by ?? '' });
    const checked = h('input', { type: 'date', value: existing?.values?.lastReviewedAt ?? '' });
    parts.push(
      h('div', { className: 'site-editor-pair' }, approachField, field('Status', status)),
      field('Description', description, 'What it is, and how it sources the pattern, in a sentence or two.'),
      group('Implements', linkPicker(state, linksFor('implements'), { types: ['implementationPattern'], placeholder: 'Search patterns' }), 'The patterns it sources. One platform can implement several.'),
      ...said.map((f) => field(f.label, areas.get(f.id)!, `What’s particular to this solution. One to a line.`)),
      group('Needs', linkPicker(state, linksFor('depends_on'), { types: ['implementationPattern'], placeholder: 'Search patterns', note: true }), 'Patterns it can’t work without, when it’s the one chosen.'),
      h('details', { open: Boolean(existing?.values?.url) },
        h('summary', {}, 'A link, for a product'),
        field('Link', url, 'Where to read about it.'),
        h('div', { className: 'site-editor-pair' }, field('By', by, 'Who makes it, if it isn’t you.'), field('Last checked', checked))),
    );
    read = () => ({
      values: { approach: approach.value, url: url.value.trim(), by: by.value.trim(), lastReviewedAt: url.value.trim() ? checked.value || state.today : '' },
      pattern: Object.fromEntries(said.map((f) => [f.id, statements(areas.get(f.id)!.value)])),
    });
  }

  if (type !== 'resource') {
    parts.push(group('Sources', linkPicker(state, cited, {
      types: ['source'],
      placeholder: 'Search this package’s sources',
      pool: () => sourcesAsTargets(state, home()),
      create: { label: '+ Add a new source', open: (add) => openSource(state, undefined, { package: home(), then: (s) => add(sourcesAsTargets(state, s.package).find((t) => t.id === s.id)!) }) },
    }), 'What it’s based on, such as a law or a standard.'));
  }

  const failed = (e: unknown) => {
    save.disabled = false;
    problemList(problems, e instanceof Error ? e.message : String(e));
  };

  const remove = async (button: HTMLButtonElement) => {
    if (button.dataset.sure !== 'yes') {
      button.dataset.sure = 'yes';
      button.textContent = type === 'resource' ? 'Yes, delete it' : 'Yes, delete it and its links';
      return;
    }
    button.disabled = true;
    try {
      await post('delete', { package: existing!.package, type, id: existing!.id });
      const onItsPage = document.querySelector(`[data-element="${CSS.escape(existing!.elementId)}"]`);
      if (onItsPage) location.assign(import.meta.env.BASE_URL);
      else reloadHere();
    } catch (e) {
      button.disabled = false;
      failed(e);
    }
  };

  const form = h('form', {
    method: 'dialog',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      problems.hidden = true;
      save.disabled = true;
      try {
        const saved = await post('save', {
          type,
          package: packageName(),
          ...(existing ? { id: existing.id } : { chosenId: chosenId.value }),
          title: title.value,
          description: description.value,
          status: status.value,
          links,
          ...(type !== 'resource' && { sources: cited.map((l) => l.to) }),
          ...read(),
        });
        // Something new from the bar has nowhere to show on this page, so go to its own.
        const fromTheBar = !existing && (!start.package || start.thenGo);
        if (fromTheBar && type !== 'resource') location.assign(pageOf(state, type, String(saved.id)));
        else reloadHere();
      } catch (err) {
        failed(err);
      }
    },
  },
    h('header', {}, h('h2', {}, existing ? `Change this ${name.word}` : `Add ${name.a}`), h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Close', onclick: close }, '✕')),
    problems,
    field('Title', title, type === 'requirement' ? 'An instruction, such as “Publish the approved audit plan”.' : undefined),
    !existing && field('ID', chosenId, ID_HINT),
    ...parts.filter((p): p is HTMLElement => Boolean(p)),
    !existing && !start.package && type !== 'requirement' && state.packages.length > 1 && field('Package', inPackage),
    h('footer', {},
      existing && h('button', { type: 'button', className: 'site-editor-danger', onclick: (e: Event) => void remove(e.currentTarget as HTMLButtonElement) }, 'Delete'),
      h('span', { className: 'site-editor-spacer' }),
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      save),
  );

  const dialog = h('dialog', { className: 'site-editor-dialog', onclose: () => dialog.remove() }, form);
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}

/** A package's sources, as something a picker can search. */
const sourcesAsTargets = (state: State, packageName: string): Target[] =>
  state.sources
    .filter((s) => s.package === packageName)
    .map((s) => ({ id: s.id, title: s.title, type: 'source', typeLabel: state.groups.source.find((k) => k.id === s.kind)?.label ?? 'Source', packageTitle: state.packages.find((p) => p.name === s.package)?.title ?? '', folder: s.package, own: true }));

interface PlainForm {
  heading: string;
  fields: (HTMLElement | false | undefined)[];
  submit: string;
  /** Sends the form. A problem it throws shows in the form. */
  send: () => Promise<void>;
  /** Deletes what it's about, after asking, with the words to ask in. */
  remove?: { confirm: string; send: () => Promise<void> };
}

/** A form for something that isn't an element, which has less to it. */
function plainForm({ heading, fields, submit, send, remove }: PlainForm) {
  const problems = h('div', { className: 'site-editor-problems', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', className: 'site-editor-primary' }, submit);
  const attempt = async (work: () => Promise<void>, button: HTMLButtonElement) => {
    problems.hidden = true;
    button.disabled = true;
    try {
      await work();
    } catch (e) {
      button.disabled = false;
      problemList(problems, e instanceof Error ? e.message : String(e));
    }
  };
  const form = h('form', { method: 'dialog', onsubmit: (e: Event) => { e.preventDefault(); void attempt(send, save); } },
    h('header', {}, h('h2', {}, heading), h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕')),
    problems,
    ...fields.filter((x): x is HTMLElement => Boolean(x)),
    h('footer', {},
      remove && h('button', { type: 'button', className: 'site-editor-danger', onclick: (e: Event) => {
        const button = e.currentTarget as HTMLButtonElement;
        if (button.dataset.sure === 'yes') return void attempt(remove.send, button);
        button.dataset.sure = 'yes';
        button.textContent = remove.confirm;
      } }, 'Delete'),
      h('span', { className: 'site-editor-spacer' }),
      h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      save));
  const dialog = h('dialog', { className: 'site-editor-dialog', onclose: () => dialog.remove() }, form);
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('input, textarea')?.focus();
  return dialog;
}

const packageSelect = (state: State, current?: string) => h('select', {}, ...state.packages.map((p) => h('option', { value: p.name, selected: p.name === current }, p.title)));

/** The form for a source. Given `then`, it hands the new source back, for citing, and the page stays as it is. */
function openSource(state: State, existing?: Source, start: { package?: string; then?: (source: Source) => void } = {}) {
  const title = h('input', { value: existing?.title ?? '', required: true });
  const chosenId = idInput(title);
  const url = h('input', { type: 'url', value: existing?.url ?? '', required: true, placeholder: 'https://' });
  const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.source, existing?.kind));
  const published = h('input', { type: 'date', value: existing?.publicationDate ?? '' });
  const checked = h('input', { type: 'date', value: existing?.lastReviewedAt ?? state.today, required: true });
  const note = h('textarea', { rows: '3', value: existing?.note ?? '' });
  const inPackage = packageSelect(state, start.package ?? defaultPackage(state, 'source', {}));
  const packageName = () => existing?.package ?? start.package ?? inPackage.value;
  const dialog = plainForm({
    heading: existing ? 'Change this source' : 'Add a source',
    submit: existing ? 'Save' : 'Add it',
    fields: [
      field('Title', title),
      !existing && field('ID', chosenId, 'Short and lasting. Items cite the source by it, so it can’t change later.'),
      field('Link', url),
      h('div', { className: 'site-editor-pair' }, field('Kind', kind), field('Last checked', checked), field('Published', published, 'If it has a date.')),
      field('Note', note, 'What it’s cited for.'),
      !existing && !start.package && state.packages.length > 1 && field('Package', inPackage, 'A package’s items can cite only its own sources.'),
    ],
    send: async () => {
      const fields = { package: packageName(), title: title.value, url: url.value, kind: kind.value, lastReviewedAt: checked.value, ...(published.value && { publicationDate: published.value }), note: note.value };
      const saved = await post('source', { ...fields, ...(existing ? { id: existing.id } : { chosenId: chosenId.value }) });
      if (start.then) {
        const source = { ...fields, id: String(saved.id), sourceId: `src:${saved.id}`, packageId: '' };
        state.sources.push(source);
        dialog.close();
        start.then(source);
      } else if (existing) reloadHere();
      else location.assign(onSite('sources/'));
    },
    remove: existing && { confirm: 'Yes, delete it and its citations', send: async () => { await post('delete-source', { package: existing.package, id: existing.id }); reloadHere(); } },
  });
}

/** The form for a set's title and description. A new set starts from openQuestion. */
function openSet(state: State, set: QuestionSet) {
  const title = h('input', { value: set.title, required: true });
  const description = h('textarea', { rows: '3', value: set.description ?? '' });
  plainForm({
    heading: 'Change this question set',
    submit: 'Save',
    fields: [field('Title', title), field('Description', description, 'When it’s for, and what it covers.')],
    send: async () => { await post('set', { package: set.package, id: set.id, title: title.value, description: description.value }); reloadHere(); },
    remove: { confirm: 'Yes, delete it and its questions', send: async () => { await post('delete-set', { package: set.package, id: set.id }); location.assign(onSite('discovery/')); } },
  });
}

const CHOICE = ['single-choice', 'multiple-choice'];
const BOOLEAN_ANSWERS: Answer[] = [{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }];

interface Pointer { when: string[]; to: Link[]; why: string }

/** The form for a question, and for a set too when it starts a new one. */
function openQuestion(state: State, set?: QuestionSet, existing?: Question) {
  const prompt = h('textarea', { rows: '2', required: true, value: existing?.prompt ?? '' });
  const kind = h('select', { required: true }, ...options(state.groups.question, existing?.kind ?? 'single-choice'));
  const setTitle = h('input', { required: true });
  const setDescription = h('textarea', { rows: '2' });
  const inPackage = packageSelect(state, defaultPackage(state, 'discovery', {}));

  let keys = 0;
  const answers: Answer[] = (existing?.options ?? []).map((o) => ({ ...o, key: o.value }));
  if (!existing) answers.push({ key: `new-${++keys}`, label: '' }, { key: `new-${++keys}`, label: '' });
  const pointers: Pointer[] = (existing?.points ?? []).map((p) => ({ when: [...p.when], to: asLinks(p.to), why: p.why }));

  const choice = () => CHOICE.includes(kind.value);
  const answerable = () => choice() || kind.value === 'boolean';
  const choices = () => (kind.value === 'boolean' ? BOOLEAN_ANSWERS : answers);

  const answerRows = h('div', { className: 'site-editor-details' });
  const pointerRows = h('div', { className: 'site-editor-ways' });
  const answersGroup = group('Answers', answerRows);
  const pointersGroup = group('What the answers point to', pointerRows, 'Something worth exploring next, such as a capability or a pattern, and why.');

  const drawAnswers = () => {
    answerRows.replaceChildren(
      ...answers.map((answer, i) =>
        h('div', { className: 'site-editor-answer' },
          h('input', { value: answer.label, required: true, 'aria-label': `Answer ${i + 1}`, oninput: (e: Event) => (answer.label = (e.target as HTMLInputElement).value), onchange: () => drawPointers() }),
          h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Remove this answer', onclick: () => {
            answers.splice(i, 1);
            for (const pointer of pointers) pointer.when = pointer.when.filter((w) => w !== answer.key);
            drawAnswers();
            drawPointers();
          } }, '✕'))),
      h('button', { type: 'button', className: 'site-editor-link', onclick: () => { answers.push({ key: `new-${++keys}`, label: '' }); drawAnswers(); drawPointers(); } }, '+ Add an answer'),
    );
  };

  const drawPointers = () => {
    pointerRows.replaceChildren(
      ...pointers.map((pointer, i) =>
        h('div', { className: 'site-editor-way' },
          h('div', { className: 'site-editor-way__top' },
            h('div', { className: 'site-editor-answers', role: 'group', 'aria-label': 'Which answers' },
              ...choices().map((answer) =>
                h('label', { className: 'site-editor-check' },
                  h('input', { type: 'checkbox', checked: pointer.when.includes(answer.key!), onchange: (e: Event) => {
                    pointer.when = (e.target as HTMLInputElement).checked ? [...pointer.when, answer.key!] : pointer.when.filter((w) => w !== answer.key);
                  } }),
                  ` ${answer.label || 'An answer'}`))),
            h('button', { type: 'button', className: 'site-editor-remove', 'aria-label': 'Remove this pointer', onclick: () => { pointers.splice(i, 1); drawPointers(); } }, '✕')),
          linkPicker(state, pointer.to, { types: ['outcome', 'measure', 'capability', 'requirement', 'implementationPattern'], placeholder: 'Search outcomes, measures, capabilities, requirements, and patterns' }),
          h('input', { value: pointer.why, required: true, placeholder: 'Why, such as “The office may not have this yet”', 'aria-label': 'Why it points there', oninput: (e: Event) => (pointer.why = (e.target as HTMLInputElement).value) }))),
      h('button', { type: 'button', className: 'site-editor-link', onclick: () => { pointers.push({ when: [], to: [], why: '' }); drawPointers(); } }, '+ Add a pointer'),
    );
  };

  const drawKind = () => {
    answersGroup.hidden = !choice();
    for (const input of answerRows.querySelectorAll('input')) input.required = choice();
    pointersGroup.hidden = !answerable();
    for (const input of pointerRows.querySelectorAll<HTMLInputElement>('input:not([type=search]):not([type=checkbox])')) input.required = answerable();
  };
  kind.addEventListener('change', () => {
    // Yes and no aren't the choices a pointer may have named.
    for (const pointer of pointers) pointer.when = pointer.when.filter((w) => choices().some((c) => c.key === w));
    drawPointers();
    drawKind();
  });
  drawAnswers();
  drawPointers();
  drawKind();

  const packageName = () => set?.package ?? inPackage.value;
  const chosenId = idInput(prompt);
  plainForm({
    heading: existing ? 'Change this question' : set ? 'Add a question' : 'Add a question set',
    submit: existing ? 'Save' : 'Add it',
    fields: [
      !set && field('Set title', setTitle),
      !set && field('Description', setDescription, 'When it’s for, and what it covers.'),
      !set && state.packages.length > 1 && field('Package', inPackage),
      field(set ? 'Question' : 'First question', prompt, 'Ask how the office works today, never about a particular case or person.'),
      !existing && field('ID', chosenId, 'Short and lasting, such as foia-tracking-tools. Answers are saved by it, so it can’t change later.'),
      field('How it’s answered', kind),
      answersGroup,
      pointersGroup,
    ],
    send: async () => {
      const saved = await post('question', {
        package: packageName(),
        ...(set ? { set: set.id } : { newSet: { title: setTitle.value, description: setDescription.value } }),
        ...(existing ? { id: existing.id } : { chosenId: chosenId.value }),
        prompt: prompt.value,
        kind: kind.value,
        options: choice() ? answers : [],
        points: answerable() ? pointers.filter((p) => p.when.length || p.to.length || p.why.trim()).map((p) => ({ when: p.when, to: p.to.map((l) => l.to), why: p.why })) : [],
      });
      if (set) reloadHere();
      else location.assign(onSite(`discovery/${String(saved.set)}/`));
    },
    remove: existing && set && { confirm: 'Yes, delete it', send: async () => { await post('delete-question', { package: set.package, set: set.id, id: existing.id }); reloadHere(); } },
  });
}

/** The form for starting a package, whose publisher's details come from your other packages. */
function openPackage(state: State) {
  const title = h('input', { required: true });
  const chosenId = idInput(title);
  const description = h('textarea', { rows: '3', required: true });
  const dialog = plainForm({
    heading: 'Add a package',
    submit: 'Add it',
    fields: [
      field('Title', title, 'What it holds, such as “Our Services” or a mission’s name.'),
      field('ID', chosenId, 'Short and lasting, such as federal-foia. It’s the package’s folder and the end of its package ID, so it can’t change later.'),
      field('Description', description),
    ],
    send: async () => {
      const saved = await post('package', { title: title.value, chosenId: chosenId.value, description: description.value });
      const name = String(saved.name);
      state.packages.push({ name, title: title.value.trim() });
      dialog.querySelector('form')!.replaceChildren(
        h('header', {}, h('h2', {}, 'Your package is ready')),
        h('p', {}, `“${title.value.trim()}” is in source/${name}/. It builds on nothing yet; the editor adds what it needs as you link to things.`),
        h('footer', {},
          h('span', { className: 'site-editor-spacer' }),
          h('button', { type: 'button', onclick: () => location.reload() }, 'Done'),
          h('button', { type: 'button', className: 'site-editor-primary', onclick: () => { dialog.close(); openForm(state, 'mission', undefined, { package: name, thenGo: true }); } }, 'Add a mission')));
    },
  });
}

/** Where something new goes: where it's being added from, or a package that already has that type. */
function defaultPackage(state: State, type: string, start: Start) {
  const having = type === 'source' ? state.sources[0]?.package : type === 'discovery' ? state.discovery[0]?.package : state.elements.find((e) => e.type === type)?.package;
  return start.package ?? having ?? state.packages[0]?.name;
}

function openPublish(state: State) {
  const problems = h('div', { className: 'site-editor-problems', role: 'alert', hidden: true });
  const go = h('button', { type: 'button', className: 'site-editor-primary' }, `Publish release ${state.release}`);
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Publishing…';
    try {
      const { message } = await post('publish', {});
      dialog.querySelector('form')!.replaceChildren(
        h('header', {}, h('h2', {}, `Release ${state.release} is published`)),
        h('p', {}, String(message)),
        h('footer', {}, h('span', { className: 'site-editor-spacer' }), h('button', { type: 'button', className: 'site-editor-primary', onclick: () => location.reload() }, 'Done')));
    } catch (e) {
      go.disabled = false;
      go.textContent = `Publish release ${state.release}`;
      problemList(problems, e instanceof Error ? e.message : String(e));
    }
  });
  const dialog = h('dialog', { className: 'site-editor-dialog site-editor-dialog--small', onclose: () => dialog.remove() },
    h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, `Publish release ${state.release}?`)),
      problems,
      h('p', {}, 'Tools and people may keep what you share, so this version won’t change after this. Your next changes go in the release after it.'),
      h('p', {}, 'This also builds the site into dist/, ready to copy to where you host it.'),
      h('footer', {}, h('span', { className: 'site-editor-spacer' }), h('button', { type: 'button', onclick: () => dialog.close() }, 'Not yet'), go)));
  document.body.append(dialog);
  dialog.showModal();
}

/** What the bar can add. */
function additions(state: State): [string, () => void][] {
  return [
    ...['resource', 'mission', 'outcome', 'capability', 'requirement', 'implementationPattern', 'solution'].map((type): [string, () => void] => [`+ Add ${names[type].a}`, () => openForm(state, type)]),
    ['+ Add a source', () => openSource(state)],
    ['+ Add a question set', () => openQuestion(state)],
    ['+ Add a package', () => openPackage(state)],
  ];
}

function drawBar(state: State) {
  const status = state.problems
    ? h('span', { className: 'site-editor-bar__problem', title: state.problems.join('\n') }, 'source/ has a problem. See the terminal.')
    : h('span', {}, `Release ${state.release}`, h('span', { className: state.draft ? 'site-editor-pill site-editor-pill--draft' : 'site-editor-pill' }, state.draft ? 'Draft' : 'Published'));
  const menu = h('details', { className: 'site-editor-menu' },
    h('summary', {}, '+ Add'),
    h('div', {}, ...additions(state).map(([label, open]) => h('button', { type: 'button', onclick: () => { menu.open = false; open(); } }, label))));
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  const bar = h('div', { className: 'site-editor-bar', role: 'region', 'aria-label': 'Editor' },
    h('strong', {}, 'Editing'),
    status,
    h('span', { className: 'site-editor-spacer' }),
    menu,
    state.draft && state.publisher && h('button', { type: 'button', className: 'site-editor-primary', onclick: () => openPublish(state) }, 'Publish'),
    state.draft && !state.publisher && h('span', {}, 'Commit and push to publish'));
  document.body.prepend(bar);
}

/** What you can do from one of your own items, on its page or in the explorer's panel. */
function actions(state: State, item: Item) {
  const button = (label: string, onclick: () => void) => h('button', { type: 'button', className: 'site-editor-edit', onclick }, label);
  const outcomes = item.type === 'mission' ? (item.links?.seeks ?? []).map((l) => l.to) : [item.elementId];
  const add = {
    outcome: () => openForm(state, 'outcome', undefined, { package: item.package, incoming: { seeks: [item.elementId] } }),
    capability: () => openForm(state, 'capability', undefined, item.type === 'outcome'
      ? { package: item.package, links: { contributes_to: [{ to: item.elementId }] } }
      : { package: item.package, suggest: outcomes }),
    requirement: () => openForm(state, 'requirement', undefined, { package: item.package, incoming: { satisfies: [item.elementId] } }),
    pattern: () => openForm(state, 'implementationPattern', undefined, { package: item.package, incoming: { candidate_pattern: [item.elementId] } }),
    solution: () => openForm(state, 'solution', undefined, { package: item.package, links: { implements: [{ to: item.elementId }] } }),
  };
  return h('div', { className: 'site-editor-actions' },
    button(`Edit this ${names[item.type].word}`, () => openForm(state, item.type, item)),
    item.type === 'mission' && button('+ Add an outcome', add.outcome),
    (item.type === 'mission' || item.type === 'outcome') && button('+ Add a capability', add.capability),
    item.type === 'capability' && button('+ Add a requirement', add.requirement),
    item.type === 'capability' && button('+ Add a pattern', add.pattern),
    item.type === 'implementationPattern' && button('+ Add a solution', add.solution));
}

/** Finds what a page's place means among your own, by its package as well as its ID, since another publisher's could have the same ID. */
const ownBy = <T extends { packageId: string }>(items: T[], id: (item: T) => string) => {
  const byKey = new Map(items.map((item) => [`${item.packageId} ${id(item)}`, item]));
  return (spot: HTMLElement, value: string) => byKey.get(`${spot.dataset.package} ${value}`);
};

function drawReferenceButtons(state: State) {
  const button = (label: string, onclick: () => void) => h('button', { type: 'button', className: 'site-editor-edit', onclick }, label);
  const source = ownBy(state.sources, (s) => s.sourceId);
  for (const row of document.querySelectorAll<HTMLElement>('[data-source]')) {
    const found = source(row, row.dataset.source!);
    if (found) row.querySelector('th')?.append(button('Edit', () => openSource(state, found)));
  }
  const assessment = ownBy(state.discovery, (a) => a.assessmentId);
  for (const header of document.querySelectorAll<HTMLElement>('[data-assessment]')) {
    const set = assessment(header, header.dataset.assessment!);
    if (!set) continue;
    header.append(h('div', { className: 'site-editor-actions' }, button('Edit this set', () => openSet(state, set)), button('+ Add a question', () => openQuestion(state, set))));
    for (const spot of document.querySelectorAll<HTMLElement>('[data-question]')) {
      const question = set.questions.find((q) => q.questionId === spot.dataset.question);
      if (question) spot.append(button('Edit', () => openQuestion(state, set, question)));
    }
  }
}

function drawButtons(state: State) {
  const known = new Set(state.targets.map((t) => t.id));
  const own = new Map(state.elements.map((e) => [e.elementId, e]));

  for (const spot of document.querySelectorAll<HTMLElement>('[data-resources-for]')) {
    const id = spot.dataset.resourcesFor!;
    if (known.has(id)) spot.append(h('button', { type: 'button', className: 'site-editor-add', onclick: () => openForm(state, 'resource', undefined, { links: { helps_with: [{ to: id }] } }) }, '+ Add a resource here'));
  }
  for (const card of document.querySelectorAll<HTMLElement>('[data-resource-id]')) {
    const resource = own.get(card.dataset.resourceId!);
    if (resource) card.append(h('button', { type: 'button', className: 'site-editor-edit', onclick: () => openForm(state, 'resource', resource) }, 'Edit'));
  }
  for (const spot of document.querySelectorAll<HTMLElement>('[data-element], [data-detail]')) {
    const item = own.get(spot.dataset.element ?? spot.dataset.detail ?? '');
    if (item) spot.append(actions(state, item));
  }
}

async function start() {
  const res = await fetch('/__editor/state');
  const state = (await res.json()) as State;
  drawBar(state);
  drawButtons(state);
  drawReferenceButtons(state);
  restoreSelection();
}

void start();
