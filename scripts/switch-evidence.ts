import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export const requiredOperations = [
  "read_context",
  "post_message",
  "send_targeted_message",
  "list_participants",
] as const;
export function schemaHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((v, k) => record(v)[k], value);
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export type Evidence = Record<string, unknown>;
export async function loadEvidence(
  root = resolve("tests/fixtures/switch"),
): Promise<Evidence> {
  const bundle: Evidence = {};
  for (const name of ["operations", "participants", "messages", "frames"])
    try {
      bundle[name] = JSON.parse(
        await readFile(resolve(root, `${name}.json`), "utf8"),
      );
    } catch {
      bundle[name] = null;
    }
  return bundle;
}
