import { describe, expect, it } from "vitest";
import { functionSource, viewSource as readViewSource } from "./helpers/source-text";

const page = functionSource(readViewSource(), "renderOutputPage");
describe("output page", () => {
	it("keeps the user’s output queue accessible without fixed platform or operations panels", () => {
		expect(page).toContain("view.paths.outletFile");
		expect(page).toContain("d.output.queue");
		expect(page).toContain("fillSignalList(");
		expect(page).toContain('mountFlowPipeline(view, hero, d, "output")');
		for (const removed of ["platforms", "opsCandidates", "openPublishing", "fillOutputClosureChart"]) {
			expect(page).not.toContain(removed);
		}
	});
});
