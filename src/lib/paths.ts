// Every internal link goes through href(), so the site works at the root and
// under a GitHub Pages project path such as /my-repo/.
const base = import.meta.env.BASE_URL.replace(/\/+$/, '');

export function href(path: string): string {
  return `${base}/${path.replace(/^\/+/, '')}`;
}
