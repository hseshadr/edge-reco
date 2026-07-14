import { describe, expect, it } from "vitest";
import { defineErrors, starterPack } from "../src/index.js";

const registry = defineErrors(starterPack);

describe("classify — HTTP status truth table", () => {
  const httpCases: ReadonlyArray<readonly [number, string]> = [
    [401, "ai.provider.unauthorized"],
    [403, "ai.provider.unauthorized"],
    [402, "ai.provider.out_of_credits"],
    [404, "ai.model.unavailable"],
    [429, "ai.provider.rate_limited"],
    [500, "ai.provider.server_error"],
    [502, "ai.provider.server_error"],
    [503, "ai.provider.server_error"],
    [504, "ai.provider.server_error"],
  ];

  for (const [status, code] of httpCases) {
    it(`maps { status: ${status} } -> ${code}`, () => {
      expect(registry.classify({ status })).toBe(code);
    });
  }

  it("reads status even when a message is also present", () => {
    const raw = { status: 402, message: "Insufficient credits on account" };
    expect(registry.classify(raw)).toBe("ai.provider.out_of_credits");
  });
});

describe("classify — thrown Error name / message cases", () => {
  it("maps an AbortError -> ai.request.timeout", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(registry.classify(err)).toBe("ai.request.timeout");
  });

  it("maps a TimeoutError -> ai.request.timeout", () => {
    const err = new Error("deadline exceeded");
    err.name = "TimeoutError";
    expect(registry.classify(err)).toBe("ai.request.timeout");
  });

  it("maps a message that says it timed out -> ai.request.timeout", () => {
    expect(registry.classify({ message: "The request timed out" })).toBe(
      "ai.request.timeout",
    );
  });

  it("maps 'Failed to fetch' (no status) -> net.unreachable", () => {
    const err = new TypeError("Failed to fetch");
    expect(registry.classify(err)).toBe("net.unreachable");
  });

  it("maps 'Load failed' (Safari, no status) -> net.unreachable", () => {
    expect(registry.classify({ message: "Load failed" })).toBe(
      "net.unreachable",
    );
  });

  it("maps a NetworkError body (no status) -> net.unreachable", () => {
    expect(registry.classify({ body: "NetworkError when fetching" })).toBe(
      "net.unreachable",
    );
  });

  it("does NOT treat a 500 whose text mentions network as net.unreachable", () => {
    const raw = { status: 500, message: "networkerror upstream" };
    expect(registry.classify(raw)).toBe("ai.provider.server_error");
  });

  it("maps a PrivacyViolationError -> ai.privacy.violation", () => {
    const err = new Error("blocked before egress");
    err.name = "PrivacyViolationError";
    expect(registry.classify(err)).toBe("ai.privacy.violation");
  });
});

describe("classify — fallback", () => {
  it("falls back to internal.unknown for an unrecognised failure", () => {
    expect(registry.classify(new Error("something odd"))).toBe(
      "internal.unknown",
    );
  });

  it("falls back to internal.unknown for a non-object raw", () => {
    expect(registry.classify("boom")).toBe("internal.unknown");
    expect(registry.classify(undefined)).toBe("internal.unknown");
    expect(registry.classify(null)).toBe("internal.unknown");
  });

  it("ignores a non-numeric status", () => {
    expect(registry.classify({ status: "402" })).toBe("internal.unknown");
  });

  it("falls back when the numeric status is not registered", () => {
    expect(registry.classify({ status: 418 })).toBe("internal.unknown");
  });
});

describe("classify — data-driven over the caller's own catalog", () => {
  const app = defineErrors(starterPack, {
    "billing.card_declined": {
      category: "provider",
      httpStatus: [402],
      en: "Your card was declined.",
    },
  });

  it("lets a caller add codes but starter httpStatus still wins by order", () => {
    // starterPack registers 402 first, so it keeps priority — codes are stable.
    expect(app.classify({ status: 402 })).toBe("ai.provider.out_of_credits");
  });

  it("honours a caller-supplied match predicate", () => {
    const app2 = defineErrors({
      "app.maintenance": {
        category: "provider",
        en: "Down for maintenance.",
        match: (raw) =>
          typeof raw === "object" &&
          raw !== null &&
          (raw as { code?: unknown }).code === "MAINTENANCE",
      },
      "internal.unknown": {
        category: "internal",
        en: "Something went wrong.",
      },
    });
    expect(app2.classify({ code: "MAINTENANCE" })).toBe("app.maintenance");
  });
});
