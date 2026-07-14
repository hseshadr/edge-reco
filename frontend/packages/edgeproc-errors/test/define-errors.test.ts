import { describe, expect, it } from "vitest";
import {
  type Category,
  DuplicateCodeError,
  defineErrors,
  starterPack,
} from "../src/index.js";

describe("defineErrors — registry construction", () => {
  it("exposes the registered codes", () => {
    const reg = defineErrors({
      "a.b.c": { category: "internal", en: "x" },
      "d.e.f": { category: "network", en: "y" },
    });
    expect(reg.codes).toEqual(["a.b.c", "d.e.f"]);
    expect(reg.has("a.b.c")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("exposes the entry (category + default) via get()", () => {
    const reg = defineErrors(starterPack);
    const entry = reg.get("ai.provider.out_of_credits");
    expect(entry?.category).toBe("provider");
    const category: Category | undefined = entry?.category;
    expect(category).toBe("provider");
  });

  it("returns undefined from get() for an unregistered code", () => {
    const reg = defineErrors(starterPack);
    expect(reg.get("not.a.code")).toBeUndefined();
  });
});

describe("defineErrors — duplicate code rejection across fragments", () => {
  it("throws DuplicateCodeError when a code is defined in two fragments", () => {
    expect(() =>
      defineErrors(starterPack, {
        // internal.unknown already lives in starterPack.
        "internal.unknown": { category: "internal", en: "dupe" },
      }),
    ).toThrow(DuplicateCodeError);
  });

  it("names the offending code in the error message", () => {
    expect(() =>
      defineErrors(
        { "x.y": { category: "internal" } },
        { "x.y": { category: "network" } },
      ),
    ).toThrow(/x\.y/);
  });

  it("merges non-overlapping fragments cleanly", () => {
    const reg = defineErrors(
      { "one.a": { category: "internal", en: "1" } },
      { "two.b": { category: "network", en: "2" } },
    );
    expect(reg.codes).toEqual(["one.a", "two.b"]);
  });
});

describe("defineErrors — typed params contract", () => {
  const reg = defineErrors({
    "pay.declined": {
      category: "provider",
      params: ["amount", "currency"],
      en: "Declined: {amount} {currency}.",
    },
    "internal.unknown": { category: "internal", en: "Something went wrong." },
  });

  it("accepts declared params on describe()", () => {
    // Type-level contract: only `amount` / `currency` are valid keys here.
    expect(reg.describe("pay.declined", { amount: 42, currency: "USD" })).toBe(
      "Declined: 42 USD.",
    );
  });

  it("accepts declared params on create()", () => {
    const err = reg.create("pay.declined", { amount: 42, currency: "USD" });
    expect(err.code).toBe("pay.declined");
    expect(err.params).toEqual({ amount: 42, currency: "USD" });
    expect(err.category).toBe("provider");
  });
});
