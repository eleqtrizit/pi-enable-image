# Agent instructions for pi-enable-image

This repository is a pi coding agent extension. When the active model can't accept images, the extension sends each image to a multimodal backup model. It then replaces the image in the user's message with a text description.

If you are doing a code review, read [CODE_REVIEWS.md](CODE_REVIEWS.md) first and follow it.

## Files

| Path | Purpose |
|------|---------|
| `extensions/index.ts` | The whole extension: the `/image-backup-model` command, the `input` event handler, settings persistence, clipboard path detection, and the side query to the backup model. |
| `package.json` | Package manifest. `pi.extensions` points pi at `extensions/index.ts`. Declares pi packages as peers. |
| `tsconfig.json` | Strict TypeScript config (ESNext, NodeNext). Used only for typechecking; pi loads TS through jiti, so there is no build step. |
| `README.md` | User docs: install, configure, how it works. |
| `.gitignore` | Ignores `node_modules`, `dist`, `.pi`, env files, and logs. |
| `AGENTS.md` | This file. |
| `CODE_REVIEWS.md` | Review checklist and required patterns. |

## Entry points

- `export default function imageBackupModel(pi: ExtensionAPI)` in `extensions/index.ts`. pi calls this factory on load.
- Command `/image-backup-model`: lists image-capable models (scoped models first, else all available) and saves the choice.
- Event `pi.on("input", ...)`: runs on every user message. It does the following:
  1. Skips messages where `event.source === "extension"`.
  2. Collects attached images and image file paths found in the text.
  3. Returns `continue` if there are no images or the active model supports images.
  4. Resolves the backup model and checks it exists, supports images, and has auth.
  5. Describes each image, then returns `transform` with the description text and `images: []`.
- Persisted state: `~/<CONFIG_DIR_NAME>/image-backup-model.json` with shape `{ "backupModel": "<provider>/<model-id>" }`.

## Commands

```bash
npm install
npm run typecheck              # tsc --noEmit, must pass with zero errors
npm test                       # vitest run; exits 1 until test files exist
pi -e ./extensions/index.ts    # load the extension in pi for a manual test
```

pi docs and examples ship in `node_modules/@earendil-works/pi-coding-agent/docs/` and `.../examples/extensions/`. Read `events.md` (the `input` event), `extension-context.md`, and `extension-api.md` before you change the handler.

## Coding standards

### Language and types

- Write TypeScript under `strict`. Don't use `any`, `@ts-ignore`, or non-null `!` assertions. Narrow with type guards.
- Use `import type` for type-only imports.
- Import pi APIs from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, and schemas from `typebox`. The packages `@mariozechner/*` and `@sinclair/typebox` are obsolete. Don't use them.
- Use `node:` prefixes for built-ins (`node:fs`, `node:path`).
- Give every function explicit parameter and return types. Exception: the default export factory.
- Lines are 120 characters max. Indent with tabs, use double quotes and semicolons, and match the existing file.

### Structure

- Keep pure helpers (parsing, filtering, formatting) as top-level functions that don't touch `ctx`. This keeps them unit-testable.
- Pass `ctx` or `ExtensionContext` in as a parameter. Don't capture it in module state.
- Put magic strings and numbers in top-level `UPPER_SNAKE_CASE` constants. Examples: prompt text, settings filename, status key, `maxTokens`.
- Build paths with `node:path` `join`. Don't concatenate path strings.
- Keep the extension in a single file until it passes about 300 lines. Split by responsibility after that, into files such as `settings.ts`, `images.ts`, and `describe.ts`.
- Don't add runtime dependencies for things `node:` or pi already provide. Runtime deps go in `dependencies`, because pi installs with `--omit=dev`.

### Behavior rules for the `input` handler

- Fail open. Any error or missing configuration must return `{ action: "continue" }` with the user's message unchanged, plus a `ctx.ui.notify` that explains why. Never drop or block the message silently.
- Never transform input from `source === "extension"`.
- Exit early when the active model supports images. The extension must cost nothing for multimodal models.
- Clear every `ctx.ui.setStatus` key you set, on success and on failure. Use `finally` when you can.
- Validate the backup model before you call it: it exists, `input` includes `"image"`, and `hasConfiguredAuth` is true.
- Treat file paths from user text as untrusted. Check that the file exists and that `detectSupportedImageMimeTypeFromFile` accepts it before you read it.
- Keep settings reads tolerant. If the JSON is missing or malformed, return `undefined`. Don't throw.

### Testing

- Use Vitest. Put tests next to the code as `*.test.ts`, or in `test/`.
- Write unit tests for pure helpers: `IMAGE_PATH_PATTERN` matching, `extractImageAttachments`, `supportsImages`, `candidateModels`, and settings load and save against a temp `HOME`.
- Test the `input` handler with a fake `ctx` (stub `modelRegistry`, `ui`, and `model`). Cover each early return and the transform path.
- Don't call real model providers in tests.

### Done criteria

- `npm run typecheck` passes with zero errors.
- `npm test` passes.
- `README.md` matches any user-visible change: the command name, the settings path, or the behavior.
- Remove dead code and unused imports, and update `AGENTS.md` when you add, remove, or rename files or entry points.
