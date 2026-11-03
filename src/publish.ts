// The data files the site publishes beside its pages: your packages exactly
// as stored, with their digests, the catalog, the library's vocabulary, whose
// page addresses match this site's, and every package schema.

import { createHash } from 'node:crypto';
import { compareVersions } from './lib/format';
import { packageFiles } from './lib/library';

/** Every schema version, newest last. */
export const schemas = Object.entries(import.meta.glob<string>('/schemas/*.schema.json', { query: '?raw', import: 'default', eager: true }))
  .map(([path, text]) => ({ version: JSON.parse(text).properties.schemaVersion.const as string, text, path: path.slice(1) }))
  .sort((a, b) => compareVersions(a.version, b.version));

/** Every version of your packages, with its address and digest, newest last within each package. */
export const published = packageFiles
  .map((f) => ({ ...f, path: `packages/${f.name}/${f.data.version}/blueprint.json`, sha256: createHash('sha256').update(f.text, 'utf8').digest('hex') }))
  .sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.data.version, b.data.version));

export function json(text: string): Response {
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
