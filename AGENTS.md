# Working on the Blueprint Kit

Notes for coding agents. The kit is a template any organization copies to publish its own packages on
the Enterprise Blueprints library, mapping its solutions, services, and products to the library. The README is
written for those organizations; this is for working on the kit
itself. The ecosystem and its working agreements are in the library's `AGENTS.md`, usually at
`../enterprise-blueprints.github.io/AGENTS.md`.

```sh
pnpm install
pnpm sync            # the library release kit.yaml names, checked against the library's catalog
pnpm content:build   # source/ → content/, validated against your packages and the library's
pnpm verify          # content check, type check, tests, and site build
```

- Copies of the kit stay current with `pnpm sync --tools`, which takes the library's engine at the
  version `kit.yaml` on the kit's `main` names (tagged `engine-v<version>` in the library) and the kit's
  own shared files, which `kit.json` lists, from `main`. Keep `kit.json` to files every copy shares;
  never list a file an organization makes its own, such as the home page, `kit.yaml`, or `README.md`.
  `.github/workflows/update.yml` does it weekly in each copy and opens a pull request. In this repo,
  `pnpm sync --tools` updates the engine alone. To try a change to `scripts/sync.ts` against local
  copies, `LIBRARY_REPO_RAW` and `KIT_REPO_RAW` stand in for the two repos' raw addresses, by ref.
- The pages and the code behind them are the library's engine, the files its `engine.json` lists
  (`src/lib/`, `src/components/`, `src/layouts/`, `src/styles/`, most of `src/pages/`, and
  `public/favicon.svg`), copied as they are. Change them in the library, then
  `pnpm sync --tools ../enterprise-blueprints.github.io` (or a Git ref).
- `schemas/` and `library/` come from `pnpm sync`. Keep their files byte for byte, with LF endings.
- `scripts/content.ts` counts a version as published when it's on `origin/main` or in `published.json`, which
  `pnpm content:publish` writes. The kit's own repo has no `published.json`, since its sample is published
  by pushing; keep it that way, so a copy's first record is its own. `tests/kit.test.ts` runs the script in a
  copy with no remote.
- `editor/` is the editor, the kit's own, listed in `kit.json`. `pnpm editor` sets `KIT_EDITOR`, and only then does
  `astro.config.mjs` load `editor/server.ts`, an integration on the dev server, so builds and `pnpm dev` never
  have it. `store.ts` edits `source/*.yaml` in place with the `yaml` library's Document API, and a save runs
  `scripts/content.ts build`, whose checks decide; a refused change is undone. `client.ts` finds its places by
  the attributes the library's pages carry: `data-resources-for`, `data-resource-id`, and `data-element`. Try it
  in a scratch copy, since a save writes `source/` and `content/`. Keep `allowed()` in `server.ts`: any site
  open in the browser can reach a server on this computer.
- The README's quickstart is for someone who has only Node, or nothing yet, and no GitHub. Keep it working
  that way, and keep its pnpm version the same as `packageManager` in `package.json`. Try a change to it in a
  fresh folder with its own `PATH`. Its advice on package feeds comes from testing each fix against a feed
  missing locked versions, so test before changing that too.
- The sample publisher, My Organization, is fictional: `example.com` addresses and the `example` prefix.
  Keep it that way; it must never look like a real organization.
- The kit's own files: `src/site.ts` (the site config, read from `kit.yaml`), the home page
  `src/pages/index.astro` with `src/kit/`, and the published data in `src/publish.ts`,
  `src/pages/*.json.ts`, and `src/pages/packages/`.
- The library's whole release gets pages under `library/` with `show: all` in `kit.yaml`, as the sample has it,
  and only the packages yours build on without it, your resources added either way. The home page and
  About page stay with `inUse`, the narrower set. The
  library's `scripts/check-dist.mjs` works on a kit build too:
  `node ../enterprise-blueprints.github.io/scripts/check-dist.mjs <build folder>`.

The kit is the `enterprise-blueprints/blueprint-kit` template repo, and a push to `main` (or a run of
the workflow started by hand) deploys the sample site to https://enterprise-blueprints.github.io/blueprint-kit/.
