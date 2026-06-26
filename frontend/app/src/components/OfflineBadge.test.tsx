import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBadge } from "./OfflineBadge";

function setOnline(value: boolean) {
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
	act(() => {
		window.dispatchEvent(new Event(value ? "online" : "offline"));
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("OfflineBadge", () => {
	it("renders nothing while online", () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		const { container } = render(<OfflineBadge />);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows the on-device message when the browser goes offline", () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		render(<OfflineBadge />);
		setOnline(false);
		expect(
			screen.getByText("Offline — running fully on your device"),
		).toBeInTheDocument();
	});

	it("hides again when connectivity returns", () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		render(<OfflineBadge />);
		expect(screen.getByText(/Offline/)).toBeInTheDocument();
		setOnline(true);
		expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
	});
});
