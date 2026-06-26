// One-shot PWA icon generation from the brand favicon. Outputs are COMMITTED to
// public/, so the production build never depends on sharp. Re-run only when the
// brand mark changes: `pnpm -F frontend gen-icons`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");
const SRC = join(PUBLIC, "favicon.svg");
const PAPER = "#faf6ef"; // --paper, matches the manifest background_color

/** Render the cloud mark centered on a square paper tile, with `pad` safe-zone. */
async function render(size, pad, out) {
	const inner = Math.round(size * (1 - pad * 2));
	const mark = await sharp(readFileSync(SRC), { density: 384 })
		.resize(inner, inner, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
	await sharp({
		create: { width: size, height: size, channels: 4, background: PAPER },
	})
		.composite([{ input: mark, gravity: "center" }])
		.png()
		.toFile(join(PUBLIC, out));
	process.stdout.write(`>> ${out} (${size}x${size})\n`);
}

await render(192, 0.08, "pwa-192x192.png");
await render(512, 0.08, "pwa-512x512.png");
await render(512, 0.18, "maskable-512x512.png"); // wider safe zone for maskable crop
process.stdout.write(">> PWA icons generated\n");
