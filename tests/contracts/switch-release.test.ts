import { test, expect } from "vitest";
import { checkEvidence } from "../../scripts/switch-evidence.js";
test("F1 requires actual reviewed live captures, never synthetic success fixtures", async () => {
  expect(await checkEvidence()).toEqual([]);
});
