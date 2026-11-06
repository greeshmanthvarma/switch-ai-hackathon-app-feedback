import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  checkEvidence,
  requiredOperations,
  schemaHash,
} from "./switch-evidence.js";

async function main() {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !["--check", "--inspect"].includes(mode[0]!))
    throw new Error(
      "Use --check (offline gate) or --inspect (read-only health/version/operation discovery).",
    );
  if (mode[0] === "--check") {
    const blockers = await checkEvidence();
    console.log(
      JSON.stringify(
        { gate: blockers.length ? "BLOCKED" : "PASS", blockers },
        null,
        2,
      ),
    );
    process.exitCode = blockers.length ? 1 : 0;
    return;
  }
  const raw = process.env.SWITCH_PROBE_BASE_URL;
  if (!raw)
    throw new Error(
      "Set SWITCH_PROBE_BASE_URL to the operator-selected server.",
    );
  const base = new URL(raw);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("Base URL must be an origin without credentials.");
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
    )
  )
    throw new Error("Use HTTPS except on loopback.");
  async function get(path: string, token?: string): Promise<unknown> {
    const response = await fetch(new URL(path, base), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(`Probe HTTP ${response.status}; response body withheld.`);
    const body = await response.text();
    if (body.length > 2_000_000)
      throw new Error("Probe response exceeds limit.");
    return JSON.parse(body);
  }
  const health = await get("/health");
  console.log(JSON.stringify({ healthReachable: !!health }));
  const id = process.env.SWITCH_PROBE_SERVICE_ID;
  const key = process.env.SWITCH_PROBE_SERVICE_KEY;
  if (!id || !key)
    throw new Error(
      "Authenticated inspection blocked: separate service identity/key not configured. Never use Console-managed credentials.",
    );
  if (process.env.SWITCH_PROBE_IDENTITY_KIND !== "separate-unmanaged-service")
    throw new Error(
      "Explicit separate-unmanaged-service identity attestation required.",
    );
  const version = await get("/version", key);
  const registry = (await get(
    `/agents/${encodeURIComponent(id)}/ops`,
    key,
  )) as { operations?: Record<string, { input_schema?: unknown }> };
  if (!registry.operations)
    throw new Error(
      "Unexpected registry shape; inspect installed contract privately.",
    );
  const hashes: Record<string, string> = {};
  for (const name of requiredOperations) {
    const schema = registry.operations[name]?.input_schema;
    if (!schema || typeof schema !== "object")
      throw new Error(`Required schema unavailable: ${name}`);
    hashes[name] = schemaHash(schema);
  }
  // Raw authenticated responses stay private; do not automatically promote them to fixtures.
  await mkdir(".local/switch-probe", { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(".local/switch-probe/discovery.json"),
    JSON.stringify({ version, operations: registry.operations }, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      discovery: "saved privately for review",
      schemaHashes: hashes,
      gate: "BLOCKED",
      reason: "Live identity/thread/handoff/media proof still required",
    }),
  );
}
main().catch(() => {
  console.error(
    "Switch probe stopped. Check selected origin, service identity, authorization, and local evidence; remote bodies and credentials are withheld.",
  );
  process.exitCode = 1;
});
