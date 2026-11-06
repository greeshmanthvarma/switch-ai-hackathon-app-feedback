import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEvidence, schemaHash } from "../../scripts/switch-evidence.js";
test("schema hashes ignore object key order but preserve array order", () => {
  expect(schemaHash({ b: 2, a: 1 })).toBe(schemaHash({ a: 1, b: 2 }));
  expect(schemaHash([1, 2])).not.toBe(schemaHash([2, 1]));
});
test("missing, malformed, and fabricated reviewed flags cannot pass the gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "switch-f1-"));
  try {
    expect(await checkEvidence(root)).toHaveLength(4);
    for (const name of ["operations", "participants", "messages", "frames"])
      await writeFile(
        join(root, `${name}.json`),
        JSON.stringify({ status: "live-reviewed", capture: {} }),
      );
    expect(await checkEvidence(root)).toHaveLength(4);
    await writeFile(join(root, "frames.json"), "{");
    expect(await checkEvidence(root)).toContain(
      "frames: missing or invalid capture",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
