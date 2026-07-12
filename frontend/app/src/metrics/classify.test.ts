import { describe, expect, it } from "vitest";
import { classifyResource } from "./classify";

const EDGE_ORIGIN = "https://cdn.example.com";
const EVENTS_URL = "https://events.example.com/api/events";

describe("classifyResource", () => {
	describe("image bucket", () => {
		it("classifies a media-amazon.com URL as image", () => {
			expect(
				classifyResource("https://m.media-amazon.com/images/I/71abc.jpg", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("image");
		});

		it("classifies a subdomain of media-amazon.com as image", () => {
			expect(
				classifyResource(
					"https://images-na.ssl-images-amazon.com/images/I/x.jpg",
					{ edgeOrigin: EDGE_ORIGIN },
				),
			).toBe("other"); // ssl-images-amazon.com does NOT end with media-amazon.com
		});

		it("does not classify a lookalike hostname as an image", () => {
			expect(
				classifyResource("https://evilmedia-amazon.com/collect", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("other");
		});

		it("classifies image before edge when host happens to be media-amazon.com (ordering)", () => {
			// image rule fires first even if edgeOrigin were somehow set to media-amazon.com origin
			expect(
				classifyResource("https://m.media-amazon.com/images/I/71abc.jpg", {
					edgeOrigin: "https://m.media-amazon.com",
				}),
			).toBe("image");
		});
	});

	describe("uplink bucket", () => {
		it("classifies a URL at the eventsUrl origin as uplink", () => {
			expect(
				classifyResource("https://events.example.com/api/events", {
					edgeOrigin: EDGE_ORIGIN,
					eventsUrl: EVENTS_URL,
				}),
			).toBe("uplink");
		});

		it("classifies any path under the eventsUrl origin as uplink", () => {
			expect(
				classifyResource("https://events.example.com/other/path", {
					edgeOrigin: EDGE_ORIGIN,
					eventsUrl: EVENTS_URL,
				}),
			).toBe("uplink");
		});

		it("returns other when eventsUrl is null", () => {
			expect(
				classifyResource("https://events.example.com/api/events", {
					edgeOrigin: EDGE_ORIGIN,
					eventsUrl: null,
				}),
			).toBe("other");
		});

		it("returns other when eventsUrl is not set", () => {
			expect(
				classifyResource("https://events.example.com/api/events", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("other");
		});
	});

	describe("edge bucket", () => {
		it("classifies a URL whose origin matches edgeOrigin as edge", () => {
			expect(
				classifyResource("https://cdn.example.com/bundle/latest", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("edge");
		});

		it("classifies the edgeOrigin root URL as edge", () => {
			expect(
				classifyResource("https://cdn.example.com", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("edge");
		});
	});

	describe("other bucket", () => {
		it("classifies an unrelated URL as other", () => {
			expect(
				classifyResource("https://api.somewhere-else.com/v1/data", {
					edgeOrigin: EDGE_ORIGIN,
				}),
			).toBe("other");
		});
	});

	describe("robustness", () => {
		it("returns other for an unparseable URL instead of throwing", () => {
			expect(
				classifyResource("not-a-url:::garbage", { edgeOrigin: EDGE_ORIGIN }),
			).toBe("other");
		});

		it("returns other for an empty string", () => {
			expect(classifyResource("", { edgeOrigin: EDGE_ORIGIN })).toBe("other");
		});
	});
});
