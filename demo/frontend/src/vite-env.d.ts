/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Caddy origin serving the signed, content-addressed bundle. */
	readonly VITE_BUNDLE_BASE_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
