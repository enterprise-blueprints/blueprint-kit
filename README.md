# Blueprint Kit

A starting point for publishing your own packages on top of the
[Enterprise Blueprints](https://enterprise-blueprints.github.io/) library: your services, demos, products,
templates, and training, each linked to the library's missions, capabilities, and patterns it helps with,
and, if you like, missions and capabilities of your own.

Your packages use the library's own format and are checked by the library's own validator, so anything
that reads the library, such as Solution Studio, reads yours the same way. You publish them from your own
repository, with a small site that shows what you offer and links to the library for everything else.

This copy comes with a sample publisher, Example Partner, so you can see each piece working before you
change it.

## What's here

| Path | What it is |
| --- | --- |
| `kit.yaml` | Your site's name, description, and color, and the library release your packages build on. |
| `source/<package>/` | What you edit: one folder of YAML per package. The sample has two. |
| `content/` | Your packages as published, built from `source/` by `pnpm content:build`. Don't edit these by hand. |
| `library/` | The library's packages and vocabulary at the release you build on, from `pnpm sync`. |
| `schemas/` | Every version of the package schema, from `pnpm sync`. |
| `src/lib/` | The library's compiler and validator, copied as they are. `pnpm sync --tools` refreshes them. |
| `src/` | The site: a home page, a page for each of your items, and the published data files. |

The sample's two packages:

- **`offerings`** has five resources: a service, a demo, a product, a template, and a course. Each one
  says which of the library's capabilities and patterns it helps with. The demo and the product each name
  the one *way* of sourcing a pattern they're about.
- **`local-audit`** adds a small mission of its own, a city or county audit office, with its own outcomes,
  a capability, and a requirement, and links to capabilities and patterns from the library's Inspector
  General and Common packages.

## Start

You need Node 22.12 or later and pnpm.

```sh
pnpm install
pnpm verify      # checks the sample and builds the site
pnpm dev         # shows the site at http://localhost:4321
```

Then make it yours:

1. In `kit.yaml`, set your site's title, description, and color.
2. In each `source/<package>/package.yaml`, set your `packageId` (a reverse domain name you own, such as
   `com.yourfirm.offerings`), your `idPrefix` (a short word of your own, such as `yourfirm`; `eb` is the
   library's), your `publisher`, and your `license`.
3. Replace the sample resources with your own, delete `source/local-audit/` if you don't need a mission of
   your own, and delete `content/`, since it holds the sample's packages.
4. Run `pnpm content:build`, then `pnpm verify`.

## Your first resource

Add it to `source/offerings/resources.yaml`:

```yaml
- id: records-assessment
  title: Records management assessment
  kind: service
  url: https://yourfirm.example/services/records-assessment
  lastReviewedAt: 2026-11-01
  description: Two weeks reviewing how an office keeps its records, ending in a plan.
  attributes:
    typicalLength: 2 weeks
  helps_with:
    - capability:records-management
    - to: implementationPattern:records-in-business-systems
      way: built-in
```

Then run `pnpm content:build` and `pnpm dev`, and it's on the home page with links to the library's pages
for what it helps with.

- **`kind`** is one of `video`, `course`, `guide`, `site`, `community`, `dataset`, `tool`, `template`,
  `demo`, `service`, `product`, or `case-study`. The list is the library's, so every tool groups resources
  the same way.
- **`helps_with`** names what it helps with: missions, outcomes, capabilities, requirements, or patterns.
  Find their keys on the library's pages, where each item shows its ID, such as
  `eb:capability:records-management`. Write it without the `eb:` and your package finds it in the
  library's packages it builds on.
- **`way`** names one way of sourcing a pattern, from the IDs on the pattern's page. A product goes on the
  library's "configure a product" way, not as a way of its own, so the library's patterns stay examples
  and yours sit beside them.
- **`attributes`** holds anything else you want to say, such as a contract vehicle, an edition, or a
  format. It shows on the resource's page, and tools carry it along.
- **`by`** says who made it, when that isn't you.

To link to something in a library package your package doesn't build on yet, add that package's folder
name to `dependencies` in `package.yaml`. The folders are under `library/packages/`.

## Missions and capabilities of your own

A package can hold any of the library's types: `missions.yaml`, `outcomes.yaml`, `capabilities.yaml`,
`requirements.yaml`, `patterns.yaml`, and `resources.yaml`, plus `links.yaml` for links that start from the
library's items, such as a library capability that contributes to your outcome. `source/local-audit/` shows
each one. The validator holds your mission to the library's rules: for example, if a pattern your
capabilities point to needs another pattern, one of the mission's capabilities has to point to that one too.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm content:build` | Builds `content/` from `source/`, at your next release when anything changed. |
| `pnpm content:check` | Fails if `content/` is behind `source/`, without writing anything. |
| `pnpm verify` | Checks the content, types, and tests, and builds the site. |
| `pnpm sync` | Downloads the library release `kit.yaml` names, checking each package against the library's catalog. |
| `pnpm sync --tools [ref]` | Also refreshes `src/lib/` from the library's repository, at a Git ref (`main` by default) or a local folder. |

## Publish

Push to a GitHub repository with Pages turned on, using GitHub Actions as the source, and the workflow in
`.github/workflows/` checks everything, builds the site, and deploys it. It publishes, beside the pages:

- `catalog.json`, the same shape as the library's, naming the library catalog and release your packages
  build on;
- `packages/<name>/<version>/blueprint.json`, each package exactly as built, with its SHA-256 digest;
- `vocabulary.json` and `schemas/`, the library's, so tools can read your packages on their own.

**A published version never changes.** A release counts as published once it's on `origin/main`; after
that, `pnpm content:build` puts any change in the next release. Before then, it rebuilds the same one.

**To keep your packages private,** host the built site anywhere your team can reach instead, or hand the
`content/` files around. Studio can open a package file from disk.

## Staying current

When the library publishes a new release, set `library.release` in `kit.yaml`, then:

```sh
pnpm sync --tools   # the new release, and the compiler and validator that go with it
pnpm content:build  # your next release, built on it
pnpm verify
```

If the library renamed or removed something you link to, `pnpm verify` names each link that no longer
resolves.

## License

The kit's code is MIT licensed, like the library's. The sample packages use CC-BY-4.0; choose the license
for your own packages in their `package.yaml`.
