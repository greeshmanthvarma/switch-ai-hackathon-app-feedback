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
export async function checkEvidence(
  root = resolve("tests/fixtures/switch"),
): Promise<string[]> {
  const errors: string[] = [];
  for (const name of ["operations", "participants", "messages", "frames"]) {
    try {
      const file = JSON.parse(
        await readFile(resolve(root, `${name}.json`), "utf8"),
      );
      if (file.status !== "live-reviewed" || !file.capture)
        errors.push(`${name}: missing reviewed live capture`);
      else
        errors.push(
          `${name}: adapter mapping not yet implemented against actual release; manual flags cannot pass F1`,
        );
    } catch {
      errors.push(`${name}: missing or invalid capture`);
    }
  }
  // Deliberately fail closed until actual wire schemas and source mappings are available.
  return errors;
}
