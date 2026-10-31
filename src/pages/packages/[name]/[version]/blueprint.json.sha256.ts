import type { GetStaticPaths } from 'astro';
import { published } from '../../../../kit';

type Published = (typeof published)[number];

export const getStaticPaths = (() =>
  published.map((p) => ({ params: { name: p.name, version: p.data.version }, props: { p } }))) satisfies GetStaticPaths;

// In sha256sum format, so `sha256sum -c blueprint.json.sha256` checks a download.
export const GET = ({ props }: { props: { p: Published } }) =>
  new Response(`${props.p.sha256}  blueprint.json\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
