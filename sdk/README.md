# OpenFini extension SDK

Everything you need to write extensions for OpenFini. No dependencies, no build step: an extension is a folder with a
manifest and plain JavaScript. Full documentation: [`docs/extensions.md`](../docs/extensions.md).

| File | Purpose |
| --- | --- |
| `openfini.d.ts` | TypeScript typings of the whole API and the manifest (`// @ts-check` works in plain JS) |
| `schema/openfini-extension.schema.json` | JSON Schema of `openfini-extension.json` (editors give completion and errors) |
| `create-extension.mjs` | scaffolding CLI: `node sdk/create-extension.mjs acme.my-ext [--template command\|panel\|theme]` |
| `pack.mjs` | zips a folder to `.ofext`: `node sdk/pack.mjs path/to/folder [out.ofext]` |
| `examples/` | four working extensions (grid generator, instant duotone, section snippets, theme pack) |

From the repository root the same scripts are `npm run ext:create -- acme.my-ext` and `npm run ext:pack -- folder`.

## Quick start

```bash
node sdk/create-extension.mjs acme.hello          # creates ./hello with a manifest and main.js
```

In OpenFini: *Studio ▸ Extensions… ▸ Developer mode ▸ Load unpacked…*, pick the folder, then run
*Studio ▸ Extension Commands ▸ Acme Hello: Say Hello*. Edit `main.js`; OpenFini hot-reloads it where the browser allows
folder watching.

```js
// main.js: runs in a sandbox, `openfini` is the whole API
async function activate(openfini) {
  await openfini.commands.register("hello", async () => {
    await openfini.ui.showMessage("Hello!", "success");   // needs the "ui" permission
  });
}
```

## Rules of the sandbox

- Your code runs in an isolated frame: no DOM access to OpenFini, no `fetch`, no cookies, no `eval`. Everything goes
  through `openfini.*` and is checked against the permissions in your manifest and the user's approval.
- Document changes use OpenFini's tool layer (`openfini.document.callTool("add_shape", …)`), so they are validated and one
  command is one undo step. `openfini.document.listTools()` lists what is available.
- Ask only for the permissions you use. Users see them before installing.

License: MIT, like OpenFini.
