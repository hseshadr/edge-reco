import { describe, expect, it } from "vitest";
import { defineErrors, starterPack } from "../src/index.js";

describe("starterPack — the 18 universal codes", () => {
  const codes = Object.keys(starterPack);

  it("transcribes exactly the 18 registry codes", () => {
    expect(codes).toHaveLength(18);
    expect(codes).toEqual(
      expect.arrayContaining([
        "ai.config.no_key",
        "ai.provider.unauthorized",
        "ai.provider.out_of_credits",
        "ai.provider.rate_limited",
        "ai.provider.server_error",
        "ai.model.unavailable",
        "ai.request.timeout",
        "ai.request.cancelled",
        "ai.privacy.violation",
        "net.unreachable",
        "bundle.download_failed",
        "bundle.integrity_failed",
        "bundle.quota_exceeded",
        "bundle.device_unsupported",
        "bundle.timeout",
        "config.missing",
        "config.invalid",
        "internal.unknown",
      ]),
    );
  });

  it("carries category + default English on every code", () => {
    for (const entry of Object.values(starterPack)) {
      expect(entry.category).toBeTypeOf("string");
      expect(entry.en).toBeTypeOf("string");
    }
  });

  it("preserves the params contract from the registry", () => {
    expect(starterPack["ai.provider.out_of_credits"]?.params).toEqual([
      "creditsLeft",
      "creditsTotal",
      "currency",
    ]);
    expect(starterPack["bundle.quota_exceeded"]?.params).toEqual([
      "requiredBytes",
      "availableBytes",
    ]);
  });

  it("registers the documented HTTP statuses", () => {
    expect(starterPack["ai.provider.unauthorized"]?.httpStatus).toEqual([
      401, 403,
    ]);
    expect(starterPack["ai.provider.server_error"]?.httpStatus).toEqual([
      500, 502, 503, 504,
    ]);
  });

  it("is registerable and can be extended with a consumer's own codes", () => {
    const reg = defineErrors({
      ...starterPack,
      "shop.out_of_stock": { category: "provider", en: "Sold out." },
    });
    expect(reg.has("shop.out_of_stock")).toBe(true);
    expect(reg.has("ai.provider.out_of_credits")).toBe(true);
    expect(reg.classify({ status: 402 })).toBe("ai.provider.out_of_credits");
  });
});
