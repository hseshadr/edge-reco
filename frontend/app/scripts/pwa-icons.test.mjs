import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");

/** Parse width/height from a PNG's IHDR chunk (no image lib needed). */
function pngSize(file) {
	const b = readFileSync(file);
	assert.equal(b.toString("ascii", 12, 16), "IHDR", `${file} is not a PNG`);
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("PWA icons exist at the declared sizes", () => {
	for (const [name, size] of [
		["pwa-192x192.png", 192],
		["pwa-512x512.png", 512],
		["maskable-512x512.png", 512],
	]) {
		const p = join(PUBLIC, name);
		assert.ok(
			existsSync(p),
			`${name} missing — run \`pnpm -F frontend gen-icons\``,
		);
		const { w, h } = pngSize(p);
		assert.equal(w, size, `${name} width`);
		assert.equal(h, size, `${name} height`);
	}
});
