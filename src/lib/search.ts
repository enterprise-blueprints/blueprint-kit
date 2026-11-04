// Finding things across a site, in the browser. search.json holds what can be
// found, which library.ts gathers, and this ranks it against what someone
// typed. It's a file like any other, so search works in every mode and on any
// host, with nothing to install, and shows what each result is.

export interface SearchItem {
  title: string;
  /** Its type, for its color, such as capability, or source. */
  type: string;
  /** What to call that type, such as Capability. */
  label: string;
  /** The package it's from, in a few words. */
  package?: string;
  url: string;
  /** What else it can be found by, the first of which shows under its title. */
  text?: string;
  /** Whether it's on another site, as a source is. */
  external?: boolean;
}

export interface Prepared {
  item: SearchItem;
  title: string;
  rest: string;
}

/** The order results of equal rank come in: the larger ideas first. */
const TYPE_ORDER = ['mission', 'outcome', 'capability', 'implementationPattern', 'requirement', 'resource', 'measure', 'discovery', 'source'];

/** The words in some text, in lowercase, without accents, so "Résumé" and "resume" are the same. */
export const wordsOf = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Text with a space around every word, so a search for " word" finds where a word starts. */
const spaced = (text: string) => ` ${wordsOf(text).join(' ')} `;

/** Readies items for searching, which is worth doing once. */
export function prepare(items: SearchItem[]): Prepared[] {
  return items.map((item) => ({ item, title: spaced(item.title), rest: spaced([item.text, item.label, item.package].filter(Boolean).join(' ')) }));
}

/** How well an item matches, or 0 if a word isn't in it. A word can be the start of a longer one, or inside it. */
function rank({ title, rest }: Prepared, words: string[]): number {
  let score = 0;
  for (const word of words) {
    if (title.includes(` ${word} `)) score += 12;
    else if (title.includes(` ${word}`)) score += 10;
    else if (title.includes(word)) score += 4;
    else if (rest.includes(` ${word}`)) score += 2;
    else if (rest.includes(word)) score += 1;
    else return 0;
  }
  const phrase = ` ${words.join(' ')} `;
  if (title === phrase) score += 100;
  else if (title.startsWith(phrase)) score += 50;
  else if (title.includes(phrase)) score += 30;
  return score;
}

const typeRank = (type: string) => {
  const at = TYPE_ORDER.indexOf(type);
  return at < 0 ? TYPE_ORDER.length : at;
};

/** The best matches for what someone typed, and how many matched in all. */
export function search(prepared: Prepared[], query: string, limit = 40): { results: SearchItem[]; total: number } {
  const words = wordsOf(query);
  if (!words.length) return { results: [], total: 0 };
  const found = prepared.flatMap((p) => {
    const score = rank(p, words);
    return score ? [{ item: p.item, score }] : [];
  });
  found.sort((a, b) => b.score - a.score || typeRank(a.item.type) - typeRank(b.item.type) || a.item.title.localeCompare(b.item.title));
  return { results: found.slice(0, limit).map((f) => f.item), total: found.length };
}
