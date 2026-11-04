import { describe, expect, it } from 'vitest';
import { prepare, search, wordsOf, type SearchItem } from '../src/lib/search';

// Every copy of the kit runs these too, so they work on items of their own.
const item = (title: string, type = 'capability', text = '', pkg = 'Common'): SearchItem => ({ title, type, label: type === 'capability' ? 'Capability' : type, package: pkg, text, url: `/${title}/` });

const items = prepare([
  item('Records Management', 'capability', 'Ability to keep records on a schedule.'),
  item('Records Schedules in Each Business System', 'implementationPattern'),
  item('Publish Records Online', 'requirement'),
  item('Case Management', 'capability', 'Ability to track work.', 'FOIA'),
  item('Hotline Intake', 'capability', 'Takes in complaints and records them.'),
  item('Agency Sign-On', 'implementationPattern'),
  item('Résumé Screening', 'capability'),
]);
const titles = (query: string) => search(items, query).results.map((r) => r.title);

describe('site search', () => {
  it('splits text into plain words', () => {
    expect(wordsOf('Sign-On, for “Résumé” (FOIA)')).toEqual(['sign', 'on', 'for', 'resume', 'foia']);
  });

  it('puts an exact title first, then titles, then what’s only in the text', () => {
    expect(titles('records management')[0]).toBe('Records Management');
    expect(titles('records')).toEqual(['Records Management', 'Records Schedules in Each Business System', 'Publish Records Online', 'Hotline Intake']);
  });

  it('finds the start of a word, and inside one', () => {
    expect(titles('manag')).toEqual(['Case Management', 'Records Management']);
    expect(titles('otlin')).toEqual(['Hotline Intake']);
  });

  it('needs every word, in any order, in the title or the rest', () => {
    expect(titles('management records')).toEqual(['Records Management']);
    expect(titles('case records')).toEqual([]);
    expect(titles('hotline complaints')).toEqual(['Hotline Intake']);
  });

  it('finds things by their type and package', () => {
    expect(titles('foia capability')).toEqual(['Case Management']);
    expect(titles('implementationPattern agency')).toEqual(['Agency Sign-On']);
  });

  it('ignores accents and case', () => {
    expect(titles('RESUME')).toEqual(['Résumé Screening']);
    expect(titles('résumé')).toEqual(['Résumé Screening']);
  });

  it('finds nothing for nothing', () => {
    expect(search(items, '  ')).toEqual({ results: [], total: 0 });
    expect(search(items, '“”')).toEqual({ results: [], total: 0 });
    expect(search(items, 'zebra')).toEqual({ results: [], total: 0 });
  });

  it('shows the best few, and says how many there were', () => {
    const many = prepare(Array.from({ length: 50 }, (_, i) => item(`Report ${String(i).padStart(2, '0')}`)));
    const found = search(many, 'report', 40);
    expect(found.results).toHaveLength(40);
    expect(found.total).toBe(50);
    expect(found.results[0].title).toBe('Report 00');
  });
});
