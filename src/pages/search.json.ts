import type { APIRoute } from 'astro';
import { searchIndex } from '../lib/library';

// What the site's search looks through, which it loads when it's first opened.
export const GET: APIRoute = () => new Response(JSON.stringify(searchIndex()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
