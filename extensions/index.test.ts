import type { AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeToolsWithReadImage,
	loadBackupModelId,
	readImageFile,
	resolveBackupModel,
	saveBackupModelId,
	supportsImages,
	syncReadImageActivation,
	textFromAssistant,
	type ImageBackupRegistry,
} from "./index";

// Minimal 1x1 PNG, accepted by detectSupportedImageMimeTypeFromFile.
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const MODEL_ID = "anthropic/test-model";

const imageModel: Model<"anthropic-messages"> = {
	id: "test-model",
	name: "Test Model",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 8192,
};

const textOnlyModel: Model<"anthropic-messages"> = { ...imageModel, input: ["text"] };

const USAGE: Usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 15,
	cost: { input: 0.1, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.15 },
};

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		timestamp: Date.now(),
		usage: USAGE,
		stopReason: "stop",
	};
}

interface FakeRegistryOptions {
	model?: Model<"anthropic-messages">;
	authed?: boolean;
	description?: string;
	completeError?: Error;
}

function makeRegistry(options: FakeRegistryOptions = {}): ImageBackupRegistry {
	return {
		find: vi.fn(() => options.model),
		hasConfiguredAuth: vi.fn(() => options.authed ?? true),
		complete: vi.fn(async () => {
			if (options.completeError) throw options.completeError;
			return assistantMessage(options.description ?? "A red square on a white background.");
		}),
	};
}

/** Fresh temp HOME so settings and files never touch the real ~/.pi. */
function freshHome(): string {
	return mkdtempSync(join(tmpdir(), "pi-enable-image-test-"));
}

describe("settings persistence", () => {
	let home: string;

	beforeEach(() => {
		home = freshHome();
		vi.stubEnv("HOME", home);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	it("returns undefined when no settings file exists", () => {
		expect(loadBackupModelId()).toBeUndefined();
	});

	it("saves and loads the backup model id", () => {
		saveBackupModelId(MODEL_ID);
		expect(loadBackupModelId()).toBe(MODEL_ID);
	});

	it("returns undefined on malformed JSON", () => {
		mkdirSync(join(home, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(home, CONFIG_DIR_NAME, "image-backup-model.json"), "{ not json");
		expect(loadBackupModelId()).toBeUndefined();
	});
});

describe("supportsImages", () => {
	it("is true for image-capable models", () => {
		expect(supportsImages(imageModel)).toBe(true);
	});

	it("is false for text-only models", () => {
		expect(supportsImages(textOnlyModel)).toBe(false);
		expect(supportsImages(undefined)).toBe(false);
	});
});

describe("read-image activation", () => {
	it("adds read-image to the active list for a text-only model", () => {
		expect(activeToolsWithReadImage(["read", "bash"], true)).toEqual(["read", "bash", "read-image"]);
	});

	it("removes read-image from the active list for an image-capable model", () => {
		expect(activeToolsWithReadImage(["read", "bash", "read-image"], false)).toEqual(["read", "bash"]);
		expect(activeToolsWithReadImage(["read", "bash"], false)).toEqual(["read", "bash"]);
	});

	it("activates the tool for a text-only model via setActiveTools", () => {
		const setActive = vi.fn();
		syncReadImageActivation(textOnlyModel, () => ["read", "bash"], setActive);
		expect(setActive).toHaveBeenCalledWith(["read", "bash", "read-image"]);
	});

	it("deactivates the tool for an image-capable model via setActiveTools", () => {
		const setActive = vi.fn();
		syncReadImageActivation(imageModel, () => ["read", "bash", "read-image"], setActive);
		expect(setActive).toHaveBeenCalledWith(["read", "bash"]);
	});

	it("treats a missing model as text-only and activates the tool", () => {
		const setActive = vi.fn();
		syncReadImageActivation(undefined, () => [], setActive);
		expect(setActive).toHaveBeenCalledWith(["read-image"]);
	});

	it("skips setActiveTools when the tool already matches the model", () => {
		const setActive = vi.fn();
		syncReadImageActivation(imageModel, () => ["read", "bash"], setActive);
		syncReadImageActivation(textOnlyModel, () => ["read-image"], setActive);
		syncReadImageActivation(undefined, () => ["read-image"], setActive);
		expect(setActive).not.toHaveBeenCalled();
	});
});

describe("textFromAssistant", () => {
	it("joins and trims text blocks", () => {
		expect(textFromAssistant(assistantMessage("  a\n\nb  "))).toBe("a\n\nb");
	});
});

describe("resolveBackupModel", () => {
	let home: string;

	beforeEach(() => {
		home = freshHome();
		vi.stubEnv("HOME", home);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	it("fails when no model is configured", () => {
		const result = resolveBackupModel(makeRegistry());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("/image-backup-model");
	});

	it("fails when the model is not in the catalogue", () => {
		saveBackupModelId(MODEL_ID);
		const result = resolveBackupModel(makeRegistry({ model: undefined }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("not in the catalogue");
	});

	it("fails when the model cannot accept images", () => {
		saveBackupModelId(MODEL_ID);
		const result = resolveBackupModel(makeRegistry({ model: textOnlyModel }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("cannot accept images");
	});

	it("fails when the model has no configured auth", () => {
		saveBackupModelId(MODEL_ID);
		const result = resolveBackupModel(makeRegistry({ model: imageModel, authed: false }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("no configured auth");
	});

	it("splits only the first slash when looking up the model", () => {
		saveBackupModelId("anthropic/model/with-slashes");
		const registry = makeRegistry({ model: imageModel });
		const result = resolveBackupModel(registry);
		expect(result.ok).toBe(true);
		expect(registry.find).toHaveBeenCalledWith("anthropic", "model/with-slashes");
	});
});

describe("readImageFile", () => {
	let home: string;
	let dir: string;

	beforeEach(() => {
		home = freshHome();
		dir = freshHome();
		vi.stubEnv("HOME", home);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	});

	it("describes an image and reports the side query usage", async () => {
		writeFileSync(join(dir, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		saveBackupModelId(MODEL_ID);
		const registry = makeRegistry({ model: imageModel, description: "A red square." });

		const result = await readImageFile("tiny.png", dir, registry);

		expect(result.content).toEqual([{ type: "text", text: "A red square." }]);
		expect(result.usage).toEqual(USAGE);
	});

	it("rejects when the file does not exist", async () => {
		saveBackupModelId(MODEL_ID);
		await expect(readImageFile("missing.png", dir, makeRegistry({ model: imageModel }))).rejects.toThrow(
			"File not found",
		);
	});

	it("rejects when the file is not a supported image", async () => {
		writeFileSync(join(dir, "fake.png"), "this is not an image");
		saveBackupModelId(MODEL_ID);
		await expect(readImageFile("fake.png", dir, makeRegistry({ model: imageModel }))).rejects.toThrow(
			"Not a supported image file",
		);
	});

	it("rejects before any model call when no backup model is configured", async () => {
		writeFileSync(join(dir, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const registry = makeRegistry({ model: imageModel });
		await expect(readImageFile("tiny.png", dir, registry)).rejects.toThrow("No image backup model configured");
		expect(registry.find).not.toHaveBeenCalled();
		expect(registry.complete).not.toHaveBeenCalled();
	});

	it("rejects with the provider error when the description fails", async () => {
		writeFileSync(join(dir, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		saveBackupModelId(MODEL_ID);
		await expect(
			readImageFile("tiny.png", dir, makeRegistry({ model: imageModel, completeError: new Error("boom") })),
		).rejects.toThrow("Image description failed: boom");
	});

	it("rejects when the backup model returns no text", async () => {
		writeFileSync(join(dir, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		saveBackupModelId(MODEL_ID);
		await expect(
			readImageFile("tiny.png", dir, makeRegistry({ model: imageModel, description: "   " })),
		).rejects.toThrow("empty description");
	});
});
