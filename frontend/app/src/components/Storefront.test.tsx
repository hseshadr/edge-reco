// Storefront is the orchestration root: it wires the data layer (engine client),
// the explicit-signal emitter, and the live-metrics observer into the Header /
// rails / grid / PDP view tree. These specs mock those three boundaries so the
// orchestration logic — mount loads, click→PDP→back, error+retry, category
// re-browse, search, cart/favorite signals — is exercised as fast jsdom units.
// The real engine, the IntersectionObserver dwell path, and motion animations
// are intentionally left to the Playwright e2e/offline suites (no jsdom IO; the
// dwell hook already documents its silent no-op under jsdom).

import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, SearchResult, Strategy } from "../api/types";

const mocks = vi.hoisted(() => ({
	browse: vi.fn(),
	search: vi.fn(),
	recommendStrategy: vi.fn(),
	similar: vi.fn(),
	strategies: vi.fn(),
	catalogInfo: vi.fn(),
	emitInteraction: vi.fn(),
}));

vi.mock("../api/client", () => ({
	browse: mocks.browse,
	search: mocks.search,
	recommendStrategy: mocks.recommendStrategy,
	similar: mocks.similar,
	strategies: mocks.strategies,
	catalogInfo: mocks.catalogInfo,
}));
vi.mock("../signals/emit", () => ({ emitInteraction: mocks.emitInteraction }));
// The live-metrics observer pokes real browser APIs; keep it a no-op here.
vi.mock("../metrics/observe", () => ({
	startMetricsObservers: () => () => {},
}));

import { Storefront } from "./Storefront";

function makeProduct(id: string, title: string): Product {
	return {
		id,
		title,
		description: "",
		category: "Office Products",
		subcategories: [],
		tags: [],
		brand: "Acme",
		price: 12,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		// A release-owned image_url makes ProductImage render an <img alt=title>; the
		// fallback tile would otherwise repeat the title as visible text and make
		// findByText ambiguous.
		image_url: `/test-assets/${id}.jpg`,
		url: "",
		attributes: {},
	};
}

function result(id: string, title: string): SearchResult {
	return {
		product: makeProduct(id, title),
		score: 0.9,
		score_components: null,
	};
}

const GRID = [
	makeProduct("G1", "Grid Gadget"),
	makeProduct("G2", "Grid Gizmo"),
];
const RAIL = [result("R1", "Rail Widget")];
const SEARCH_HIT = result("S1", "Lamp Deluxe");

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	mocks.strategies.mockReturnValue({} as Record<string, Strategy>);
	mocks.browse.mockResolvedValue({
		products: GRID,
		total: GRID.length,
		categories: ["Books", "Office"],
	});
	mocks.recommendStrategy.mockResolvedValue({
		results: RAIL,
		session_clicks: 0,
	});
	mocks.similar.mockResolvedValue({ results: [], session_clicks: 0 });
	mocks.search.mockResolvedValue({
		results: [SEARCH_HIT],
		query: "lamp",
		total: 1,
	});
	mocks.catalogInfo.mockResolvedValue({ count: 720 });
	mocks.emitInteraction.mockResolvedValue({ emitted: true, message: null });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Storefront mount", () => {
	it("renders the header search, the For-You rail and the catalog grid", async () => {
		render(<Storefront />);

		expect(screen.getByLabelText("Search products")).toBeInTheDocument();
		// Grid populated from browse().
		expect(await screen.findByText("Grid Gadget")).toBeInTheDocument();
		// Rail populated from recommendStrategy() — v1 bundle degrades to For You.
		expect(
			screen.getByRole("heading", { name: "Recommended for you" }),
		).toBeInTheDocument();
		expect(screen.getByText("Rail Widget")).toBeInTheDocument();
		expect(mocks.browse).toHaveBeenCalledWith({ limit: 24 });
	});
});

describe("Storefront product navigation", () => {
	it("opens the PDP on a product click and returns on Back", async () => {
		render(<Storefront />);
		const grid = await screen.findByText("Grid Gadget");
		await userEvent.click(
			grid.closest("article")?.querySelector("button") ?? grid,
		);

		// PDP hero + a seeded rail; the click was recorded as an engine signal.
		expect(
			await screen.findByRole("heading", { level: 1, name: "Grid Gadget" }),
		).toBeInTheDocument();
		expect(mocks.emitInteraction).toHaveBeenCalledWith(
			"click",
			expect.objectContaining({ id: "G1" }),
		);

		await userEvent.click(
			screen.getByRole("button", { name: /Back to browse/i }),
		);
		expect(await screen.findByText("Grid Gadget")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /Back to browse/i }),
		).not.toBeInTheDocument();
	});
});

describe("Storefront error handling", () => {
	it("surfaces a rail fetch failure through the error banner, not silently", async () => {
		// A real engine fault on the rails path (e.g. fail-closed malformed bundle)
		// must reach the user via the app's error surface — an empty rail with only
		// a console.warn is a silent degrade.
		mocks.recommendStrategy.mockRejectedValue(new Error("rail engine fault"));
		render(<Storefront />);

		expect(
			await screen.findByText("Couldn’t reach the engine"),
		).toBeInTheDocument();
		expect(screen.getByText("rail engine fault")).toBeInTheDocument();
		// The degrade is preserved: the grid still renders; one bad rail never
		// crashes the page.
		expect(await screen.findByText("Grid Gadget")).toBeInTheDocument();
	});

	it("recovers from a rail failure when Retry succeeds", async () => {
		mocks.recommendStrategy.mockRejectedValueOnce(
			new Error("rail engine fault"),
		);
		render(<Storefront />);
		expect(
			await screen.findByText("Couldn’t reach the engine"),
		).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByText("Rail Widget")).toBeInTheDocument();
		await waitFor(() =>
			expect(
				screen.queryByText("Couldn’t reach the engine"),
			).not.toBeInTheDocument(),
		);
	});

	it("shows an error banner and recovers when Retry succeeds", async () => {
		mocks.browse.mockRejectedValueOnce(new Error("engine offline"));
		render(<Storefront />);

		expect(
			await screen.findByText("Couldn’t reach the engine"),
		).toBeInTheDocument();
		expect(screen.getByText("engine offline")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByText("Grid Gadget")).toBeInTheDocument();
		expect(
			screen.queryByText("Couldn’t reach the engine"),
		).not.toBeInTheDocument();
	});
});

describe("Storefront category + search", () => {
	it("re-browses within a selected category", async () => {
		render(<Storefront />);
		await userEvent.click(await screen.findByRole("button", { name: "Books" }));
		await waitFor(() =>
			expect(mocks.browse).toHaveBeenCalledWith({
				limit: 24,
				category: "Books",
			}),
		);
	});

	it("clears the search box when a category is selected", async () => {
		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		const input = screen.getByLabelText("Search products");
		await userEvent.type(input, "abc");
		expect(input).toHaveValue("abc");

		await userEvent.click(screen.getByRole("button", { name: "Books" }));
		expect(input).toHaveValue("");
	});

	it("runs a hybrid search as the query settles", async () => {
		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		await userEvent.type(screen.getByLabelText("Search products"), "lamp");

		expect(await screen.findByText("Lamp Deluxe")).toBeInTheDocument();
		await waitFor(() =>
			expect(mocks.search).toHaveBeenCalledWith("lamp", { limit: 24 }),
		);
	});

	it("surfaces search results above the rails with a labelled cue", async () => {
		render(<Storefront />);
		// Browse view first: the rail sits above the grid before any query.
		await screen.findByText("Grid Gadget");
		await userEvent.type(screen.getByLabelText("Search products"), "lamp");

		// The matched product renders, surfaced beneath a labelled "Results for …"
		// cue that echoes the query.
		const hit = await screen.findByText("Lamp Deluxe");
		const cue = screen.getByText("Results for “lamp”");
		const rail = screen.getByRole("heading", { name: "Recommended for you" });
		expect(
			cue.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			hit.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		// Entering search pulled the freshly-surfaced results into view.
		expect(window.scrollTo).toHaveBeenCalled();
	});
});

describe("Storefront stale-search race (latest-wins)", () => {
	type SearchPayload = {
		results: SearchResult[];
		query: string;
		total: number;
	};

	it("drops a slow older query that resolves after a newer one", async () => {
		const resolvers = new Map<string, (r: SearchPayload) => void>();
		mocks.search.mockImplementation(
			(q: string) =>
				new Promise<SearchPayload>((resolve) => {
					resolvers.set(q, resolve);
				}),
		);

		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		const input = screen.getByLabelText("Search products");

		// The soon-to-be-stale query settles and goes in flight (still pending).
		await userEvent.type(input, "old");
		await waitFor(() => expect(resolvers.has("old")).toBe(true));

		// A newer query supersedes it before the older one resolves.
		await userEvent.clear(input);
		await userEvent.type(input, "new");
		await waitFor(() => expect(resolvers.has("new")).toBe(true));

		// The newer query resolves first and paints…
		resolvers.get("new")?.({
			results: [result("N1", "New Result")],
			query: "new",
			total: 1,
		});
		expect(await screen.findByText("New Result")).toBeInTheDocument();

		// …then the stale older query resolves LATE — it must not overwrite results.
		resolvers.get("old")?.({
			results: [result("O1", "Old Result")],
			query: "old",
			total: 1,
		});
		await waitFor(() =>
			expect(screen.queryByText("Old Result")).not.toBeInTheDocument(),
		);
		expect(screen.getByText("New Result")).toBeInTheDocument();
	});

	it("swallows a stale query that rejects after a newer one succeeds", async () => {
		const controls = new Map<
			string,
			{ resolve: (r: SearchPayload) => void; reject: (e: Error) => void }
		>();
		mocks.search.mockImplementation(
			(q: string) =>
				new Promise<SearchPayload>((resolve, reject) => {
					controls.set(q, { resolve, reject });
				}),
		);

		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		const input = screen.getByLabelText("Search products");

		await userEvent.type(input, "old");
		await waitFor(() => expect(controls.has("old")).toBe(true));
		await userEvent.clear(input);
		await userEvent.type(input, "new");
		await waitFor(() => expect(controls.has("new")).toBe(true));

		controls.get("new")?.resolve({
			results: [result("N1", "New Result")],
			query: "new",
			total: 1,
		});
		expect(await screen.findByText("New Result")).toBeInTheDocument();

		// The stale query fails LATE — a superseded failure is not the current view.
		controls.get("old")?.reject(new Error("stale engine error"));
		await waitFor(() =>
			expect(screen.queryByText("stale engine error")).not.toBeInTheDocument(),
		);
		expect(
			screen.queryByText("Couldn’t reach the engine"),
		).not.toBeInTheDocument();
		expect(screen.getByText("New Result")).toBeInTheDocument();
	});
});

describe("Storefront session signals", () => {
	it("increments the cart pill when a product is added to cart", async () => {
		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		const card = screen.getByText("Grid Gadget").closest("article");
		const cartButton = within(card as HTMLElement).getByRole("button", {
			name: "Add “Grid Gadget” to cart",
		});
		await userEvent.click(cartButton);

		// The cart pill (not the rail rank badge) reflects the running count.
		const pill = await screen.findByTitle(/added to cart this session/i);
		expect(pill).toHaveTextContent("1");
		expect(mocks.emitInteraction).toHaveBeenCalledWith(
			"cart",
			expect.objectContaining({ id: "G1" }),
		);
	});

	it("favorites a product in place without opening the PDP", async () => {
		render(<Storefront />);
		await screen.findByText("Grid Gadget");
		const card = screen.getByText("Grid Gadget").closest("article");
		await userEvent.click(
			within(card as HTMLElement).getByRole("button", {
				name: "Favorite “Grid Gadget”",
			}),
		);

		expect(
			await screen.findByRole("button", { name: "Unfavorite “Grid Gadget”" }),
		).toBeInTheDocument();
		// Still on the browse view — favoriting must not navigate.
		expect(
			screen.queryByRole("button", { name: /Back to browse/i }),
		).not.toBeInTheDocument();
		expect(mocks.emitInteraction).toHaveBeenCalledWith(
			"favorite",
			expect.objectContaining({ id: "G1" }),
		);
	});
});
