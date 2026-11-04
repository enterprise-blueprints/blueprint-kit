# Blueprint Kit

A starting point for publishing your own packages on top of the
[Enterprise Blueprints](https://enterprise-blueprints.github.io/) library: your services, demos, products,
templates, and training, each linked to the library's missions, capabilities, and patterns it helps with,
and, if you like, missions and capabilities of your own.

Your packages use the library's own format and are checked by the library's own validator, so anything
that reads the library, such as Solution Studio, reads yours the same way. You get a site of your own that
works like the library's: the same mission explorer, outcome, capability, and pattern pages, and discovery
questions. It shows your own missions and items beside the library's, with what you offer shown wherever
it helps. It can stay on your computer, or go on GitHub Pages or anywhere else.

This copy comes with a sample publisher, My Organization, so you can see each piece working before you
change it.

## Try it on your computer

**You don't need a GitHub repository, a GitHub account, or Pages to try the kit.** It runs on your own
computer, and it can stay there. Publishing is a separate step for later, if you want it at all.

### 1. Install Node and pnpm

You need Node 22.12 or later, which `node --version` shows. To install it, get the LTS from
[nodejs.org](https://nodejs.org/), or on Windows:

```sh
winget install OpenJS.NodeJS.LTS
```

Then open a new terminal, so it finds Node, and install the version of pnpm the kit uses:

```sh
npm install --global pnpm@10.4.1
```

To leave your machine as it is, skip that and write `npm exec --yes pnpm@10.4.1 --` in place of `pnpm` in the
commands below, as in `npm exec --yes pnpm@10.4.1 -- install`.

If PowerShell says `running scripts is disabled on this system`, use Command Prompt instead, or run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### 2. Get the kit

[Download it as a ZIP](https://github.com/enterprise-blueprints/blueprint-kit/archive/refs/heads/main.zip),
with no sign-in, unzip it, and open a terminal in its folder. Or clone it:

```sh
git clone https://github.com/enterprise-blueprints/blueprint-kit.git
```

### 3. Run it

```sh
pnpm install
pnpm verify      # checks the sample and builds the site
pnpm dev         # shows the site at http://localhost:4321
```

If something else is using that port, `pnpm dev --port 4400` picks another. Ctrl+C stops the site.

### What you should see

- `pnpm install` ends with `Done in` and a time. A warning that says `Ignored build scripts: sharp` is fine.
- `pnpm verify` builds a few hundred pages and ends with `[build] Complete!`. A copy you downloaded also says
  its release is a draft, which is fine too: it means you haven't published anything from this copy yet.
- http://localhost:4321 shows a site called **My Blueprints**, with **What we offer** listing five resources,
  and **Missions** listing Local Government Audit, Office of Inspector General, and Grants Management.

**My Organization is made up, on purpose.** Its services, products, and demos aren't real, and their links
go to `example.com`. If that's what you see, your setup is finished and working, and the sample is there
to be replaced. Next, [make it yours](#make-it-yours), or run `pnpm editor` to
[edit in the browser](#edit-in-the-browser).

### If `pnpm install` can't find a package

Many organizations install packages through a feed of their own, a mirror of the public npm registry. A
feed can be missing versions, which looks like this:

```text
ERR_PNPM_FETCH_404  GET https://your-feed.example/ajv/-/ajv-8.20.0.tgz: Not Found - 404
```

That usually means your feed doesn't have that version, not that the kit's lockfile is wrong, so check
before you change anything:

```sh
pnpm config get registry                                            # which feed you're using
npm view ajv@8.20.0 version --registry=<your feed>                  # prints nothing if the feed lacks it
npm view ajv@8.20.0 version --registry=https://registry.npmjs.org/  # prints 8.20.0 if it's published
```

If the feed lacks a version that's published, these are your choices, the first ones changing the least:

1. **Ask whoever runs the feed to add it.** Nothing in your copy changes.
2. **Install from the public registry, if you're allowed to,** with
   `pnpm install --registry=https://registry.npmjs.org/`. The lockfile stays as it is.
3. **For one package, run `pnpm update <package>`.** It moves to the newest version your feed has that
   `package.json` allows, and changes that package's range in `package.json`.
4. **For several, delete `pnpm-lock.yaml` and run `pnpm install`.** It chooses every version again from your
   feed, so much of the lockfile changes.

After the last two, run `pnpm verify`. That lockfile suits your feed, so it belongs to your copy; commit it
if you use Git, since the kit's workflows install exactly what it says. `--no-frozen-lockfile` and
`--fix-lockfile` don't help here, since they ask for the same missing version.

Choices 3 and 4 can't help when no other version will do, which ends in `ERR_PNPM_NO_MATCHING_VERSION`. `astro` and
`yaml` are pinned to exact versions, for one, so your feed has to have those. And a `401` or `403` is a
different problem: your feed wants you to sign in.

## What's here

| Path | What it is |
| --- | --- |
| `kit.yaml` | Your site's name, description, and color, and the library release your packages build on. |
| `source/<package>/` | What you edit: one folder of YAML per package. The sample has two. |
| `content/` | Your packages as published, built from `source/` by `pnpm content:build`. Don't edit these by hand. |
| `published.json` | Which versions you've published, once you've run `pnpm content:publish`. Keep it with your copy. |
| `library/` | The library's packages and vocabulary at the release you build on, from `pnpm sync`. |
| `schemas/` | Every version of the package schema, from `pnpm sync`. |
| `src/site.ts` | Your site as the pages see it, read from `kit.yaml`. |
| `src/pages/index.astro`, `src/kit/`, `src/pages/about.astro` | Your home page, with what you offer, the missions, and your packages, and your About page. Make them yours. |
| `src/publish.ts`, `src/pages/*.json.ts`, `src/pages/packages/` | The data files your site publishes, such as `catalog.json`. |
| Everything else in `src/` and `public/` | The library's pages and the code behind them, copied as they are. `pnpm sync --tools` refreshes them; the list is the library's `engine.json`. |
| `editor/`, `scripts/` | The editor and the commands. `pnpm sync --tools` refreshes these too; the list is `kit.json`. |

The sample's two packages:

- **`offerings`** has five resources: a service, a demo, a product, a template, and a course. Each one
  says which of the library's capabilities and patterns it helps with. The demo and the product each name
  the one *way* of sourcing a pattern they're about.
- **`local-audit`** adds a small mission of its own, a city or county audit office, with its own outcomes,
  a capability, and a requirement, and links to capabilities and patterns from the library's Inspector
  General and Common packages.

## Make it yours

1. In `kit.yaml`, set your site's title, description, and color.
2. In each `source/<package>/package.yaml`, set your `packageId` (a reverse domain name you own, such as
   `com.yourfirm.offerings`), your `idPrefix` (a short word of your own, such as `yourfirm`; `eb` is the
   library's), your `publisher`, and your `license`.
3. Replace the sample resources with your own, delete `source/local-audit/` if you don't need a mission of
   your own, and delete `content/`, since it holds the sample's packages.
4. Run `pnpm content:build`, then `pnpm verify`.

## Your first resource

You can [add it in the browser](#edit-in-the-browser), or write it by hand in
`source/offerings/resources.yaml`:

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

Then run `pnpm content:build` and `pnpm dev`, and it's on the home page, and on the page of everything it
helps with.

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

## Edit in the browser

Instead of editing the YAML by hand, you can work on the site itself:

```sh
pnpm editor      # starts the editor at http://127.0.0.1:4322
```

It's your site with an editing bar across the top, for everything in your packages: resources, missions,
outcomes, capabilities, requirements, patterns, sources, discovery questions, and new packages. The library's
own items can't be changed here; you add yours beside them, and reuse them without changing them.

Saving writes to your files under `source/<package>/`, keeping your comments and any fields the forms don't
show, with the same checks as `pnpm content:build`. So you can still edit the YAML by hand, or use Git,
whenever you like.

[EDITING.md](EDITING.md) is the guide: the ways of running your site, building a mission step by step, how
saving and publishing work, and what to do when something goes wrong.

**Publish** on the bar does what `pnpm content:publish` does, and builds the site into `dist/`.

The editor is for you alone. It listens only on your own computer, and only with `pnpm editor`, so neither
`pnpm dev` nor your built site has any of it.

## The library's missions on your site

With `show: all` under `library` in `kit.yaml`, your site shows the library's whole release, each item with
a page under `library/`, such as `/library/missions/independent-government-oversight/`. Your resources show
up there, in the mission explorer and on each page they help with, and each page links to the library's own.

The lists of missions, capabilities, and so on, with Discovery and Sources, open on everything. A switch at
the top narrows them to your own items and the library packages yours build on, and the ones those build
on, and the site remembers each reader's choice. Your home page always shows that narrower set, which
`inUse` from `src/lib/library.ts` picks out. The sample builds on the Inspector General, Grants, and Common
packages, so those two missions stay when the switch is off.

Leave `show` out to publish only the packages yours build on, with no switch. To add one of the library's
missions to that set, add its package to your `dependencies` and link something to it.

## Missions and capabilities of your own

You can [add these in the browser](#edit-in-the-browser), or by hand. A package can hold any of the library's types: `missions.yaml`, `outcomes.yaml`, `capabilities.yaml`,
`requirements.yaml`, `patterns.yaml`, and `resources.yaml`, plus `links.yaml` for links that start from the
library's items, such as a library capability that contributes to your outcome. `source/local-audit/` shows
each one. The validator holds your mission to the library's rules: for example, if a pattern your
capabilities point to needs another pattern, one of the mission's capabilities has to point to that one too.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm content:build` | Builds `content/` from `source/`, at your next release when anything changed. |
| `pnpm content:check` | Fails if `content/` is behind `source/`, without writing anything. |
| `pnpm content:publish` | Builds, then freezes the release in `published.json`, for a site you host yourself. |
| `pnpm dev` | Shows your site at http://localhost:4321. |
| `pnpm editor` | Shows your site with the editor on, for editing everything in your packages in the browser. |
| `pnpm verify` | Checks the content, types, and tests, and builds the site. |
| `pnpm sync` | Downloads the library release `kit.yaml` names, checking each package against the library's catalog. |
| `pnpm sync --latest` | Moves `kit.yaml` to the library's current release first. |
| `pnpm sync --tools` | Also brings the files you share with the kit up to date: the library's pages and the code behind them, and the kit's scripts, data pages, workflows, and tests. |

## Publish

Your site is a folder of static files, so it can live anywhere that serves files: GitHub Pages, your
organization's own server, or a static host. It publishes, beside the pages:

- `catalog.json`, the same shape as the library's, naming the library catalog and release your packages
  build on;
- `packages/<name>/<version>/blueprint.json`, each package exactly as built, with its SHA-256 digest;
- `vocabulary.json` and `schemas/`, the library's, so tools can read your packages on their own.

**A published version never changes.** Tools such as Solution Studio keep what they read, and refuse a
different file under a version they already have. Until a release is published it's a draft, which
`pnpm content:build` rebuilds in place. After that, any change goes in the next release. Pushing to
`origin/main` publishes a release, and so does `pnpm content:publish`.

### On GitHub Pages

On the kit's GitHub page, choose **Use this template** to make a repository of your own, and clone it. A
copy you've already started can go there too: make an empty repository and push to it.

Turn Pages on, using GitHub Actions as the source, and each push to `main` runs the workflow in
`.github/workflows/`, which checks everything, builds the site, and deploys it.

### Anywhere else

With no GitHub involved:

1. In `kit.yaml`, set `site.url` to where the site will live, with any folder it's under, such as
   `https://intranet.example.org/architecture`.
2. Run `pnpm content:publish` when the release is ready to share.
3. Run `pnpm verify`, which checks everything and builds the site into `dist/`.
4. Copy what's in `dist/` to where you host it. `pnpm preview` shows it on your own machine first.

`pnpm content:publish` records a digest of each package in `published.json`. That file is how your copy
knows what's published, so keep it with your copy, and commit it if you use Git. If a published file in
`content/` changes, the `content` commands stop and name it. A copy with no `origin` remote starts
`published.json` on its first build, and counts any versions already in `content/` as published, so delete
the sample's `content/` first if you haven't.

A site that isn't on the web works too: Studio reads a catalog from a folder holding a built copy of your
site, and can open a package file from disk.

## Staying current

**Working and current are two different things.** Your copy builds on one library release, the one
`library.release` in `kit.yaml` names, and that's on purpose: nothing you've checked changes under you when
the library publishes a new one. A copy that passes `pnpm verify` on an older release, such as 0.12.0 with
0.14.0 out, is working as it should, and there's nothing to fix. The library's current release is in
[its catalog](https://enterprise-blueprints.github.io/catalog.json).

Updating is a separate choice, for when you want what's new, such as a new mission. Your copy doesn't follow
the kit on its own; you bring updates in when you choose. Two things move:

- **The library's release,** the missions, capabilities, and patterns your packages build on, which
  `library.release` in `kit.yaml` names.
- **The pages and code you share with the kit.** The library's engine (its pages and the code behind
  them) has a version of its own, which `library.engine` in `kit.yaml` names, and the kit's own shared
  files are listed in `kit.json`. A new engine version can change how your site looks, so it's yours to
  take or leave. A new major version may need a change to your home page, which uses the engine's code.

A copy made before engine 1.1.0 turns on the whole library by adding `show: all` to `kit.yaml`, and keeps
its home page to its own work by filtering its missions with `inUse`, as the kit's home page does.

Your own files are never touched: `kit.yaml` (but for those two versions), `source/`, `content/`,
`published.json`, your home and About pages (`src/pages/index.astro`, `src/kit/`, and `src/pages/about.astro`),
and anything you add. `package.json` takes the kit's
scripts and versions and keeps what you added.

**On GitHub, a pull request every week.** `.github/workflows/update.yml` runs every Monday, or whenever you start it
from the Actions tab. It moves to the library's current release and the kit's latest shared files,
rebuilds your packages, runs `pnpm verify`, and opens a pull request that says whether it passed, for you
to review and merge. To let it open the pull request, turn on **Settings → Actions → General → Allow
GitHub Actions to create and approve pull requests**. It can't change your workflows itself; when the
kit's have changed, the pull request says so, and `pnpm sync --tools` on your machine brings them in.

**Or by hand, which is how a copy that isn't on GitHub stays current:**

```sh
pnpm sync --latest --tools  # the library's current release, and the kit's latest shared files
pnpm install                # when package.json changed
pnpm content:build          # your next release, built on it
pnpm verify
```

This reads the library's site and the kit's files on GitHub, so your network has to reach both. If the
library renamed or removed something you link to, `pnpm verify` names each link that no longer resolves.
On a site you host yourself, run `pnpm content:publish` when the new release is ready to share.

## License

The kit's code is MIT licensed, like the library's. The sample packages use CC-BY-4.0; choose the license
for your own packages in their `package.yaml`.
