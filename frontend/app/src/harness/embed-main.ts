// Test-only harness: create the REAL transformers.js embedder and expose a tiny
// imperative API on window so Playwright can drive a REAL browser run of the
// in-browser embedding path (onnxruntime-web WASM). Not part of the Nimbus
// runtime — it exists solely to prove the model loads + embeds under
// transformers.js v4, the riskiest dependency edge.

import { createEmbedder, EMBEDDING_DIM } from "@edgeproc/browser";

declare global {
	interface Window {
		__embed?: (text: string) => Promise<number[]>;
		__embeddingDim?: number;
	}
}

const embedder = createEmbedder();

window.__embed = async (text: string): Promise<number[]> => {
	// First call lazily fetches + compiles the ~25 MB model over WASM.
	return Array.from(await embedder.embed(text));
};
window.__embeddingDim = EMBEDDING_DIM;

// Signal readiness to the test harness (wired — the model loads on first embed).
const status = document.getElementById("status");
if (status !== null) {
	status.textContent = "embedder-ready";
}
