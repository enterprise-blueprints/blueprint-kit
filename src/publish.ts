// The data files the site publishes beside its pages: your packages exactly
// as stored, with their digests, the catalog, the library's vocabulary, whose
// page addresses match this site's, and every package schema.

/** Every schema version, newest last. */
export const schemas = Object.entries(import.meta.glob<string>('/schemas/*.schema.json', { query: '?raw', import: 'default', eager: true }))
  .map(([path, text]) => ({ version: JSON.parse(text).properties.schemaVersion.const as string, text, path: path.slice(1) }))
  .sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true }));

export function json(text: string): Response {
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
