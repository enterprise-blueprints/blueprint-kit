import { release, upstream } from '../lib/library';
import { json, published, schemas } from '../publish';

// The same shape as the library's catalog, so tools read both the same way,
// with the library catalog and release your packages build on.
export const GET = () =>
  json(
    `${JSON.stringify(
      {
        schemaVersion: schemas.at(-1)!.version,
        generatedAt: published.map((p) => p.data.publishedAt).sort().at(-1),
        release,
        buildsOn: { catalog: new URL('catalog.json', upstream!.base).href, release: upstream!.release },
        schema: schemas.at(-1)!.path,
        schemas: schemas.map((s) => s.path),
        vocabulary: 'vocabulary.json',
        packages: published.map((p) => ({
          packageId: p.data.packageId,
          version: p.data.version,
          title: p.data.title,
          license: p.data.license,
          publishedAt: p.data.publishedAt,
          latest: p.latest,
          href: p.path,
          sha256: p.sha256,
        })),
      },
      null,
      2,
    )}\n`,
  );
