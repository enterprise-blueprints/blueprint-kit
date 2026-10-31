import vocabulary from '../../library/vocabulary.json?raw';
import { json } from '../publish';

// The library's own, since your packages use its types, and this site's pages have the same addresses.
export const GET = () => json(vocabulary);
