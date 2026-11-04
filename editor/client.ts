// The editor on the pages, with `pnpm editor`: a bar across the top, a button
// wherever something can be added or changed, and a form. The pages mark those
// places with data-resources-for, data-resource-id, data-element, and
// data-detail, and otherwise don't know about the editor. After a save the page
// reloads, showing the real result.

import './client.css';

interface Link { to: string; way?: string; coverage?: 'partial'; note?: string }
interface Measure { id?: string; title: string; description: string }
interface Way { id?: string; approach: string; title: string; description?: string; strengths?: string[]; fitsWhen?: string[]; watchFor?: string[] }
interface Pattern { layer: string; parts?: string[]; strengths?: string[]; fitsWhen?: string[]; watchFor?: string[]; ways: Way[] }
interface Item {
  package: string; type: string; id: string; elementId: string; title: string; description: string; status?: string;
  values?: Record<string, string>; details?: Record<string, string>; tagline?: string; principles?: string[];
  measures?: Measure[]; pattern?: Pattern; links?: Record<string, Link[]>; incoming?: Record<string, string[]>;
}
interface Target { id: string; title: string; type: string; typeLabel: string; packageTitle: string; folder: string; own: boolean; ways: { id: string; title: string }[] }
interface Choice { id: string; label: string; hint?: string }
interface State {
  release?: string; draft?: boolean; problems?: string[]; today: string;
  packages: { name: string; title: string }[];
  groups: Record<string, Choice[]>;
  patternFields: Choice[];
  statuses: Choice[];
  sections: Record<string, string>;
  elements: Item[];
  targets: Target[];
}
/** What a new element starts with, when it's added from somewhere in particular. */
interface Start {
  package?: string;
  links?: Record<string, Link[]>;
  incoming?: Record<string, string[]>;
  /** What to offer first in the outcomes it could contribute to. */
  suggest?: string[];
}

type Props = Record<string, string | boolean | ((e: Event) => void)>;

const names: Record<string, { a: string; word: string }> = {
  mission: { a: 'a mission', word: 'mission' },
  outcome: { a: 'an outcome', word: 'outcome' },
  capability: { a: 'a capability', word: 'capability' },
  requirement: { a: 'a requirement', word: 'requirement' },
  implementationPattern: { a: 'a pattern', word: 'pattern' },
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

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`/__editor/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as { problems?: string[] };
  if (!res.ok) throw new Error((data.problems ?? ['That didn’t work.']).join('\n'));
  return data;
}

const SELECTED = 'kit-editor-selected';

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

const pageOf = (state: State, type: string, id: string) => `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}${state.sections[type]}/${id}/`;

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
  /** Offers a choice of one of a pattern's ways. */
  ways?: boolean;
  /** Offers a choice of these ways of the pattern being edited, for saying which one has the need. */
  ownWays?: { id?: string; title: string }[];
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
}

/** The list of what an item links to, and the search that adds to it. */
function linkPicker(state: State, links: Link[], options: PickerOptions) {
  const byId = new Map(state.targets.map((t) => [t.id, t]));
  const chosen = h('ul', { className: 'kit-editor-links' });
  const results = h('ul', { className: 'kit-editor-results', hidden: true });
  const suggestions = h('div', { className: 'kit-editor-suggest' });
  const search = h('input', { type: 'search', placeholder: options.placeholder, autocomplete: 'off', 'aria-label': options.placeholder });

  const extras = (link: Link, target?: Target) => {
    const parts: HTMLElement[] = [];
    const ways = options.ownWays ?? (options.ways ? target?.ways : undefined);
    if (ways?.length) {
      parts.push(h('select', { 'aria-label': options.ownWays ? 'Which way needs it' : 'Which way of sourcing it', onchange: (e: Event) => (link.way = (e.target as HTMLSelectElement).value || undefined) },
        h('option', { value: '' }, options.ownWays ? 'Whichever way it’s sourced' : 'Any way of sourcing it'),
        ...ways.map((w) => h('option', { value: w.id ?? '', selected: w.id === link.way }, w.title))));
    }
    if (options.coverage) {
      parts.push(h('label', { className: 'kit-editor-check' },
        h('input', { type: 'checkbox', checked: link.coverage === 'partial', onchange: (e: Event) => (link.coverage = (e.target as HTMLInputElement).checked ? 'partial' : undefined) }),
        ' Covers part of it'));
    }
    return parts;
  };

  const drawChosen = () => {
    chosen.replaceChildren(
      ...links.map((link, i) => {
        const target = byId.get(link.to);
        const note = (options.ways || options.coverage || options.note) && h('input', { className: 'kit-editor-links__note', value: link.note ?? '', placeholder: 'A note about this link, if it needs one', 'aria-label': 'A note about this link', oninput: (e: Event) => (link.note = (e.target as HTMLInputElement).value.trim() || undefined) });
        return h('li', {},
          h('span', { className: 'kit-editor-links__name' }, h('strong', {}, target?.title ?? link.to), h('small', {}, target ? ` ${target.typeLabel} · ${target.packageTitle}` : '')),
          ...extras(link, target),
          h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': `Remove ${target?.title ?? link.to}`, onclick: () => { links.splice(i, 1); redraw(); } }, '✕'),
          note);
      }),
    );
  };

  const drawSuggestions = () => {
    const open = (options.suggest ?? []).flatMap((id) => (byId.has(id) && !links.some((l) => l.to === id) ? [byId.get(id)!] : []));
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
    return state.targets
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
    if (!found.length && search.value.trim()) results.append(h('li', { className: 'kit-editor-results__none' }, 'Nothing matches that.'));
  });
  // Enter takes the first match, rather than sending the form.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = matches()[0];
    if (first) add(first);
  });

  redraw();
  return h('div', {}, chosen, suggestions, search, results);
}

/** Rows of free details, such as an edition or a contract vehicle. */
function detailRows(attributes: [string, string][]) {
  const rows = h('div', { className: 'kit-editor-details' });
  const draw = () => {
    rows.replaceChildren(
      ...attributes.map((row, i) =>
        h('div', { className: 'kit-editor-details__row' },
          h('input', { value: row[0], placeholder: 'Name, such as editions', 'aria-label': 'Detail name', oninput: (e: Event) => (row[0] = (e.target as HTMLInputElement).value) }),
          h('input', { value: row[1], placeholder: 'What it says', 'aria-label': 'Detail value', oninput: (e: Event) => (row[1] = (e.target as HTMLInputElement).value) }),
          h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': 'Remove this detail', onclick: () => { attributes.splice(i, 1); draw(); } }, '✕'))),
      h('button', { type: 'button', className: 'kit-editor-link', onclick: () => { attributes.push(['', '']); draw(); } }, '+ Add a detail'),
    );
  };
  draw();
  return rows;
}

/** Rows of an outcome's measures. */
function measureRows(measures: Measure[]) {
  const rows = h('div', { className: 'kit-editor-measures' });
  const draw = () => {
    rows.replaceChildren(
      ...measures.map((m, i) =>
        h('div', { className: 'kit-editor-measures__row' },
          h('input', { value: m.title, placeholder: 'What’s measured, such as share of the plan completed', 'aria-label': 'Measure title', oninput: (e: Event) => (m.title = (e.target as HTMLInputElement).value) }),
          h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': 'Remove this measure', onclick: () => { measures.splice(i, 1); draw(); } }, '✕'),
          h('input', { value: m.description, placeholder: 'How it’s worked out', 'aria-label': 'Measure description', oninput: (e: Event) => (m.description = (e.target as HTMLInputElement).value) }))),
      h('button', { type: 'button', className: 'kit-editor-link', onclick: () => { measures.push({ title: '', description: '' }); draw(); } }, '+ Add a measure'),
    );
  };
  draw();
  return rows;
}

const lines = (list: string[] = []) => list.join('\n');
const statements = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

/** Rows of a pattern's ways to source it, each with its fit tucked away until it's wanted. */
function wayRows(state: State, ways: Way[]) {
  const rows = h('div', { className: 'kit-editor-ways' });
  const said = state.patternFields.filter((f) => f.id !== 'parts');
  const draw = () => {
    rows.replaceChildren(
      ...ways.map((way, i) =>
        h('div', { className: 'kit-editor-way' },
          h('div', { className: 'kit-editor-way__top' },
            h('select', { required: true, 'aria-label': 'Approach', onchange: (e: Event) => (way.approach = (e.target as HTMLSelectElement).value) }, h('option', { value: '' }, 'Choose an approach'), ...options(state.groups.approach, way.approach)),
            ways.length > 1 && h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': 'Remove this way', onclick: () => { ways.splice(i, 1); draw(); } }, '✕'),
            h('input', { value: way.title, required: true, placeholder: 'What it is, such as “The agency’s case platform”', 'aria-label': 'Way title', oninput: (e: Event) => (way.title = (e.target as HTMLInputElement).value) })),
          h('textarea', { rows: '2', value: way.description ?? '', placeholder: 'How this way works, if that needs saying', 'aria-label': 'Way description', oninput: (e: Event) => (way.description = (e.target as HTMLTextAreaElement).value) }),
          h('details', { open: said.some((f) => way[f.id as 'strengths']?.length) },
            h('summary', {}, 'What’s particular to this way'),
            ...said.map((f) => field(f.label, h('textarea', { rows: '2', value: lines(way[f.id as 'strengths']), oninput: (e: Event) => (way[f.id as 'strengths'] = statements((e.target as HTMLTextAreaElement).value)) }), 'One to a line.'))))),
      h('button', { type: 'button', className: 'kit-editor-link', onclick: () => { ways.push({ approach: '', title: '' }); draw(); } }, '+ Add a way'),
    );
  };
  draw();
  return rows;
}

const field = (label: string, control: HTMLElement, hint?: string) => h('label', { className: 'kit-editor-field' }, h('span', {}, label), control, hint && h('small', {}, hint));
const group = (label: string, body: HTMLElement, hint?: string) => h('fieldset', {}, h('legend', {}, label), hint && h('small', {}, hint), body);
const options = (choices: Choice[], current?: string) => choices.map((c) => h('option', { value: c.id, selected: c.id === current }, c.label));
const asLinks = (ids: string[] = []): Link[] => ids.map((to) => ({ to }));

/** The form for adding an element of a type, or changing one of yours. */
function openForm(state: State, type: string, existing?: Item, start: Start = {}) {
  const name = names[type];
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const links: Record<string, Link[]> = { ...copy(start.links ?? {}), ...copy(existing?.links ?? {}) };
  const linksFor = (predicate: string) => (links[predicate] ??= []);
  const incoming: Record<string, Link[]> = Object.fromEntries(['seeks', 'contributes_to', 'satisfies', 'candidate_pattern'].map((p) => [p, asLinks(existing?.incoming?.[p] ?? start.incoming?.[p])]));
  const details = Object.entries(existing?.details ?? {});
  const measures: Measure[] = copy(existing?.measures ?? []);

  const title = h('input', { value: existing?.title ?? '', required: true });
  const description = h('textarea', { rows: '4', required: true, value: existing?.description ?? '' });
  const status = h('select', {}, ...options(state.statuses, existing?.status ?? 'draft'));
  const inPackage = h('select', {}, ...state.packages.map((p) => h('option', { value: p.name, selected: p.name === defaultPackage(state, type, start) }, p.title)));
  const problems = h('div', { className: 'kit-editor-problems', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', className: 'kit-editor-primary' }, existing ? 'Save' : 'Add it');
  const close = () => dialog.close();
  const packageName = () => existing?.package ?? inPackage.value;

  // What's particular to each type, and how to read it back.
  const parts: (HTMLElement | false)[] = [];
  let read: () => Record<string, unknown> = () => ({});

  if (type === 'resource') {
    const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.resource, existing?.values?.kind));
    const checked = h('input', { type: 'date', value: existing?.values?.lastReviewedAt ?? state.today, required: true });
    const url = h('input', { type: 'url', value: existing?.values?.url ?? '', required: true, placeholder: 'https://' });
    const by = h('input', { value: existing?.values?.by ?? '' });
    parts.push(
      h('div', { className: 'kit-editor-pair' }, field('Kind', kind), field('Last checked', checked)),
      field('Link', url),
      field('Description', description, 'What it is and who it’s for, in a sentence or two.'),
      group('Helps with', linkPicker(state, linksFor('helps_with'), { types: ['mission', 'outcome', 'capability', 'requirement', 'implementationPattern'], placeholder: 'Search missions, outcomes, capabilities, requirements, and patterns', ways: true })),
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
      h('div', { className: 'kit-editor-pair' }, field('What the public gets', theme), field('Status', status)),
      field('Description', description, 'The result, as someone outside the office would see it.'),
      group('Measures', measureRows(measures), 'Ways to tell how it’s going, such as a figure the office already reports.'),
      group('Missions that seek it', linkPicker(state, incoming.seeks, { types: ['mission'], ownOnly: true, placeholder: 'Search your missions' })),
      group('Capabilities that contribute', linkPicker(state, incoming.contributes_to, { types: ['capability'], placeholder: 'Search capabilities, yours and the library’s' }), 'Choosing one of the library’s reuses it for this mission, without changing it.'),
    );
    read = () => ({ values: { theme: theme.value }, measures, incoming: { seeks: incoming.seeks.map((l) => l.to), contributes_to: incoming.contributes_to.map((l) => l.to) } });
  }

  if (type === 'capability') {
    const stage = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.capability, existing?.values?.stage));
    parts.push(
      h('div', { className: 'kit-editor-pair' }, field('Stage of the work', stage), field('Status', status)),
      field('Description', description, 'What must be possible. It usually starts “Ability to”.'),
      group('Outcomes it contributes to', linkPicker(state, linksFor('contributes_to'), { types: ['outcome'], placeholder: 'Search outcomes', suggest: start.suggest })),
      group('Patterns that could provide it', linkPicker(state, linksFor('candidate_pattern'), { types: ['implementationPattern'], placeholder: 'Search patterns', coverage: true })),
      group('Requirements', linkPicker(state, linksFor('satisfies'), { types: ['requirement'], placeholder: 'Search requirements' })),
    );
    read = () => ({ values: { stage: stage.value } });
  }

  if (type === 'requirement') {
    const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.requirement, existing?.values?.kind));
    parts.push(
      h('div', { className: 'kit-editor-pair' }, field('Kind', kind), field('Status', status)),
      field('Description', description, 'What it asks for, with any figure from the law or policy, such as 20 working days.'),
      group('Capability it belongs to', linkPicker(state, incoming.satisfies, { types: ['capability'], ownOnly: true, one: true, inPackage: existing?.package ?? start.package, placeholder: 'Search your capabilities' })),
    );
    // A requirement goes in its capability's package, so that's what says where.
    const home = () => (existing ? undefined : state.targets.find((t) => t.id === incoming.satisfies[0]?.to)?.folder);
    read = () => ({ values: { kind: kind.value }, incoming: { satisfies: incoming.satisfies.map((l) => l.to) }, ...(home() && { package: home() }) });
  }

  if (type === 'implementationPattern') {
    const pattern: Pattern = copy(existing?.pattern ?? { layer: '', ways: [{ approach: '', title: '' }] });
    const layer = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...options(state.groups.layer, pattern.layer));
    const layerHint = () => state.groups.layer.find((l) => l.id === layer.value)?.hint ?? '';
    const layerField = field('Layer', layer, layerHint() || ' ');
    layer.addEventListener('change', () => (layerField.querySelector('small')!.textContent = layerHint()));
    const listOf = (id: string) => pattern[id as 'parts'];
    const areas = new Map(state.patternFields.map((f) => [f.id, h('textarea', { rows: '3', value: lines(listOf(f.id)) })]));
    // A need can name one of the ways, so it needs ways that are saved, and more than one to choose from.
    const saved = existing?.pattern?.ways ?? [];
    parts.push(
      h('div', { className: 'kit-editor-pair' }, layerField, field('Status', status)),
      field('Description', description, 'What it is, in a sentence or two. The library’s start “An example architecture:”.'),
      group('Ways to source it', wayRows(state, pattern.ways), 'One is enough. Add more if it could also be bought, built, or run on a platform the agency has.'),
      ...state.patternFields.map((f) => field(f.label, areas.get(f.id)!, `${f.hint} One to a line.`)),
      group('Capabilities it could provide', linkPicker(state, incoming.candidate_pattern, { types: ['capability'], placeholder: 'Search capabilities, yours and the library’s' }), 'Choosing one of the library’s offers this pattern there, without changing it.'),
      group('Needs', linkPicker(state, linksFor('depends_on'), { types: ['implementationPattern'], placeholder: 'Search patterns', not: existing?.elementId, note: true, ownWays: saved.length > 1 ? saved : undefined }), 'Patterns it can’t work without. A mission with this pattern has to have them too.'),
      group('Works with', linkPicker(state, linksFor('works_with'), { types: ['implementationPattern'], placeholder: 'Search patterns', not: existing?.elementId, note: true })),
    );
    read = () => ({
      pattern: { ...pattern, layer: layer.value, ...Object.fromEntries(state.patternFields.map((f) => [f.id, statements(areas.get(f.id)!.value)])) },
      incoming: { candidate_pattern: incoming.candidate_pattern.map((l) => l.to) },
    });
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
          ...(existing && { id: existing.id }),
          title: title.value,
          description: description.value,
          status: status.value,
          links,
          ...read(),
        });
        // Something new from the bar has nowhere to show on this page, so go to its own.
        const fromTheBar = !existing && !start.package;
        if (fromTheBar && type !== 'resource') location.assign(pageOf(state, type, String(saved.id)));
        else reloadHere();
      } catch (err) {
        failed(err);
      }
    },
  },
    h('header', {}, h('h2', {}, existing ? `Change this ${name.word}` : `Add ${name.a}`), h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': 'Close', onclick: close }, '✕')),
    problems,
    field('Title', title, type === 'requirement' ? 'An instruction, such as “Publish the approved audit plan”.' : undefined),
    ...parts.filter((p): p is HTMLElement => Boolean(p)),
    !existing && !start.package && type !== 'requirement' && state.packages.length > 1 && field('Package', inPackage),
    h('footer', {},
      existing && h('button', { type: 'button', className: 'kit-editor-danger', onclick: (e: Event) => void remove(e.currentTarget as HTMLButtonElement) }, 'Delete'),
      h('span', { className: 'kit-editor-spacer' }),
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      save),
  );

  const dialog = h('dialog', { className: 'kit-editor-dialog', onclose: () => dialog.remove() }, form);
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}

/** Where something new goes: where it's being added from, or a package that already has that type. */
function defaultPackage(state: State, type: string, start: Start) {
  return start.package ?? state.elements.find((e) => e.type === type)?.package ?? state.packages[0]?.name;
}

function openPublish(state: State) {
  const problems = h('div', { className: 'kit-editor-problems', role: 'alert', hidden: true });
  const go = h('button', { type: 'button', className: 'kit-editor-primary' }, `Publish release ${state.release}`);
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Publishing…';
    try {
      const { message } = await post('publish', {});
      dialog.querySelector('form')!.replaceChildren(
        h('header', {}, h('h2', {}, `Release ${state.release} is published`)),
        h('p', {}, String(message)),
        h('footer', {}, h('span', { className: 'kit-editor-spacer' }), h('button', { type: 'button', className: 'kit-editor-primary', onclick: () => location.reload() }, 'Done')));
    } catch (e) {
      go.disabled = false;
      go.textContent = `Publish release ${state.release}`;
      problemList(problems, e instanceof Error ? e.message : String(e));
    }
  });
  const dialog = h('dialog', { className: 'kit-editor-dialog kit-editor-dialog--small', onclose: () => dialog.remove() },
    h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, `Publish release ${state.release}?`)),
      problems,
      h('p', {}, 'Tools and people may keep what you share, so this version won’t change after this. Your next changes go in the release after it.'),
      h('p', {}, 'This also builds the site into dist/, ready to copy to where you host it.'),
      h('footer', {}, h('span', { className: 'kit-editor-spacer' }), h('button', { type: 'button', onclick: () => dialog.close() }, 'Not yet'), go)));
  document.body.append(dialog);
  dialog.showModal();
}

function drawBar(state: State) {
  const status = state.problems
    ? h('span', { className: 'kit-editor-bar__problem', title: state.problems.join('\n') }, 'source/ has a problem. See the terminal.')
    : h('span', {}, `Release ${state.release}`, h('span', { className: state.draft ? 'kit-editor-pill kit-editor-pill--draft' : 'kit-editor-pill' }, state.draft ? 'Draft' : 'Published'));
  const menu = h('details', { className: 'kit-editor-menu' },
    h('summary', {}, '+ Add'),
    h('div', {}, ...['resource', 'mission', 'outcome', 'capability', 'requirement', 'implementationPattern'].map((type) =>
      h('button', { type: 'button', onclick: () => { menu.open = false; openForm(state, type); } }, `+ Add ${names[type].a}`))));
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  const bar = h('div', { className: 'kit-editor-bar', role: 'region', 'aria-label': 'Editor' },
    h('strong', {}, 'Editing'),
    status,
    h('span', { className: 'kit-editor-spacer' }),
    menu,
    state.draft && h('button', { type: 'button', className: 'kit-editor-primary', onclick: () => openPublish(state) }, 'Publish'));
  document.body.prepend(bar);
}

/** What you can do from one of your own items, on its page or in the explorer's panel. */
function actions(state: State, item: Item) {
  const button = (label: string, onclick: () => void) => h('button', { type: 'button', className: 'kit-editor-edit', onclick }, label);
  const outcomes = item.type === 'mission' ? (item.links?.seeks ?? []).map((l) => l.to) : [item.elementId];
  const add = {
    outcome: () => openForm(state, 'outcome', undefined, { package: item.package, incoming: { seeks: [item.elementId] } }),
    capability: () => openForm(state, 'capability', undefined, item.type === 'outcome'
      ? { package: item.package, links: { contributes_to: [{ to: item.elementId }] } }
      : { package: item.package, suggest: outcomes }),
    requirement: () => openForm(state, 'requirement', undefined, { package: item.package, incoming: { satisfies: [item.elementId] } }),
    pattern: () => openForm(state, 'implementationPattern', undefined, { package: item.package, incoming: { candidate_pattern: [item.elementId] } }),
  };
  return h('div', { className: 'kit-editor-actions' },
    button(`Edit this ${names[item.type].word}`, () => openForm(state, item.type, item)),
    item.type === 'mission' && button('+ Add an outcome', add.outcome),
    (item.type === 'mission' || item.type === 'outcome') && button('+ Add a capability', add.capability),
    item.type === 'capability' && button('+ Add a requirement', add.requirement),
    item.type === 'capability' && button('+ Add a pattern', add.pattern));
}

function drawButtons(state: State) {
  const known = new Set(state.targets.map((t) => t.id));
  const own = new Map(state.elements.map((e) => [e.elementId, e]));

  for (const spot of document.querySelectorAll<HTMLElement>('[data-resources-for]')) {
    const id = spot.dataset.resourcesFor!;
    if (known.has(id)) spot.append(h('button', { type: 'button', className: 'kit-editor-add', onclick: () => openForm(state, 'resource', undefined, { links: { helps_with: [{ to: id }] } }) }, '+ Add a resource here'));
  }
  for (const card of document.querySelectorAll<HTMLElement>('[data-resource-id]')) {
    const resource = own.get(card.dataset.resourceId!);
    if (resource) card.append(h('button', { type: 'button', className: 'kit-editor-edit', onclick: () => openForm(state, 'resource', resource) }, 'Edit'));
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
  restoreSelection();
}

void start();
