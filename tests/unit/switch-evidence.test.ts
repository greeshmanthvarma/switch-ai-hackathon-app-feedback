import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessEvidence,
  loadEvidence,
  checkEvidence,
  schemaHash,
} from "../../scripts/switch-evidence.js";
test("schema hashes ignore object key order but preserve array order", () => {
  expect(schemaHash({ b: 2, a: 1 })).toBe(schemaHash({ a: 1, b: 2 }));
  expect(schemaHash([1, 2])).not.toBe(schemaHash([2, 1]));
});
test("missing, malformed and manually set reviewed flags cannot manufacture a contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "switch-f1-"));
  try {
    expect(
      (await checkEvidence(root)).some((x) => x.includes("missing reviewed")),
    ).toBe(true);
    for (const name of ["operations", "participants", "messages", "frames"])
      await writeFile(
        join(root, `${name}.json`),
        JSON.stringify({ status: "live-reviewed", capture: {} }),
      );
    expect((await checkEvidence(root)).length).toBeGreaterThan(0);
    await writeFile(join(root, "frames.json"), "{");
    expect(await checkEvidence(root)).toContain(
      "frames: missing reviewed live capture",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("captured directory UUIDs and display names do not authorize opaque source senders", async () => {
  const checks = assessEvidence(await loadEvidence());
  expect(checks.sourceIdentity?.join()).toContain("SOURCE_IDENTITY_UNRESOLVED");
});
test("tampered operation schemas and replies in a different thread fail validation", async () => {
  const value = await loadEvidence();
  const text = JSON.stringify(value).replace(
    "sw_dbee19dfb9d9462d82667358f4af840a",
    "wrong-root",
  );
  expect(
    assessEvidence(JSON.parse(text)).threadHandoffs?.length,
  ).toBeGreaterThan(0);
  const tampered = JSON.parse(
    JSON.stringify(value).replace('"sha256":"', '"sha256":"tampered-'),
  );
  expect(assessEvidence(tampered).operations?.length).toBeGreaterThan(0);
});
