import type { Api, AssistantMessage, Context, ImageContent, Model } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	detectSupportedImageMimeTypeFromFile,
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";

const DESCRIPTION_PROMPT =
	"Describe this image thoroughly and precisely: its type (screenshot, diagram, photo, ...), all visible text, layout, UI elements under discussion, and whatever a reader would need to act on its contents. Plain prose, no preamble.";

const SETTINGS_FILE = "image-backup-model.json";

const SUPPORTED_IMAGE_EXTENSIONS = "png, jpg, jpeg, gif, webp, bmp";

const MAX_TOKENS = 4096;

/** The slice of the model registry the image describer needs. Keeps test fakes small. */
export type ImageBackupRegistry = Pick<ExtensionContext["modelRegistry"], "find" | "hasConfiguredAuth" | "complete">;

const ReadImageParams = Type.Object({
	path: Type.String({
		description:
			`Path to the image file (${SUPPORTED_IMAGE_EXTENSIONS}). ` +
			"Relative paths resolve against the current working directory.",
	}),
});

function agentDir(): string {
	// The agent dir is `<home>/<CONFIG_DIR_NAME>` (typically ~/.pi).
	return join(process.env["HOME"] ?? process.cwd(), CONFIG_DIR_NAME);
}

function settingsPath(): string {
	return join(agentDir(), SETTINGS_FILE);
}

export function loadBackupModelId(): string | undefined {
	const path = settingsPath();
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { backupModel?: string };
		return parsed.backupModel;
	} catch {
		return undefined;
	}
}

export function saveBackupModelId(id: string): void {
	const path = settingsPath();
	mkdirSync(agentDir(), { recursive: true });
	writeFileSync(path, JSON.stringify({ backupModel: id }, null, 2));
}

export function supportsImages(model: Model<Api> | undefined | null): boolean {
	return !!model && model.input.includes("image");
}

/** List candidate backup models: scoped models first, else the full catalogue; image-capable only. */
export function candidateModels(ctx: ExtensionContext): Model<Api>[] {
	const scoped = ctx.scopedModels.map((s) => s.model);
	const pool = scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable();
	return pool.filter((m) => supportsImages(m));
}

type BackupResolution = { ok: true; model: Model<Api> } | { ok: false; error: string };

/** Look up the configured backup model and validate it before any model call. */
export function resolveBackupModel(registry: ImageBackupRegistry): BackupResolution {
	const backupId = loadBackupModelId();
	if (!backupId) {
		return { ok: false, error: "No image backup model configured. Run /image-backup-model to set one." };
	}
	// Model ids can contain "/" after the provider, so only the first segment names the provider.
	const [provider, ...rest] = backupId.split("/");
	const backupModel = registry.find(provider, rest.join("/"));
	if (!backupModel) {
		return { ok: false, error: `Image backup model ${backupId} is not in the catalogue. Run /image-backup-model.` };
	}
	if (!supportsImages(backupModel)) {
		return { ok: false, error: `Image backup model ${backupId} cannot accept images. Run /image-backup-model.` };
	}
	if (!registry.hasConfiguredAuth(backupModel)) {
		return { ok: false, error: `Image backup model ${backupId} has no configured auth.` };
	}
	return { ok: true, model: backupModel };
}

/** Extract the joined text of an assistant response. */
export function textFromAssistant(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

async function describeImage(
	backupModel: Model<Api>,
	image: ImageContent,
	registry: ImageBackupRegistry,
): Promise<AssistantMessage> {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: DESCRIPTION_PROMPT },
					{ type: "image", data: image.data, mimeType: image.mimeType },
				],
				timestamp: Date.now(),
			},
		],
	};
	return registry.complete(backupModel, context, { maxTokens: MAX_TOKENS, cacheRetention: "none" });
}

/**
 * Validate the target file, describe it with the backup model, and shape the tool result.
 * Throws on invalid input or a failed description; pi reports the message to the model as
 * the tool's error result.
 */
export async function readImageFile(
	rawPath: string,
	cwd: string,
	registry: ImageBackupRegistry,
): Promise<AgentToolResult<undefined>> {
	const path = resolve(cwd, rawPath);

	// Model-provided paths are untrusted: confirm a real file and a supported image before reading.
	if (!isFile(path)) {
		throw new Error(`File not found: ${path}`);
	}
	const mimeType = await detectSupportedImageMimeTypeFromFile(path);
	if (!mimeType) {
		throw new Error(`Not a supported image file (${SUPPORTED_IMAGE_EXTENSIONS}): ${path}`);
	}

	const backup = resolveBackupModel(registry);
	if (!backup.ok) throw new Error(backup.error);

	let response: AssistantMessage;
	try {
		const image: ImageContent = { type: "image", data: readFileSync(path, "base64"), mimeType };
		response = await describeImage(backup.model, image, registry);
	} catch (error) {
		throw new Error(`Image description failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const text = textFromAssistant(response);
	if (!text) {
		throw new Error(`The backup model returned an empty description for ${path}.`);
	}
	// Report the side query's usage so session totals stay accurate.
	return { content: [{ type: "text", text }], details: undefined, usage: response.usage };
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

const readImageTool: ToolDefinition<typeof ReadImageParams, undefined> = {
	name: "read-image",
	label: "Read image",
	description:
		"Read an image file and return a thorough text description of it: its type, all visible text, layout, " +
		"UI elements, and whatever is needed to act on the contents. The description comes from the multimodal " +
		`backup model picked with /image-backup-model. Use this tool when the active model cannot view images ` +
		`directly. Supported formats: ${SUPPORTED_IMAGE_EXTENSIONS}.`,
	promptSnippet:
		"read-image(path): describe an image file with the multimodal backup model when you cannot view images yourself",
	parameters: ReadImageParams,
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return readImageFile(params.path, ctx.cwd, ctx.modelRegistry);
	},
};

export default function imageBackupModel(pi: ExtensionAPI) {
	pi.registerCommand("image-backup-model", {
		description: "Pick the multimodal model used to describe images for text-only models",
		handler: async (_args, ctx) => {
			const candidates = candidateModels(ctx);
			if (candidates.length === 0) {
				ctx.ui.notify("No image-capable models available", "warning");
				return;
			}
			const choices = candidates.map((m) => `${m.provider}/${m.id}`);
			const current = loadBackupModelId();
			ctx.ui.notify(`Current backup model: ${current ?? "not set"}`, "info");
			const choice = await ctx.ui.select("Backup image model:", choices);
			if (!choice) return;
			saveBackupModelId(choice);
			ctx.ui.notify(`Backup image model set to ${choice}`, "info");
		},
	});

	pi.registerTool(readImageTool);
}
