import fs from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import WebSocket from "ws";
import {
  at,
  record,
  requiredOperations,
  schemaHash,
} from "./switch-evidence.js";
import { serverOrigin } from "./switch-service-registration.js";
export type ServiceProfile = {
  server: string;
  id: string;
  api_key: string;
  identityKind: string;
};
export class ProbeFailure extends Error {}
export function validateProfile(value: unknown): ServiceProfile {
  const v = record(value);
  if (
    typeof v.server !== "string" ||
    typeof v.id !== "string" ||
    !v.id ||
    typeof v.api_key !== "string" ||
    !v.api_key ||
    v.identityKind !== "separate-unmanaged-service"
  )
    throw new ProbeFailure("Invalid separate-service profile.");
  serverOrigin(v.server);
  return v as ServiceProfile;
}
export async function serviceGet(
  profile: ServiceProfile,
  path: string,
): Promise<unknown> {
  const response = await fetch(new URL(path, profile.server), {
    headers: { Authorization: `Bearer ${profile.api_key}` },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new ProbeFailure(
      `Read-only discovery HTTP ${response.status}; body withheld.`,
    );
  const text = await response.text();
  if (text.length > 2_000_000)
    throw new ProbeFailure("Discovery response exceeds limit.");
  return JSON.parse(text);
}
export async function inspectService(profile: ServiceProfile): Promise<{
  version: unknown;
  registry: unknown;
  hashes: Record<string, string>;
}> {
  // Refuse coding-agent profiles even if someone relabels the private profile.
  const response = await fetch(
    new URL(
      `/agents/${encodeURIComponent(profile.id)}/ops/get_agent_detail`,
      profile.server,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agent_id: profile.id }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new ProbeFailure(`Service identity lookup HTTP ${response.status}.`);
  const identity = at(await response.json(), "result");
  if (
    at(identity, "id") !== profile.id ||
    at(identity, "connector_type") !== "app-feedback-service" ||
    at(identity, "known_agent_type") !== null
  )
    throw new ProbeFailure("Refusing a managed or unrelated agent profile.");
  const version = await serviceGet(profile, "/version");
  const registry = await serviceGet(
    profile,
    `/agents/${encodeURIComponent(profile.id)}/ops`,
  );
  const hashes: Record<string, string> = {};
  for (const name of requiredOperations) {
    const schema = at(registry, "operations", name, "input_schema");
    if (at(schema, "type") !== "object")
      throw new ProbeFailure(`Required operation schema missing: ${name}`);
    hashes[name] = schemaHash(schema);
  }
  return { version, registry, hashes };
}
export function validateFirstState(
  frame: unknown,
  serviceId: string,
  roomId: string,
): number {
  const state = at(frame, "data");
  if (
    at(frame, "event") !== "connection_state" ||
    at(state, "agent_id") !== serviceId ||
    !Array.isArray(at(state, "rooms")) ||
    !(at(state, "rooms") as unknown[]).includes(roomId) ||
    !Number.isSafeInteger(at(state, "cursor")) ||
    !Number.isSafeInteger(at(state, "generation"))
  )
    throw new ProbeFailure("Invalid initial connection state.");
  return at(state, "cursor") as number;
}
export async function captureService(
  profile: ServiceProfile,
  roomId: string,
  seconds: number,
  directory = resolve(".local/switch-probe"),
): Promise<string> {
  if (
    !/^[0-9a-f-]{36}$/i.test(roomId) ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 120
  )
    throw new ProbeFailure(
      "Capture needs an explicit room UUID and 1–120 seconds.",
    );
  const discovery = await inspectService(profile);
  if (
    at(discovery.version, "version") !== "0.31.0" ||
    at(discovery.version, "contracts", "agent-protocol", "speaks") !== 9
  )
    throw new ProbeFailure(
      "Capture requires the verified release/protocol; review changed schemas first.",
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = resolve(directory, "capture.lock");
  const lock = await open(lockPath, "wx", 0o600);
  const runId = randomUUID(),
    connectionId = randomUUID();
  let fd: number | undefined;
  try {
    const output = resolve(directory, `capture-${runId}.jsonl`);
    fd = fs.openSync(output, "wx", 0o600);
    const url = new URL(
      `/agents/${encodeURIComponent(profile.id)}/connection/ws`,
      profile.server,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    for (const [k, v] of Object.entries({
      connection_id: connectionId,
      rooms: roomId,
      scope: "single",
      filter: "all",
      start_from: "head",
      protocol: "9",
      protocol_accepts: "9",
      client: "app-feedback-f1-probe",
      client_version: "0.0.0",
    }))
      url.searchParams.set(k, v);
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${profile.api_key}` },
      handshakeTimeout: 5000,
      maxPayload: 1048576,
    });
    let cursor = 0,
      first = true,
      bytes = 0,
      count = 0;
    let failure: Error | undefined;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        if (first) failure = new ProbeFailure("No connection state received.");
        ws.close();
      }, seconds * 1000);
      ws.on("message", (raw) => {
        try {
          const frame: unknown = JSON.parse(raw.toString());
          if (first) {
            cursor = validateFirstState(frame, profile.id, roomId);
            first = false;
          }
          if (at(frame, "event") === "ping") {
            ws.send(JSON.stringify({ type: "pong", cursor }));
            return;
          }
          if (
            at(frame, "event") === "message" &&
            at(frame, "data", "room_id") !== roomId
          )
            throw new ProbeFailure("Unexpected room on single-room capture.");
          const line = JSON.stringify(frame) + "\n";
          bytes += Buffer.byteLength(line);
          count++;
          if (bytes > 5_000_000 || count > 256)
            throw new ProbeFailure("Capture limit reached.");
          fs.writeSync(fd!, line);
          fs.fsyncSync(fd!);
          if (typeof at(frame, "id") === "number")
            cursor = at(frame, "id") as number;
          if (
            ["gap", "evicted", "refused"].includes(String(at(frame, "event")))
          )
            throw new ProbeFailure(
              "Stream gap/refusal/eviction: capture stopped without reconnecting.",
            );
        } catch {
          failure = new ProbeFailure(
            "Invalid frame or interrupted stream; private capture retained.",
          );
          ws.close();
        }
      });
      ws.on("error", () => {
        failure = new ProbeFailure("Socket failed; remote details withheld.");
        ws.terminate();
      });
      ws.on("close", () => {
        clearTimeout(timer);
        done();
      });
    });
    if (failure) throw failure;
    return output;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    await lock.close();
    await unlink(lockPath);
  }
}
