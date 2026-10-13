# pi Enable Image

A [pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension that lets text-only models work with images. When your current model cannot accept images, the extension sends each attached image to a multimodal backup model in a side query, then replaces the image with a thorough text description in your message.

## Quickstart

Install inside pi:

```bash
pi install https://github.com/eleqtrizit/pi-enable-image.git
```

Then run `/image-backup-model` once to pick the multimodal model used to describe images. The choice persists in `~/.pi/image-backup-model.json`.

## How it works

- Attach an image as usual. If the active model is image-capable, nothing changes.
- If the active model cannot see images, the extension asks the backup model to describe each image thoroughly (visible text, layout, UI elements, anything needed to act on it).
- Your message goes to the model with an `<image description>` block instead of the raw image, so requests like "glm-53 is not a multimodal model" no longer fail.
- Failed descriptions pass the original message through unchanged, so you always see the provider error instead of a silent drop.

## Development

```bash
npm install
npm run typecheck
pi -e ./extensions/index.ts     # load the extension directly from the repo
```

After `npm install`, docs and examples ship inside the pi package under `node_modules/@earendil-works/pi-coding-agent/docs/`.
