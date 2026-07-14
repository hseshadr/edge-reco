import { describe, expect, it } from "vitest";
import { CanonicalError, defineErrors, starterPack } from "../src/index.js";

describe("CanonicalError", () => {
  it("is a real Error subclass carrying code, category and params", () => {
    const err = new CanonicalError("bundle.quota_exceeded", "device", {
      requiredBytes: 1024,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CanonicalError);
    expect(err.code).toBe("bundle.quota_exceeded");
    expect(err.category).toBe("device");
    expect(err.params).toEqual({ requiredBytes: 1024 });
    expect(err.name).toBe("CanonicalError");
    // The code is the message so it stays greppable in logs.
    expect(err.message).toBe("bundle.quota_exceeded");
  });

  it("defaults params to an empty object", () => {
    const err = new CanonicalError("internal.unknown", "internal");
    expect(err.params).toEqual({});
  });

  it("is throwable and catchable by its code", () => {
    try {
      throw new CanonicalError("ai.request.cancelled", "internal");
    } catch (e) {
      expect((e as CanonicalError).code).toBe("ai.request.cancelled");
    }
  });
});

describe("registry.create — category looked up from the catalog", () => {
  const reg = defineErrors(starterPack);

  it("constructs a CanonicalError with the registered category", () => {
    const err = reg.create("bundle.quota_exceeded", {
      requiredBytes: 2048,
      availableBytes: 100,
    });
    expect(err).toBeInstanceOf(CanonicalError);
    expect(err.category).toBe("device");
    expect(err.params).toEqual({ requiredBytes: 2048, availableBytes: 100 });
  });

  it("falls back to internal category for an unknown code", () => {
    const err = reg.create("not.registered");
    expect(err.category).toBe("internal");
  });
});
