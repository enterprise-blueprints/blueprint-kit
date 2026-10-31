import type { GetStaticPaths } from 'astro';
import { published } from '../../../../kit';
import { json } from '../../../../publish';

type Published = (typeof published)[number];

export const getStaticPaths = (() =>
  published.map((p) => ({ params: { name: p.name, version: p.data.version }, props: { p } }))) satisfies GetStaticPaths;

// The package exactly as stored, so its digest matches the catalog.
export const GET = ({ props }: { props: { p: Published } }) => json(props.p.text);
