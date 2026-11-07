import { test, expect } from "vitest";
import { schemaHash } from "../../scripts/switch-evidence.js";

test("schema hashes ignore object key order but preserve array order", () => {
  expect(schemaHash({ b: 2, a: 1 })).toBe(schemaHash({ a: 1, b: 2 }));
  expect(schemaHash([1, 2])).not.toBe(schemaHash([2, 1]));
});
