# Code review guide

Use this guide to review changes to pi-enable-image. Every finding must cite a file and line, and must say what breaks for the user. Rate each finding **Blocker**, **Major**, or **Minor**. A change with any Blocker doesn't merge.

## Review process

1. Read `AGENTS.md` for the file map and standards.
2. Read the full diff, then read all of `extensions/index.ts`. The handler is small, and context matters.
3. Run `npm run typecheck` and `npm test`. Report the exit codes in the review.
4. Walk the checklist below. Record only items that fail.
5. Give a verdict: **Approve** or **Request changes**, and list the items that would flip it.

## Blockers

Reject the change if any of these are true:

- **Message loss.** A path in the `input` handler can return `transform` with empty or partial text, drop the user's text, or return `handled` or block without the user asking for it. Every failure path must return `{ action: "continue" }`.
- **Silent failure.** A failure path returns `continue` without a `ctx.ui.notify` that says why.
- **Extension input transformed.** The `event.source === "extension"` guard is removed, moved below other work, or bypassed.
- **Unvalidated file reads.** The change reads a path from user text without the `existsSync` and `detectSupportedImageMimeTypeFromFile` checks, or widens `IMAGE_PATH_PATTERN` to match relative paths or non-image extensions without a matching validation.
- **Unvalidated backup model.** The change calls `modelRegistry.complete` without first confirming that the model exists, supports images, and has `hasConfiguredAuth`.
- **Images sent to text-only models.** A transform path keeps `images` non-empty while the active model can't accept images.
- **Secrets or credentials** are hardcoded, logged, or written to the settings file.
- **Typecheck fails**, or the change adds `any`, `@ts-ignore`, `@ts-expect-error`, or `as unknown as`.
- **Obsolete packages.** The change imports `@mariozechner/*` or `@sinclair/typebox`.
- **Packaging breaks.** A runtime import is missing from `dependencies` or `peerDependencies`, or `pi.extensions` no longer points at the entry file.

## Major

- **Status leak.** A `ctx.ui.setStatus` key is set and not cleared on every exit path. We recommend `try`/`finally`.
- **Cost for multimodal models.** Work such as file reads or model lookups runs before the `supportsImages(ctx.model)` early return, when it could run after.
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

### Fail open in the `input` handler

```ts
// Correct: the user sees why, and the message passes through.
if (!backupModel || !supportsImages(backupModel)) {
	ctx.ui.notify(`Backup model ${backupId} unavailable or not image-capable`, "warning");
	return { action: "continue" };
}

// Wrong: the error is swallowed, or the message is dropped.
if (!backupModel) return { action: "transform", text: "", images: [] };
```

### Clear status on all paths

```ts
ctx.ui.setStatus(STATUS_KEY, `Describing image with ${backupId}...`);
try {
	// side query
} finally {
	ctx.ui.setStatus(STATUS_KEY, undefined);
}
```

### Guard order

Order the checks from cheapest to most expensive, and put the most restrictive first:

1. `event.source === "extension"`
2. Collect images. Return if there are none.
3. `supportsImages(ctx.model)`
4. Settings lookup, then model lookup, then capability check, then auth check.
5. The side query.

### Pure helpers stay pure

Keep helpers that parse text or filter models free of `ctx.ui` calls and free of module state. That lets tests call them directly.

## Out of scope for review

- Style preferences that the "Minor" list doesn't cover.
- Requests for features or configuration options the change didn't set out to add.
