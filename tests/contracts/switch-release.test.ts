import { test, expect } from "vitest";
import { assessEvidence, loadEvidence } from "../../scripts/switch-evidence.js";
const checks = assessEvidence(await loadEvidence());
for (const [name, errors] of Object.entries(checks))
  test(`released Switch contract: ${name}`, () => {
    expect(errors).toEqual([]);
  });
