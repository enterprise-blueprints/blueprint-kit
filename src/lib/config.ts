// What a site built on these pages says about itself, in its own src/site.ts.
// The library's site and every publisher's site (made with the Blueprint Kit)
// share the pages; this is what differs between them.

export interface SiteConfig {
  /** The name at the top of every page. */
  title: string;
  /** A sentence about what's here, for the footer and search results. */
  description: string;
  /** The site's main color, as a hex color, when it isn't the library's blue. */
  accent?: string;
  /** Pages of the site's own, after the element types, Discovery, and Sources in the navigation. A url is another site's. */
  nav: { label: string; path?: string; url?: string }[];
  /** A line under the description in the footer, such as the license. */
  footer?: string;
  /** Links to other sites at the end of the footer's navigation, such as the source code. */
  links?: { label: string; url: string }[];
  /**
   * The library a publisher's site builds on, at the release it names. Its
   * packages are under library/packages/, and the ones this site's packages
   * build on get pages here, under library/, with their own resources added.
   */
  upstream?: { title: string; url: string; release: string };
}
