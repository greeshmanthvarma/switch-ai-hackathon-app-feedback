import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import WebSocket from "ws";
import {
  inspectService,
  validateFirstState,
  validateProfile,
} from "./switch-connection-probe.js";
import { openDemo, type Request } from "./demo-store.js";
import { sendFeedbackHandoff } from "./demo-handoff.js";
import { privateGithubTracker } from "./demo-tracker.js";
import {
  array,
  at,
  loadEvidence,
  requiredOperations,
} from "./switch-evidence.js";

const worker = "implementation-1";
const service = "app-feedback-f1-probe";

function printable(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function main() {
  const [mode, room, ...extra] = process.argv.slice(2);
  if (
    !room ||
    (extra.length !== 0 &&
      !(extra.length === 2 && extra[0] === "--tracker" && extra[1])) ||
    !["--check", "--live"].includes(mode ?? "") ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(room)
  ) {
    console.error(
      "Usage: npm run demo:flow -- --check|--live <Switch room UUID> [--tracker OWNER/REPO]",
    );
    process.exitCode = 2;
    return;
  }
  if (mode === "--live" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error("Live approvals require a local interactive terminal.");
    process.exitCode = 2;
    return;
  }
  const tracker = extra[1] ? await privateGithubTracker(extra[1]) : null;
  const directory = resolve(".local/switch-probe");
  const profile = validateProfile(
    JSON.parse(await readFile(resolve(directory, "service.json"), "utf8")),
  );
  const discovery = await inspectService(profile);
  const evidence = await loadEvidence();
  if (
    at(discovery.version, "version") !== "0.31.0" ||
    at(discovery.version, "contracts", "agent-protocol", "speaks") !== 9 ||
    requiredOperations.some(
      (op) =>
        discovery.hashes[op] !==
        at(evidence.operations, "capture", "operations", op, "sha256"),
    )
  )
    throw new Error("Switch release or operation schema changed.");

  await mkdir(".local/demo", { recursive: true, mode: 0o700 });
  // Same lock as the F1 probe, so the two clients never contend for the service room.
  const lockPath = resolve(directory, "capture.lock");
  const lock = await open(lockPath, "wx", 0o600);
  let socket: WebSocket | undefined;
  let demo: ReturnType<typeof openDemo> | undefined;
  let terminal: ReturnType<typeof createInterface> | undefined;
  try {
    const connection = randomUUID();
    const url = new URL(
      `/agents/${encodeURIComponent(profile.id)}/connection/ws`,
      profile.server,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({
      connection_id: connection,
      rooms: room,
      scope: "single",
      filter: "all",
      start_from: "head",
      protocol: "9",
      protocol_accepts: "9",
      client: "app-feedback-demo",
    }).toString();
    async function operation(name: string, body: object): Promise<unknown> {
      const response = await fetch(
        new URL(
          `/agents/${encodeURIComponent(profile.id)}/ops/${name}`,
          profile.server,
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${profile.api_key}`,
            "Content-Type": "application/json",
            "X-Switch-Connection-Id": connection,
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        throw new Error(`Switch ${name} returned HTTP ${response.status}.`);
      return at(await response.json(), "result");
    }
    let ready = false,
      cursor = 0,
      accepting = false;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${profile.api_key}` },
      handshakeTimeout: 5000,
      maxPayload: 1_048_576,
    });
    socket = ws;
    function reportPending(report: Request) {
      console.log(
        `\nPending ${report.id} rev ${report.revision}: ${printable(report.body)}`,
      );
    }
    function observe(frame: unknown) {
      const report = demo?.receive(frame);
      if (report) reportPending(report);
      const payload = at(frame, "data", "payload");
      const body = at(payload, "body");
      if (
        at(frame, "event") === "message" &&
        at(frame, "data", "room_id") === room &&
        typeof body === "string" &&
        /DEMO-HANDOFF-(?:REQUEST|WORKER-RESULT|RESULT) /.test(body) &&
        demo
          ?.list()
          .some(
            (r) =>
              ["dispatching", "dispatched"].includes(r.state) &&
              at(payload, "thread_id") === r.thread &&
              body.includes(`${r.id} revision ${r.revision}`),
          )
      ) {
        console.log(
          `\nThread activity for operator review (sender label not verified): ${printable(at(payload, "sender_name") ?? "")} ${printable(body.slice(0, 1000))}`,
        );
      }
    }
    const connected = new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => {
        fail(new Error("Switch connection did not become ready."));
        ws.terminate();
      }, 8000);
      const queued: unknown[] = [];
      ws.on("message", (data) => {
        try {
          const frame: unknown = JSON.parse(data.toString());
          const event = at(frame, "event");
          if (!ready) {
            cursor = validateFirstState(frame, profile.id, room!);
            if (at(frame, "data", "connection_id") !== connection)
              throw new Error("Wrong connection.");
            ready = true;
            clearTimeout(timer);
            ok();
            return;
          }
          if (event === "ping") {
            ws.send(JSON.stringify({ type: "pong", cursor }));
            return;
          }
          if (["gap", "refused", "evicted"].includes(String(event)))
            throw new Error("Switch stream interrupted.");
          if (event === "message") {
            if (accepting) observe(frame);
            else if (queued.length < 100) queued.push(frame);
            else throw new Error("Startup buffer full.");
          }
          if (Number.isSafeInteger(at(frame, "id")))
            cursor = Math.max(cursor, at(frame, "id") as number);
        } catch {
          process.exitCode = 1;
          fail(new Error("Switch connection stopped on an invalid frame."));
          ws.terminate();
        }
      });
      ws.on("error", () => {
        fail(new Error("Switch connection failed."));
        ws.terminate();
      });
      ws.on("close", () => {
        clearTimeout(timer);
        if (!ready)
          fail(new Error("Switch closed before first connection state."));
        terminal?.close();
        if (accepting)
          console.log(
            "Switch disconnected. Restart to resume intake; dispatches are never retried automatically.",
          );
      });
      function flush() {
        accepting = true;
        for (const frame of queued) observe(frame);
        queued.length = 0;
      }
      startIntake = flush;
    });
    await connected;
    const participants = array(await operation("list_participants", {}));
    for (const name of ["feedback", worker, service]) {
      const matches = participants.filter(
        (p) => at(p, "type") === "agent" && at(p, "name") === name,
      );
      if (
        matches.length !== 1 ||
        (name === service && at(matches[0], "id") !== profile.id)
      )
        throw new Error(
          `Expected one registered ${name} in the selected room.`,
        );
    }
    if (mode === "--check") {
      if (tracker)
        console.log(`Private tracker verified: ${tracker.repository}`);
      console.log(
        `Live Switch check passed: service connected to ${room}; feedback and ${worker} are in the room. No messages sent.`,
      );
      return;
    }
    const send = async (request: Request) => {
      if (ws.readyState !== WebSocket.OPEN)
        throw new Error("Switch is disconnected.");
      return sendFeedbackHandoff(
        operation,
        request,
        worker,
        demo?.issueFor(request.id)?.url,
      );
    };
    demo = openDemo(resolve(".local/demo/requests.sqlite"), room, send);
    // Re-read only the bounded current room history. No historical message can approve anything.
    const history = await operation("read_context", { limit: 100 });
    for (const thread of array(at(history, "threads")).reverse()) {
      const root = at(thread, "root");
      if (at(root, "kind") !== "message") continue;
      observe({
        event: "message",
        data: {
          room_id: room,
          payload: {
            message_id: at(root, "id"),
            thread_id: null,
            body: at(root, "body"),
            sender_kind: at(root, "sender_kind"),
            on_behalf_of: at(root, "on_behalf_of"),
            attachments: at(root, "attachments"),
          },
        },
      });
    }
    if (ws.readyState !== WebSocket.OPEN)
      throw new Error("Switch disconnected during startup.");
    startIntake();
    console.log(
      "Listening for @feedback report: <text>. Feedback hands off a node --version test to the worker.",
    );
    console.log(
      "Local commands: list | show <id> | queue-history <thread-id> | track <id> | approve <id> <revision> | release <id> | quit",
    );
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const onInterrupt = () => terminal?.close();
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    try {
      for await (const line of terminal) {
        const [verb, id, rev, ...rest] = line.trim().split(/\s+/);
        if (verb === "quit") break;
        if (verb === "list") {
          for (const r of demo.list())
            console.log(
              `${r.id}  rev ${r.revision}  ${r.state}  ${printable(r.body.slice(0, 100))}`,
            );
        } else if (verb === "queue-history" && id && !rev) {
          try {
            const history = await operation("read_context", { limit: 100 });
            const thread = array(at(history, "threads")).find(
              (t) => at(t, "root", "id") === id,
            );
            const r = thread ? demo.queueHistoryRoot(at(thread, "root")) : null;
            if (r) reportPending(r);
            else
              console.log(
                "No eligible unqueued root in the latest room history.",
              );
          } catch {
            console.log("Unable to read authenticated room history.");
          }
        } else if (verb === "track" && id && !rev) {
          try {
            if (!tracker) {
              console.log("No tracker is configured.");
              continue;
            }
            console.log(`GitHub issue: ${(await demo.track(id, tracker)).url}`);
          } catch (error) {
            console.log(
              error instanceof Error ? error.message : "Tracking failed.",
            );
          }
        } else if (verb === "show" && id) {
          const request = demo.list().find((r) => r.id === id);
          console.log(
            request
              ? printable({ ...request, issue: demo.issueFor(id) })
              : "Unknown request.",
          );
        } else if (
          verb === "approve" &&
          id &&
          /^[1-9]\d*$/.test(rev ?? "") &&
          !rest.length
        ) {
          if (ws.readyState !== WebSocket.OPEN) {
            console.log("Switch is disconnected; nothing approved.");
            continue;
          }
          try {
            if (tracker && !demo.issueFor(id)) {
              console.log("Track this request explicitly before approving it.");
              continue;
            }
            const r = await demo.approve(id, Number(rev));
            console.log(
              `Sent to feedback for handoff: ${r.id}, Switch receipt ${r.workerMessage}`,
            );
          } catch (e) {
            console.log(e instanceof Error ? e.message : "Approval failed.");
          }
        } else if (verb === "release" && id && !rev) {
          console.log(
            demo.release(id)
              ? "Released. No automatic retry or PR action."
              : "No active dispatch to release.",
          );
        } else if (verb)
          console.log(
            "Use list, show, queue-history, track, approve, release, or quit.",
          );
      }
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
    }
  } finally {
    terminal?.close();
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const ws = socket;
      await new Promise<void>((done) => {
        const timer = setTimeout(() => ws.terminate(), 1000);
        ws.once("close", () => {
          clearTimeout(timer);
          done();
        });
        ws.close();
      });
    }
    demo?.close();
    await lock.close();
    await unlink(lockPath);
  }
}

let startIntake: () => void;
main().catch(() => {
  console.error(
    "Demo could not start or lost its Switch connection. Check the local server, service profile, selected room, and probe lock.",
  );
  process.exitCode = 1;
});
