import { describe, it, expect } from "vitest";
import type { SessionEstimate } from "./memApi";

describe("SessionEstimate type", () => {
	it("has correct shape", () => {
		const data: SessionEstimate = {
			due_count: 25,
			retention: 0.82,
			total_estimate: 31,
		};
		expect(data.due_count).toBe(25);
		expect(data.retention).toBeCloseTo(0.82);
		expect(data.total_estimate).toBe(31);
	});

	it("total_estimate is at least due_count", () => {
		// retention = 1.0 → total_estimate = due_count
		const data: SessionEstimate = {
			due_count: 10,
			retention: 1.0,
			total_estimate: 10,
		};
		expect(data.total_estimate).toBeGreaterThanOrEqual(data.due_count);
	});

	it("retention is between 0 and 1", () => {
		const data: SessionEstimate = {
			due_count: 5,
			retention: 0.0,
			total_estimate: 7,
		};
		expect(data.retention).toBeGreaterThanOrEqual(0);
		expect(data.retention).toBeLessThanOrEqual(1);
	});

	it("progress percentage calculation", () => {
		// sessionReviewed / total_estimate * 100
		const estimate: SessionEstimate = {
			due_count: 20,
			retention: 0.8,
			total_estimate: 25,
		};
		const reviewed = 10;
		const progress = Math.min((reviewed / estimate.total_estimate) * 100, 100);
		expect(progress).toBe(40);
	});

	it("progress caps at 100%", () => {
		const estimate: SessionEstimate = {
			due_count: 10,
			retention: 0.5,
			total_estimate: 20,
		};
		const reviewed = 25; // 超过预估
		const progress = Math.min((reviewed / estimate.total_estimate) * 100, 100);
		expect(progress).toBe(100);
	});
});
