/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Caddy origin serving the signed, content-addressed bundle. */
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
