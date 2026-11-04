// The editor on the pages, with `pnpm editor`: a bar across the top, a button
// wherever a resource can go, and a form. The pages mark those places with
// data-resources-for, data-resource-id, and data-element, and otherwise don't
// know about the editor. After a save the page reloads, showing the real result.

import './client.css';

interface Link { to: string; way?: string; note?: string }
interface Resource {
  package: string; id: string; elementId: string; title: string; kind: string; url: string; by?: string;
  lastReviewedAt: string; description: string; attributes?: Record<string, string>; links: Link[];
}
interface Target { id: string; title: string; typeLabel: string; packageTitle: string; ways: { id: string; title: string }[] }
interface State {
  release?: string; draft?: boolean; problems?: string[]; today: string;
  packages: { name: string; title: string }[];
  kinds: { id: string; label: string }[];
  resources: Resource[];
  targets: Target[];
}

type Props = Record<string, string | boolean | ((e: Event) => void)>;

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

function problemList(box: HTMLElement, message: string) {
  box.replaceChildren(...message.split('\n').map((line) => h('p', {}, line)));
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

/** The list of what a resource helps with, and the search that adds to it. */
function linkPicker(state: State, links: Link[]) {
  const byId = new Map(state.targets.map((t) => [t.id, t]));
  const chosen = h('ul', { className: 'kit-editor-links' });
  const results = h('ul', { className: 'kit-editor-results', hidden: true });
  const search = h('input', { type: 'search', placeholder: 'Search missions, outcomes, capabilities, requirements, and patterns', autocomplete: 'off', 'aria-label': 'Search for something it helps with' });

  const drawChosen = () => {
    chosen.replaceChildren(
      ...links.map((link, i) => {
        const target = byId.get(link.to);
        const way = target?.ways.length
          ? h('select', { 'aria-label': 'Which way of sourcing it', onchange: (e: Event) => (link.way = (e.target as HTMLSelectElement).value || undefined) },
              h('option', { value: '' }, 'Any way of sourcing it'),
              ...target.ways.map((w) => h('option', { value: w.id, selected: w.id === link.way }, w.title)))
          : undefined;
        return h('li', {},
          h('span', { className: 'kit-editor-links__name' }, h('strong', {}, target?.title ?? link.to), h('small', {}, target ? ` ${target.typeLabel} · ${target.packageTitle}` : '')),
          way,
          h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': `Remove ${target?.title ?? link.to}`, onclick: () => { links.splice(i, 1); drawChosen(); } }, '✕'));
      }),
    );
  };

  const add = (target: Target) => {
    if (!links.some((l) => l.to === target.id)) links.push({ to: target.id });
    search.value = '';
    results.hidden = true;
    drawChosen();
    search.focus();
  };

  const matches = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return state.targets
      .filter((t) => !links.some((l) => l.to === t.id))
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

  drawChosen();
  return h('div', {}, chosen, search, results);
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

const field = (label: string, control: HTMLElement, hint?: string) => h('label', { className: 'kit-editor-field' }, h('span', {}, label), control, hint && h('small', {}, hint));

/** The form for adding a resource, helping with `first` if it's given, or changing one you have. */
function openForm(state: State, existing?: Resource, first?: string) {
  const links: Link[] = existing ? existing.links.map((l) => ({ ...l })) : first ? [{ to: first }] : [];
  const attributes = Object.entries(existing?.attributes ?? {});
  const withResources = state.resources[0]?.package ?? state.packages[0]?.name;

  const title = h('input', { value: existing?.title ?? '', required: true });
  const kind = h('select', { required: true }, h('option', { value: '' }, 'Choose one'), ...state.kinds.map((k) => h('option', { value: k.id, selected: k.id === existing?.kind }, k.label)));
  const url = h('input', { type: 'url', value: existing?.url ?? '', required: true, placeholder: 'https://' });
  const by = h('input', { value: existing?.by ?? '' });
  const checked = h('input', { type: 'date', value: existing?.lastReviewedAt ?? state.today, required: true });
  const description = h('textarea', { rows: '4', required: true, value: existing?.description ?? '' });
  const inPackage = h('select', {}, ...state.packages.map((p) => h('option', { value: p.name, selected: p.name === withResources }, p.title)));
  const problems = h('div', { className: 'kit-editor-problems', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', className: 'kit-editor-primary' }, existing ? 'Save' : 'Add it');
  const close = () => dialog.close();

  const failed = (e: unknown) => {
    save.disabled = false;
    problemList(problems, e instanceof Error ? e.message : String(e));
  };

  const remove = async (button: HTMLButtonElement) => {
    if (button.dataset.sure !== 'yes') {
      button.dataset.sure = 'yes';
      button.textContent = 'Yes, delete it';
      return;
    }
    button.disabled = true;
    try {
      await post('delete', { package: existing!.package, id: existing!.id });
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
      const details = Object.fromEntries(attributes.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()]));
      try {
        await post('save', {
          package: existing?.package ?? inPackage.value,
          ...(existing && { id: existing.id }),
          title: title.value, kind: kind.value, url: url.value, by: by.value, lastReviewedAt: checked.value,
          description: description.value, attributes: details, links,
        });
        reloadHere();
      } catch (err) {
        failed(err);
      }
    },
  },
    h('header', {}, h('h2', {}, existing ? 'Change this resource' : 'Add a resource'), h('button', { type: 'button', className: 'kit-editor-remove', 'aria-label': 'Close', onclick: close }, '✕')),
    problems,
    field('Title', title),
    h('div', { className: 'kit-editor-pair' }, field('Kind', kind), field('Last checked', checked)),
    field('Link', url),
    field('Description', description, 'What it is and who it’s for, in a sentence or two.'),
    h('fieldset', {}, h('legend', {}, 'Helps with'), linkPicker(state, links)),
    field('By', by, 'Who made it, if it isn’t you.'),
    h('fieldset', {}, h('legend', {}, 'Other details'), detailRows(attributes)),
    !existing && state.packages.length > 1 && field('Package', inPackage),
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
  const bar = h('div', { className: 'kit-editor-bar', role: 'region', 'aria-label': 'Editor' },
    h('strong', {}, 'Editing'),
    status,
    h('span', { className: 'kit-editor-spacer' }),
    h('button', { type: 'button', onclick: () => openForm(state) }, '+ Add a resource'),
    state.draft && h('button', { type: 'button', className: 'kit-editor-primary', onclick: () => openPublish(state) }, 'Publish'));
  document.body.prepend(bar);
}

function drawButtons(state: State) {
  const known = new Set(state.targets.map((t) => t.id));
  const own = new Map(state.resources.map((r) => [r.elementId, r]));

  for (const spot of document.querySelectorAll<HTMLElement>('[data-resources-for]')) {
    const id = spot.dataset.resourcesFor!;
    if (known.has(id)) spot.append(h('button', { type: 'button', className: 'kit-editor-add', onclick: () => openForm(state, undefined, id) }, '+ Add a resource here'));
  }
  for (const card of document.querySelectorAll<HTMLElement>('[data-resource-id]')) {
    const resource = own.get(card.dataset.resourceId!);
    if (resource) card.append(h('button', { type: 'button', className: 'kit-editor-edit', onclick: () => openForm(state, resource) }, 'Edit'));
  }
  const header = document.querySelector<HTMLElement>('[data-element]');
  const page = header && own.get(header.dataset.element!);
  if (page) header.append(h('button', { type: 'button', className: 'kit-editor-edit', onclick: () => openForm(state, page) }, 'Edit this resource'));
}

async function start() {
  const res = await fetch('/__editor/state');
  const state = (await res.json()) as State;
  drawBar(state);
  drawButtons(state);
  restoreSelection();
}

void start();
