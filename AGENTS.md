# Agent instructions for pi-enable-image

This repository is a pi coding agent extension. It registers a `read-image` tool: the agent gives it a path to an image file, the tool sends the image to a multimodal backup model, and the description comes back as tool-result text the active (possibly text-only) model can read.

If you are doing a code review, read [CODE_REVIEWS.md](CODE_REVIEWS.md) first and follow it.

## Files

| Path | Purpose |
|------|---------|
| `extensions/index.ts` | The whole extension: the `/image-backup-model` command, the `read-image` tool, settings persistence, file validation, and the side query to the backup model. |
| `extensions/index.test.ts` | Vitest unit tests: settings persistence, model validation, text extraction, and every `readImageFile` branch. Model calls are stubbed; a temp `HOME` isolates settings. |
| `package.json` | Package manifest. `pi.extensions` points pi at `extensions/index.ts`. Declares pi packages as peers. |
| `tsconfig.json` | Strict TypeScript config (ESNext, NodeNext). Used only for typechecking; pi loads TS through jiti, so there is no build step. |
| `README.md` | User docs: install, configure, how it works. |
| `.gitignore` | Ignores `node_modules`, `dist`, `.pi`, env files, and logs. |
| `AGENTS.md` | This file. |
| `CODE_REVIEWS.md` | Review checklist and required patterns. |

## Entry points

- `export default function imageBackupModel(pi: ExtensionAPI)` in `extensions/index.ts`. pi calls this factory on load.
- Command `/image-backup-model`: lists image-capable models (scoped models first, else all available) and saves the choice.
- Tool `read-image`: takes one `path` argument. It validates the file, asks the configured backup model to describe it, and returns the description text plus the side query's `usage`. Failures throw from `execute`; pi reports the message to the model as the tool's error result.
- Persisted state: `~/<CONFIG_DIR_NAME>/image-backup-model.json` with shape `{ "backupModel": "<provider>/<model-id>" }`.

Do not add an `input` event handler or transform user messages. The earlier input-interception design was removed on purpose.

## Commands

```bash
npm install
npm run typecheck              # tsc --noEmit, must pass with zero errors
npm test                       # vitest run; exits 1 until test files exist
pi -e ./extensions/index.ts    # load the extension in pi for a manual test
```

pi docs and examples ship in `node_modules/@earendil-works/pi-coding-agent/docs/` and `.../examples/extensions/`. Read `extensions.md` (custom tools and the tool `execute` error contract) and `extension-context.md` before you change the tool.

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

### Behavior rules for the `read-image` tool

- Validate the path before reading anything: it must resolve to an existing file, and `detectSupportedImageMimeTypeFromFile` must accept it. Model-provided paths are untrusted.
- Validate the backup model before calling it: it exists, `input` includes `"image"`, and `hasConfiguredAuth` is true.
- Report every failure by throwing from `execute` with a message the model can act on (missing file, unsupported format, unset or unavailable backup model, missing auth, provider error). Never return a success-shaped result for a failure; pi 0.84.x marks a result as failed only on a thrown error.
- Include the side query's `usage` in a successful tool result so session totals stay accurate.
- Keep settings reads tolerant. If the JSON is missing or malformed, return `undefined`. Don't throw.

### Testing

- Use Vitest. Put tests next to the code as `*.test.ts`, or in `test/`.
- Write unit tests for pure helpers: settings load and save against a temp `HOME`, `supportsImages`, `textFromAssistant`, and every `resolveBackupModel` and `readImageFile` branch against a stubbed registry.
- Don't call real model providers in tests.

### Done criteria

- `npm run typecheck` passes with zero errors.
- `npm test` passes.
- `README.md` matches any user-visible change: the command name, the settings path, or the behavior.
- Remove dead code and unused imports, and update `AGENTS.md` when you add, remove, or rename files or entry points.
