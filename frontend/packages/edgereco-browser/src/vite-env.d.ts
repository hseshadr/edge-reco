/// <reference types="vite/client" />

// The engine reads its bundle origin from Vite's compile-time env. The consuming
// app (the demo) injects VITE_BUNDLE_BASE_URL; this declares the shape the engine
// depends on so the package typechecks standalone.
interface ImportMetaEnv {
	/** Origin serving the signed, content-addressed bundle (`/latest`, `/manifest/*`, `/chunk/*`). */
	readonly VITE_BUNDLE_BASE_URL: string;
	readonly VITE_BUNDLE_ID?: string;
	readonly VITE_BUNDLE_CHANNEL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
