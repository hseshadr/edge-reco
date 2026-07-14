import { describe, expect, it, vi } from "vitest";
import { defineErrors, starterPack, type TFunction } from "../src/index.js";

const registry = defineErrors(starterPack);

describe("describe — via a consumer-provided i18next-style t", () => {
  it("calls t with `errors.<code>` and the params, returning its output", () => {
    const t: TFunction = vi.fn(
      (key: string, params?: Record<string, string | number>) =>
        `[${key}] credits=${params?.creditsLeft ?? "?"}`,
    );
    const out = registry.describe(
      "ai.provider.out_of_credits",
      { creditsLeft: 0 },
      t,
    );
    expect(t).toHaveBeenCalledWith("errors.ai.provider.out_of_credits", {
      creditsLeft: 0,
    });
    expect(out).toBe("[errors.ai.provider.out_of_credits] credits=0");
  });

  it("falls back to the catalog default English when t returns the key unchanged", () => {
    // i18next returns the key verbatim when the resource is missing.
    const t: TFunction = (key: string) => key;
    const out = registry.describe("ai.provider.out_of_credits", {}, t);
    expect(out).toBe(
      "Your provider account is out of credits. Add credits and try again.",
    );
  });
});

describe("describe — default English fallback (no t supplied)", () => {
  it("returns the catalog default English", () => {
    expect(registry.describe("net.unreachable")).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });

  it("interpolates single-brace params into the default English", () => {
    expect(registry.describe("config.missing", { field: "apiKey" })).toBe(
      "A required setting is missing: apiKey.",
    );
  });

  it("leaves an unknown placeholder untouched when its param is absent", () => {
    expect(registry.describe("config.missing")).toBe(
      "A required setting is missing: {field}.",
    );
  });

  it("returns a last-resort string for a code with no registered default", () => {
    const reg = defineErrors({
      "app.bare": { category: "internal" },
    });
    expect(reg.describe("app.bare")).toBe("app.bare");
  });
});
