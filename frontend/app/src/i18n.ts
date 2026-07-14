/**
 * i18next initialization — OFFLINE, bundled catalogs (no runtime fetch).
 *
 * Every translation JSON is imported STATICALLY below, so Vite bundles + hashes
 * them and the PWA service worker precaches them. The app never reaches the
 * network for strings: it works fully offline, exactly like the rest of EdgeReco
 * (search, ranking, and recommendations all run in the tab, zero backend calls).
 *
 * English is the authoritative baseline. Adding a locale is copy-paste: duplicate
 * `locales/en/` to `locales/<lang>/`, translate the values, register it in
 * `resources` + `supportedLngs` below. The parity test (locales.parity.test.ts)
 * then auto-enforces that the new locale covers every en key.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enLanding from "./locales/en/landing.json";
import enStorefront from "./locales/en/storefront.json";

/** The registered namespaces. Kept in one place so config + parity test agree. */
export const I18N_NAMESPACES = [
	"common",
	"landing",
	"storefront",
	"errors",
] as const;

const resources = {
	en: {
		common: enCommon,
		landing: enLanding,
		storefront: enStorefront,
		errors: enErrors,
	},
} as const;

// Inline resources are added to the store synchronously during init(), so the
// very first render already resolves real copy (no Suspense, no raw-key flash).
// useSuspense:false keeps the provider-less component specs from suspending on a
// (here impossible) not-ready read.
void i18n.use(initReactI18next).init({
	resources,
	lng: "en",
	fallbackLng: "en",
	supportedLngs: ["en"],
	ns: I18N_NAMESPACES,
	defaultNS: "common",
	returnNull: false,
	interpolation: { escapeValue: false },
	react: { useSuspense: false },
});

export default i18n;
