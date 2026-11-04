# Editing content

For technical authors working on the Enterprise Blueprints library, or on a site made with the Blueprint
Kit. Both sites use the same editor, so this guide covers both and says where they differ.

## Three ways to run a site

| Mode | Start it with | Where | What it's for |
| --- | --- | --- | --- |
| Preview | `pnpm dev` | http://localhost:4321 | Reading the site while you edit YAML by hand. It can't change anything. |
| Editor | `pnpm editor` | http://127.0.0.1:4322 on a kit site, 4323 on the library | Adding and changing content on the pages. It writes to `source/` and `content/`. |
| Published | `pnpm build`, then host `dist/` | Wherever you host it | What readers see. It has no editing at all. |

The editor runs on your own computer and is for one person at a time. Other computers can't reach it. Use
`pnpm editor --port 5000` if the port is taken, and Ctrl+C to stop it.

Restart `pnpm editor` after you pull new code or run `pnpm sync --tools`. Reloading the page isn't enough.

## Find your way around

The bar across the top shows the release and whether it's **Published** or a **Draft**, and **+ Add** adds
anything. Dashed buttons appear on the pages of items you can change:

| On this page | You can |
| --- | --- |
| Any item | Choose **Edit**, also in the mission explorer's panel, or **Add a resource here** |
| A mission | Add an outcome or a capability |
| An outcome | Add a capability |
| A capability | Add a requirement or a pattern |
| A question set | Edit the set, add a question, or edit a question |
| Sources | Edit a source |

On a kit site, the library's own items have no **Edit**. You add yours beside them.

## Build a mission

Work from the top down, since each step links to the one before it.

1. **Choose a package.** Choose **+ Add > Add a package** if the mission needs a new one, then **Add a mission**.
2. **Add outcomes** from the mission's page, with their measures.
3. **Add capabilities** from the mission's page. To reuse one from another package, open an outcome and
   choose it under **Capabilities that contribute**. That leaves the other package unchanged.
4. **Add requirements and patterns** from each capability's page. Each requirement belongs to one capability
   in its package. A pattern needs a layer and at least one way to source it.
5. **Add sources.** Choose **Add a new source** under **Sources** on any form, without leaving it. An item can
   cite only its own package's sources.
6. **Add discovery questions.** Choose **+ Add > Add a question set**, which starts with its first question.
   Ask how the office works today, never about a particular case or person.
7. **Add resources** with **Add a resource here**, on whatever they help with.

## What happens when you save

- **The checks decide.** Each save runs the same checks as `pnpm content:build`. If they refuse a change, the
  form says why, and often what to add, and your files stay as they were.
- **It's still YAML.** The editor writes to the files under `source/<package>/`, and keeps your comments and
  any fields the forms don't show. You can edit by hand or use Git whenever you like.
- **IDs don't change.** An item's ID comes from its first title and stays, since tools link to it.
- **Deleting takes links along.** The form stops first if that would leave a resource with nothing to help
  with, or a requirement with no capability, and names it.
- **Dependencies look after themselves.** A link to a new package adds it to `package.yaml`. Keep missions
  building on shared packages, not on each other.

## Publish

Your changes are a draft of the next release until you publish them. After that, a version never changes,
and your next change starts the release after it.

**On a kit site,** choose **Publish** on the bar, which also builds the site into `dist/`. Copy that folder
to where you host it. If you host with GitHub Pages, push to `main` instead.

**On the library,** there's no **Publish** button. Run `pnpm verify`, commit, and push to `main`, which
deploys the site. Tests pin real content, such as counts, so a new item can mean updating a test, and a
half-built mission fails until it's complete. `AUTHORING.md` lists what a finished mission needs.

To undo a draft, change it back or delete it in the editor. A draft that matches the published release stops
being a draft. With Git, `git restore source content` also works, along with deleting any new files
`git status` lists.

## Still done in the YAML

- The sources of a single measure or link.
- The order of items and questions. New ones go at the end.
- A package's details once it's started, such as its description, jurisdictions, and tags.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| A button or form does nothing | Restart `pnpm editor`, then reload the page. |
| The bar says `source/ has a problem` | A hand edit broke something. The terminal names the file. |
| The port is already in use | Use `pnpm editor --port 5000`, or stop what's using it. |
| On the library, `content:build needs origin/main` | Run `git fetch`. |
| A kit site with no packages | `pnpm editor` asks a few questions in the terminal and starts your first. |
