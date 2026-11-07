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
export function assessEvidence(bundle: Evidence): Record<string, string[]> {
  const checks: Record<string, string[]> = {
    captures: [],
    release: [],
    operations: [],
    connection: [],
    participants: [],
    threadHandoffs: [],
    media: [],
    sourceIdentity: [],
  };
  const fail = (key: string, message: string) => checks[key]!.push(message);
  for (const name of ["operations", "participants", "messages", "frames"])
    if (
      at(bundle[name], "status") !== "live-reviewed" ||
      !at(bundle[name], "capture")
    )
      fail("captures", `${name}: missing reviewed live capture`);
  const release = at(bundle.operations, "capture", "release");
  if (
    at(release, "version") !== "0.31.0" ||
    at(release, "contracts", "agent-protocol", "speaks") !== 9 ||
    at(release, "contracts", "agent-protocol", "accepts") !== 1
  )
    fail(
      "release",
      "Installed release/protocol differs from the captured 0.31.0 / protocol 9 contract",
    );
  const operations = at(bundle.operations, "capture", "operations");
  for (const name of requiredOperations) {
    const schema = at(operations, name, "input_schema");
    if (
      at(schema, "type") !== "object" ||
      at(operations, name, "sha256") !== schemaHash(schema)
    )
      fail("operations", `${name}: missing schema or mismatched schema hash`);
  }
  for (const name of ["post_message", "send_targeted_message"])
    if (
      !(
        "thread_id" in
        record(at(operations, name, "input_schema", "properties"))
      )
    )
      fail("operations", `${name}: thread argument unavailable`);
  const first = at(bundle.frames, "capture", "firstConnection"),
    state = at(first, "data");
  const room = array(at(state, "rooms"))[0];
  if (
    at(first, "event") !== "connection_state" ||
    !Number.isSafeInteger(at(state, "cursor")) ||
    !Number.isSafeInteger(at(state, "generation")) ||
    at(state, "protocol") !== 9 ||
    typeof room !== "string"
  )
    fail("connection", "Missing valid authentic first connection state");
  for (const frame of array(at(bundle.frames, "capture", "capture")))
    if (["gap", "evicted", "refused"].includes(String(at(frame, "event"))))
      fail("connection", "Capture contains a stream gap, eviction or refusal");
  const participants = array(
    at(bundle.participants, "capture", "lookup", "result"),
  );
  for (const [name, kind] of [
    ["requester", "user"],
    ["feedback", "agent"],
    ["implementation-1", "agent"],
    ["app-feedback-f1-probe", "agent"],
  ])
    if (
      !participants.some(
        (p) =>
          at(p, "name") === name &&
          at(p, "type") === kind &&
          typeof at(p, "id") === "string",
      )
    )
      fail("participants", `${name}: explicit participant kind unavailable`);
  const ownership = array(at(bundle.participants, "capture", "ownership"));
  const service = ownership.find(
      (p) => at(p, "name") === "app-feedback-f1-probe",
    ),
    worker = ownership.find((p) => at(p, "name") === "implementation-1");
  if (
    !at(service, "owner_id") ||
    !at(worker, "owner_id") ||
    at(service, "owner_id") === at(worker, "owner_id")
  )
    fail("participants", "Independent service/worker owners not established");
  if (at(state, "agent_id") !== at(service, "id"))
    fail(
      "connection",
      "First connection is not the separately registered service",
    );
  const root = at(
    bundle.messages,
    "capture",
    "serviceRoot",
    "response",
    "result",
    "event_id",
  );
  const live = array(at(bundle.messages, "capture", "live"));
  for (const tag of ["F1-LIVE-FEEDBACK-001", "F1-LIVE-WORKER-001"])
    if (
      !live.some(
        (f) =>
          at(f, "event") === "message" &&
          at(f, "data", "room_id") === room &&
          at(f, "data", "payload", "thread_id") === root &&
          at(f, "data", "payload", "addressed") === true &&
          String(at(f, "data", "payload", "body")).includes(tag),
      )
    )
      fail(
        "threadHandoffs",
        `${tag}: same-room/thread addressed reply not captured`,
      );
  const threads = array(
    at(bundle.messages, "capture", "history", "result", "threads"),
  );
  const grouped = threads.find((t) =>
    String(at(t, "root", "body")).includes("TEST-006"),
  );
  if (
    array(at(grouped, "root", "attachments")).filter(
      (a) => at(a, "mimetype") === "image/png",
    ).length < 2
  )
    fail("media", "Missing genuine grouped screenshot history");
  if (
    !array(at(grouped, "replies")).some((r) =>
      String(at(r, "body")).includes("Received TEST-006"),
    )
  )
    fail("media", "Missing captured screenshot-reading response");
  // UUID directory rows cannot classify opaque stream senders. No name/prefix inference.
  const bindings = array(at(bundle.participants, "capture", "senderBindings"));
  const source = threads.find((t) =>
    String(at(t, "root", "body")).includes("Connection test TEST-001"),
  );
  const sender = at(source, "root", "sender");
  const bound = bindings.some(
    (b) =>
      at(b, "sender") === sender &&
      at(b, "kind") === "user" &&
      at(b, "participantId") ===
        at(
          participants.find((p) => at(p, "name") === "requester"),
          "id",
        ) &&
      at(b, "provenance") === "authenticated-source-lookup",
  );
  const direct = at(source, "root", "sender_kind") === "user";
  if (!direct && !bound)
    fail(
      "sourceIdentity",
      "SOURCE_IDENTITY_UNRESOLVED: opaque event/history senders have null/absent kind; directory UUIDs do not provide a sender binding",
    );
  return checks;
}
export async function checkEvidence(root?: string): Promise<string[]> {
  return Object.values(assessEvidence(await loadEvidence(root))).flat();
}
