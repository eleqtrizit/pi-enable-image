# Code review guide

Use this guide to review changes to pi-enable-image. Every finding must cite a file and line, and must say what breaks for the user. Rate each finding **Blocker**, **Major**, or **Minor**. A change with any Blocker doesn't merge.

## Review process

1. Read `AGENTS.md` for the file map and standards.
2. Read the full diff, then read all of `extensions/index.ts`. The extension is small, and context matters.
3. Run `npm run typecheck` and `npm test`. Report the exit codes in the review.
4. Walk the checklist below. Record only items that fail.
5. Give a verdict: **Approve** or **Request changes**, and list the items that would flip it.

## Blockers

Reject the change if any of these are true:

- **Reintroduced input interception.** The change adds an `input` handler, transforms user messages, or otherwise reverts the tool-only design removed in the pivot.
- **Silent failure.** A failure path returns a success-shaped result, or throws without a message the model can act on (missing file, unsupported format, unset or unavailable backup model, missing auth, provider error).
- **Unvalidated file reads.** The tool reads a path from a model call without the file-exists check and `detectSupportedImageMimeTypeFromFile` acceptance.
- **Unvalidated backup model.** The tool calls `modelRegistry.complete` without first confirming that the model exists, supports images, and has `hasConfiguredAuth`.
- **Secrets or credentials** are hardcoded, logged, or written to the settings file.
- **Typecheck fails**, or the change adds `any`, `@ts-ignore`, `@ts-expect-error`, or `as unknown as`.
- **Obsolete packages.** The change imports `@mariozechner/*` or `@sinclair/typebox`.
- **Packaging breaks.** A runtime import is missing from `dependencies` or `peerDependencies`, or `pi.extensions` no longer points at the entry file.

## Major

- **Activation drift.** `read-image` stays declared to an image-capable model, or stays withdrawn from a text-only model, because the `session_start`/`model_select` sync is missing, skips a source of model changes, or calls `setActiveTools` on every event without comparing first.
- **Dropped usage.** A successful `read-image` result omits `usage: response.usage`, so session token totals drift.
- **Settings robustness.** `loadBackupModelId` can throw on missing or malformed JSON, or `saveBackupModelId` changes the file shape `{ backupModel: string }` without a migration note in `README.md`.
- **Model ID parsing.** The change splits `provider/model-id` in a way that breaks model IDs that contain `/`. The handler joins the rest after the first `/`. Keep that behavior.
- **Untested logic.** A new branch, regex, or parser has no Vitest test. Model calls in tests must be stubbed.
- **Captured context.** `ctx` is stored in module-level state instead of passed as a parameter.
- **New dependency** added for something `node:` or pi already provides.
- **Docs drift.** A user-visible change (command name, settings path, behavior, description format) isn't reflected in `README.md`. A file or entry point change isn't reflected in `AGENTS.md`.

## Minor

- Magic strings or numbers inline instead of top-level `UPPER_SNAKE_CASE` constants.
- Missing explicit return types on new functions.
- Path building by string concatenation instead of `join`.
- Missing `node:` prefix on built-in imports.
- Lines over 120 characters, or formatting that doesn't match the file (tabs, double quotes, semicolons).
- Comments that restate the code. Comments must explain why.
- Dead code, unused imports, or debug `console.log` calls.

## Required patterns

### Throw from `execute`, don't return error blobs

pi 0.84.x marks a tool result as failed only when `execute` throws. The thrown message is what the model sees:

```ts
// Correct: the model sees the failure and can recover on its next turn.
if (!isFile(path)) throw new Error(`File not found: ${path}`);

// Wrong: a success-shaped result the model mistakes for a description.
if (!isFile(path)) return { content: [{ type: "text", text: "File not found" }], details: undefined };
```

### Guard order

Order the checks from cheapest to most expensive:

1. Resolve the path against `ctx.cwd`, then check the file exists and is a supported image.
2. Settings lookup, then model lookup, then capability check, then auth check.
3. The side query.

### Pure helpers stay pure

Keep helpers that validate paths, parse settings, or filter models free of `ctx.ui` calls and free of module state. That lets tests call them directly.

## Out of scope for review

- Style preferences that the "Minor" list doesn't cover.
- Requests for features or configuration options the change didn't set out to add.
