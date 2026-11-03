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

- The pages and the code behind them are the library's engine, the files its `engine.json` lists
  (`src/lib/`, `src/components/`, `src/layouts/`, `src/styles/`, most of `src/pages/`, and
  `public/favicon.svg`), copied as they are. Change them in the library, then
  `pnpm sync --tools ../enterprise-blueprints.github.io` (or a Git ref).
- `schemas/` and `library/` come from `pnpm sync`. Keep their files byte for byte, with LF endings.
- The sample publisher, My Organization, is fictional: `example.com` addresses and the `example` prefix.
  Keep it that way; it must never look like a real organization.
- The kit's own files: `src/site.ts` (the site config, read from `kit.yaml`), the home page
  `src/pages/index.astro` with `src/kit/`, and the published data in `src/publish.ts`,
  `src/pages/*.json.ts`, and `src/pages/packages/`.
- The library's packages yours build on get pages under `library/`, with your resources added. The
  library's `scripts/check-dist.mjs` works on a kit build too:
  `node ../enterprise-blueprints.github.io/scripts/check-dist.mjs <build folder>`.

The kit is the `enterprise-blueprints/blueprint-kit` template repo, and a push to `main` (or a run of
the workflow started by hand) deploys the sample site to https://enterprise-blueprints.github.io/blueprint-kit/.
