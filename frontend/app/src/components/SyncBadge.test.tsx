import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the uplink boundary so the badge's copy can be driven without a real
// beacon: `enabled` flips the two modes, and `onSynced` hands us the callback
// the badge subscribes with (the absolute cumulative count).
const { uplinkEnabled, onUplinkSynced } = vi.hoisted(() => ({
	uplinkEnabled: vi.fn(),
	onUplinkSynced: vi.fn(),
}));
vi.mock("../telemetry/uplink", () => ({ uplinkEnabled, onUplinkSynced }));

import { SyncBadge } from "./SyncBadge";

afterEach(cleanup);
beforeEach(() => {
	uplinkEnabled.mockReset();
	onUplinkSynced.mockReset();
});

describe("SyncBadge", () => {
	it("states everything runs on-device when the uplink is disabled", () => {
		uplinkEnabled.mockReturnValue(false);
		render(<SyncBadge />);
		expect(
			screen.getByText(/Running fully on-device · no uplink/i),
		).toBeInTheDocument();
		// Disabled mode never subscribes.
		expect(onUplinkSynced).not.toHaveBeenCalled();
	});

	it("shows the armed copy before anything has synced", () => {
		uplinkEnabled.mockReturnValue(true);
		render(<SyncBadge />);
		expect(
			screen.getByText(/Flywheel uplink armed · interactions sync to cloud/i),
		).toBeInTheDocument();
	});

	it("reflects the cumulative synced count, pluralized", () => {
		uplinkEnabled.mockReturnValue(true);
		let push: ((total: number) => void) | undefined;
		onUplinkSynced.mockImplementation((cb: (total: number) => void) => {
			push = cb;
		});
		render(<SyncBadge />);

		act(() => push?.(1));
		expect(
			screen.getByText("1 interaction synced to cloud"),
		).toBeInTheDocument();

		act(() => push?.(4));
		expect(
			screen.getByText("4 interactions synced to cloud"),
		).toBeInTheDocument();
	});
});
