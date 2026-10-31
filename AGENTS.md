# Working on the Blueprint Kit

Notes for coding agents. The kit is a template a firm copies to publish its own packages on the
Enterprise Blueprints library. The README is written for those firms; this is for working on the kit
itself. The ecosystem and its working agreements are in the library's `AGENTS.md`, usually at
`../enterprise-blueprints.github.io/AGENTS.md`.

```sh
pnpm install
pnpm sync            # the library release kit.yaml names, checked against the library's catalog
pnpm content:build   # source/ → content/, validated against your packages and the library's
pnpm verify          # content check, type check, tests, and site build
```

- `src/lib/{compile,package,vocabulary,format,paths}.ts` are verbatim copies of the library's. Change
  them in the library, then `pnpm sync --tools ../enterprise-blueprints.github.io` (or a Git ref).
- `schemas/` and `library/` come from `pnpm sync`. Keep their files byte for byte, with LF endings.
- The sample publisher, Example Partner, is fictional: `example.com` addresses and the `example` prefix.
  Keep it that way; it must never look like a real firm.
- `src/kit.ts` loads and validates everything for the site; the pages are in `src/pages/`.

To publish it as the template repo, from the user's own session (creating a public repo needs their
go-ahead):

```sh
gh repo create enterprise-blueprints/blueprint-kit --public --description "A template for publishing your own packages, such as services, demos, and products, on the Enterprise Blueprints library."
gh api -X PATCH repos/enterprise-blueprints/blueprint-kit -F is_template=true
gh api -X POST repos/enterprise-blueprints/blueprint-kit/pages -f build_type=workflow
git remote add origin https://github.com/enterprise-blueprints/blueprint-kit.git
git push -u origin main
```
