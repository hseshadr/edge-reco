import { describe, expect, it } from "vitest";
import { defineErrors, starterPack } from "../src/index.js";

const registry = defineErrors(starterPack);

describe("toProblemDetails — RFC 9457 conformance", () => {
  it("uses the code as `type` when no problemType is registered", () => {
    const pd = registry.toProblemDetails("ai.provider.out_of_credits");
    expect(pd.type).toBe("ai.provider.out_of_credits");
  });

  it("prefers a registered problemType URI as `type`", () => {
    const reg = defineErrors({
      "app.teapot": {
        category: "internal",
        problemType: "https://example.com/probs/teapot",
        en: "I'm a teapot.",
      },
    });
    const pd = reg.toProblemDetails("app.teapot");
    expect(pd.type).toBe("https://example.com/probs/teapot");
  });

  it("derives `title` from describe() when none is supplied", () => {
    const pd = registry.toProblemDetails("net.unreachable");
    expect(pd.title).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });

  it("uses an explicit title when supplied", () => {
    const pd = registry.toProblemDetails(
      "ai.provider.rate_limited",
      {},
      { title: "Slow down" },
    );
    expect(pd.title).toBe("Slow down");
  });

  it("defaults `status` to the first registered httpStatus", () => {
    const pd = registry.toProblemDetails("ai.provider.out_of_credits");
    expect(pd.status).toBe(402);
  });

  it("prefers an explicit status and carries instance", () => {
    const pd = registry.toProblemDetails(
      "ai.provider.server_error",
      {},
      { status: 503, instance: "/v1/chat/42" },
    );
    expect(pd.status).toBe(503);
    expect(pd.instance).toBe("/v1/chat/42");
  });

  it("omits status entirely when there is neither an option nor an httpStatus", () => {
    const pd = registry.toProblemDetails("internal.unknown");
    expect("status" in pd).toBe(false);
  });

  it("spreads params as extension members alongside the core fields", () => {
    const pd = registry.toProblemDetails("ai.provider.out_of_credits", {
      creditsLeft: 0,
      currency: "USD",
    });
    expect(pd).toMatchObject({
      type: "ai.provider.out_of_credits",
      status: 402,
      creditsLeft: 0,
      currency: "USD",
    });
    expect(typeof pd.title).toBe("string");
  });
});
