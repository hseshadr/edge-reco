/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
	/**
	 * Where the signed, content-addressed bundle is served from. Absolute in
	 * the Docker demo (the Caddy edge, e.g. http://localhost:8081) or
	 * app-relative for same-origin hosting (the GitHub Pages build sets
	 * "bundle"); resolved to an absolute URL at runtime by
	 * `api/bundleUrl.resolveBundleBaseUrl`.
	 */
	readonly VITE_BUNDLE_BASE_URL: string;
	/**
	 * Optional "mimicked cloud" collector for the interaction-event uplink
	 * (the flywheel). UNSET/empty → the uplink is fully disabled and the demo
	 * makes zero backend calls (the headline invariant). When set (e.g. by
	 * `poe demo-flywheel`), clicks are batched and flushed here off the
	 * inference path.
	 */
	readonly VITE_EVENTS_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
