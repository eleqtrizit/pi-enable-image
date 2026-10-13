import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DESCRIPTION_PROMPT =
	"Describe this image thoroughly and precisely: its type (screenshot, diagram, photo, ...), all visible text, layout, UI elements under discussion, and whatever a reader would need to act on its contents. Plain prose, no preamble.";

const SETTINGS_FILE = "image-backup-model.json";

function agentDir(): string {
	// The agent dir is `<home>/<CONFIG_DIR_NAME>` (typically ~/.pi).
	return join(process.env["HOME"] ?? process.cwd(), CONFIG_DIR_NAME);
}

function settingsPath(): string {
	return join(agentDir(), SETTINGS_FILE);
}

function loadBackupModelId(): string | undefined {
	const path = settingsPath();
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { backupModel?: string };
		return parsed.backupModel;
	} catch {
		return undefined;
	}
}

function saveBackupModelId(id: string): void {
	const path = settingsPath();
	mkdirSync(agentDir(), { recursive: true });
	writeFileSync(path, JSON.stringify({ backupModel: id }, null, 2));
}

function supportsImages(model: Model<Api> | undefined | null): boolean {
	return !!model && model.input.includes("image");
}

/** List candidate backup models: scoped models first, else the full catalogue; image-capable only. */
function candidateModels(ctx: ExtensionContext): Model<Api>[] {
	const scoped = ctx.scopedModels.map((s) => s.model);
	const pool = scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable();
	return pool.filter((m) => supportsImages(m));
}

async function describeImage(
	backupModel: Model<Api>,
	image: ImageContent,
	ctx: ExtensionContext,
): Promise<string> {
	const response = await ctx.modelRegistry.complete(
		backupModel,
		{
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
		},
		{ maxTokens: 4096, cacheRetention: "none" },
	);
	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

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

	pi.on("input", async (event, ctx): Promise<InputEventResult> => {
		// Only touch real user input; never extension-injected messages.
		if (event.source === "extension") return { action: "continue" };
		if (!event.images || event.images.length === 0) return { action: "continue" };
		if (supportsImages(ctx.model)) return { action: "continue" };

		const backupId = loadBackupModelId();
		if (!backupId) {
			ctx.ui.notify("Model cannot see images. Set one with /image-backup-model.", "warning");
			return { action: "continue" };
		}
		const [provider, ...rest] = backupId.split("/");
		const backupModel = ctx.modelRegistry.find(provider, rest.join("/"));
		if (!backupModel || !supportsImages(backupModel)) {
			ctx.ui.notify(`Backup model ${backupId} unavailable or not image-capable`, "warning");
			return { action: "continue" };
		}
		if (!ctx.modelRegistry.hasConfiguredAuth(backupModel)) {
			ctx.ui.notify(`Backup model ${backupId} has no configured auth`, "warning");
			return { action: "continue" };
		}

		try {
			const descriptions: string[] = [];
			for (const image of event.images) {
				ctx.ui.setStatus("image-backup", `Describing image with ${backupId}...`);
				descriptions.push(await describeImage(backupModel, image, ctx));
			}
			ctx.ui.setStatus("image-backup", undefined);

			const block = descriptions
				.map((d) => `<image description>\n${d}\n</image description>`)
				.join("\n\n");
			const text = event.text.trim() ? `${event.text}\n\n${block}` : block;
			// Drop the images from the outgoing message; the text-only model gets prose instead.
			return { action: "transform", text, images: [] };
		} catch (error) {
			ctx.ui.setStatus("image-backup", undefined);
			ctx.ui.notify(`Image description failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			// Pass through unchanged so the original provider error is visible.
			return { action: "continue" };
		}
	});
}
