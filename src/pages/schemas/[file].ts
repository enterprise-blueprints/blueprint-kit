import type { GetStaticPaths } from 'astro';
import { json, schemas } from '../../publish';

export const getStaticPaths = (() => schemas.map((s) => ({ params: { file: s.path.split('/')[1] }, props: { text: s.text } }))) satisfies GetStaticPaths;

export const GET = ({ props }: { props: { text: string } }) => json(props.text);
