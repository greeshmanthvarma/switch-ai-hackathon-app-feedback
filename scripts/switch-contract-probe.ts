import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkEvidence } from "./switch-evidence.js";
import {
  captureService,
  inspectService,
  ProbeFailure,
  validateProfile,
} from "./switch-connection-probe.js";
async function main() {
  const args = process.argv.slice(2),
    mode = args[0];
  if (mode === "--check" && args.length === 1) {
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
  if (!["--inspect", "--capture"].includes(mode ?? ""))
    throw new ProbeFailure(
      "Use --check, --inspect, or --capture --room UUID --seconds N.",
    );
  let profile;
  if (
    process.env.SWITCH_PROBE_SERVICE_ID ||
    process.env.SWITCH_PROBE_SERVICE_KEY
  )
    profile = validateProfile({
      server: process.env.SWITCH_PROBE_BASE_URL,
      id: process.env.SWITCH_PROBE_SERVICE_ID,
      api_key: process.env.SWITCH_PROBE_SERVICE_KEY,
      identityKind: process.env.SWITCH_PROBE_IDENTITY_KIND,
    });
  else
    profile = validateProfile(
      JSON.parse(
        await readFile(resolve(".local/switch-probe/service.json"), "utf8"),
      ),
    );
  if (mode === "--inspect") {
    if (args.length !== 1)
      throw new ProbeFailure("Unexpected inspection arguments.");
    const discovered = await inspectService(profile);
    await mkdir(".local/switch-probe", { recursive: true, mode: 0o700 });
    await writeFile(
      ".local/switch-probe/discovery.json",
      JSON.stringify(discovered, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      JSON.stringify({
        discovery: "saved privately",
        schemaHashes: discovered.hashes,
        gate: "BLOCKED",
        reason:
          "Run the independent evidence check; discovery alone is insufficient.",
      }),
    );
  } else {
    if (args.length !== 5 || args[1] !== "--room" || args[3] !== "--seconds")
      throw new ProbeFailure("Use --capture --room UUID --seconds N.");
    const output = await captureService(profile, args[2]!, Number(args[4]));
    console.log(
      JSON.stringify({
        capture: output,
        gate: "NOT_EVALUATED",
        note: "Private wire capture; sanitize/review before fixture promotion.",
      }),
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof ProbeFailure
      ? error.message
      : "Probe stopped; credentials and remote response bodies withheld.",
  );
  process.exitCode = 1;
});
