import { errorNameOf, errorTextOf, httpStatusOf } from "./raw.js";
import type { Catalog } from "./types.js";

const NETWORK_TEXT = /failed to fetch|load failed|networkerror/i;
const TIMEOUT_TEXT = /timeout|timed out/i;

/**
 * The 18 universal error codes (`ai.*`, `net.*`, `bundle.*`, `config.*`,
 * `internal`), transcribed from `errors-registry.json`. It is an OPTIONAL
 * starter pack, not a mandate: a site may `defineErrors({ ...starterPack,
 * ...ownCodes })` to avoid re-declaring the common ones, then add its own.
 *
 * On top of the registry data, three codes carry the AlmaMesh-proven `match`
 * rules for the failures that have no HTTP status: an aborted/timed-out request,
 * a fetch/network failure, and a pre-egress privacy block.
 */
export const starterPack = {
  "ai.config.no_key": {
    category: "config",
    params: [],
    en: "No AI provider key is set. Add your key in Settings → AI to turn on the optional AI features.",
  },
  "ai.provider.unauthorized": {
    category: "config",
    httpStatus: [401, 403],
    params: [],
    en: "Your AI provider key was rejected. Check the key in Settings → AI.",
  },
  "ai.provider.out_of_credits": {
    category: "provider",
    httpStatus: [402],
    params: ["creditsLeft", "creditsTotal", "currency"],
    en: "Your provider account is out of credits. Add credits and try again.",
  },
  "ai.provider.rate_limited": {
    category: "provider",
    httpStatus: [429],
    params: ["retryAfter"],
    en: "The AI provider is rate-limiting requests. Wait a moment and try again.",
  },
  "ai.provider.server_error": {
    category: "provider",
    httpStatus: [500, 502, 503, 504],
    params: [],
    en: "The AI provider had a server error. Try again shortly.",
  },
  "ai.model.unavailable": {
    category: "config",
    httpStatus: [404],
    params: ["model"],
    en: "The selected model isn't available. Pick another model in Settings → AI.",
  },
  "ai.request.timeout": {
    category: "timeout",
    params: [],
    en: "The AI request timed out. Try again.",
    match: (raw) => {
      const name = errorNameOf(raw);
      if (name === "AbortError" || name === "TimeoutError") return true;
      return TIMEOUT_TEXT.test(errorTextOf(raw));
    },
  },
  "ai.request.cancelled": {
    category: "internal",
    params: [],
    en: "The AI request was cancelled.",
  },
  "ai.privacy.violation": {
    category: "config",
    params: [],
    en: "The request was blocked to protect your private data before it left this device.",
    match: (raw) => errorNameOf(raw) === "PrivacyViolationError",
  },
  "net.unreachable": {
    category: "network",
    params: [],
    en: "Couldn't reach the server. Check your connection and try again.",
    match: (raw) =>
      httpStatusOf(raw) === undefined && NETWORK_TEXT.test(errorTextOf(raw)),
  },
  "bundle.download_failed": {
    category: "network",
    params: [],
    en: "Couldn't download the data bundle. Check your connection and retry.",
  },
  "bundle.integrity_failed": {
    category: "integrity",
    params: ["chunk"],
    en: "A downloaded file failed its integrity check. Retry to re-fetch it.",
  },
  "bundle.quota_exceeded": {
    category: "device",
    params: ["requiredBytes", "availableBytes"],
    en: "Not enough free storage to load the data on this device. Free up space and retry, or use a desktop browser.",
  },
  "bundle.device_unsupported": {
    category: "device",
    params: ["reason"],
    en: "This device or browser can't run the local engine. Try a recent desktop browser.",
  },
  "bundle.timeout": {
    category: "timeout",
    params: [],
    en: "Loading the data timed out. Retry, or try on a desktop browser.",
  },
  "config.missing": {
    category: "config",
    params: ["field"],
    en: "A required setting is missing: {field}.",
  },
  "config.invalid": {
    category: "config",
    params: ["field"],
    en: "A setting is invalid: {field}.",
  },
  "internal.unknown": {
    category: "internal",
    params: [],
    en: "Something went wrong. Try again.",
  },
} as const satisfies Catalog;
