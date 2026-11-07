import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { array, at } from "./switch-evidence.js";
import type { Issue, Tracker } from "./demo-tracker.js";

export type Request = {
  id: string;
  thread: string;
  body: string;
  revision: number;
  state: "pending" | "dispatching" | "dispatched" | "uncertain" | "done";
  workerMessage: string | null;
  attachments: string;
};

const columns =
  "id, thread, body, revision, state, worker_message AS workerMessage, attachments";

export function openDemo(
  path: string,
  room: string,
  dispatch: (request: Request) => Promise<string>,
) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, room TEXT NOT NULL, thread TEXT NOT NULL,
      body TEXT NOT NULL, attachments TEXT NOT NULL, revision INTEGER NOT NULL,
      state TEXT NOT NULL, worker_message TEXT, approved_at TEXT,
      UNIQUE (room, thread)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS demo_worker_claim ON requests ((1))
      WHERE state IN ('dispatching', 'dispatched', 'uncertain');
    CREATE TABLE IF NOT EXISTS issue_projections (
      request_id TEXT PRIMARY KEY REFERENCES requests(id),
      repository TEXT NOT NULL, state TEXT NOT NULL,
      number INTEGER, url TEXT
    );`);
  const list = () =>
    db
      .prepare(`SELECT ${columns} FROM requests WHERE room = ? ORDER BY rowid`)
      .all(room) as Request[];

  function persist(thread: string, report: string, p: unknown): Request | null {
    const attachments = array(at(p, "attachments"))
      .filter((a) =>
        ["image/png", "image/jpeg", "image/webp"].includes(
          String(at(a, "mimetype")),
        ),
      )
      .slice(0, 5)
      .map((a) => ({
        name: String(at(a, "filename") ?? "").slice(0, 256),
        type: at(a, "mimetype"),
        reference: String(at(a, "mxc") ?? "").slice(0, 512),
      }));
    return (
      (db
        .prepare(
          `INSERT INTO requests (id, room, thread, body, attachments, revision, state)
        VALUES (?, ?, ?, ?, ?, 1, 'pending') ON CONFLICT(room,thread) DO NOTHING RETURNING ${columns}`,
        )
        .get(
          randomUUID(),
          room,
          thread,
          report,
          JSON.stringify(attachments),
        ) as Request | undefined) ?? null
    );
  }

  function issueFor(id: string): Issue | null {
    return (
      (db
        .prepare(
          `SELECT i.number, i.url FROM issue_projections i
      JOIN requests r ON r.id = i.request_id
      WHERE r.room = ? AND r.id = ? AND i.state = 'linked'`,
        )
        .get(room, id) as Issue | undefined) ?? null
    );
  }

  return {
    list,
    issueFor,
    async track(id: string, tracker: Tracker): Promise<Issue> {
      const request = db
        .prepare(`SELECT ${columns} FROM requests WHERE id = ? AND room = ?`)
        .get(id, room) as Request | undefined;
      if (!request) throw new Error("Request not found in the selected room.");
      const fresh =
        db
          .prepare(
            `INSERT INTO issue_projections (request_id, repository, state)
        VALUES (?, ?, 'writing') ON CONFLICT(request_id) DO NOTHING`,
          )
          .run(id, tracker.repository).changes === 1;
      const row = db
        .prepare(
          "SELECT repository FROM issue_projections WHERE request_id = ?",
        )
        .get(id);
      if (row?.repository !== tracker.repository)
        throw new Error(
          "Request already belongs to a different issue tracker.",
        );
      const linked = issueFor(id);
      if (linked) return linked;
      try {
        const issue = fresh
          ? await tracker.create(request, room)
          : await tracker.find(id);
        if (!issue) throw new Error("No matching issue receipt yet.");
        db.prepare(
          "UPDATE issue_projections SET state = 'linked', number = ?, url = ? WHERE request_id = ?",
        ).run(issue.number, issue.url, id);
        return issue;
      } catch {
        // A failed lookup cannot undo a receipt committed by a concurrent call.
        const existing = issueFor(id);
        if (existing) return existing;
        db.prepare(
          "UPDATE issue_projections SET state = 'uncertain' WHERE request_id = ? AND state <> 'linked'",
        ).run(id);
        throw new Error(
          "GitHub issue creation is uncertain. Reconcile by request marker; no automatic second create.",
        );
      }
    },
    receive(frame: unknown): Request | null {
      if (
        at(frame, "event") !== "message" ||
        at(frame, "data", "room_id") !== room
      )
        return null;
      const p = at(frame, "data", "payload");
      if (
        at(p, "thread_id") !== null ||
        at(p, "sender_kind") === "platform" ||
        at(p, "on_behalf_of")
      )
        return null;
      const body = at(p, "body"),
        thread = at(p, "message_id");
      if (
        typeof body !== "string" ||
        typeof thread !== "string" ||
        !thread ||
        thread.length > 256
      )
        return null;
      const match = /^@feedback[ \t]+report:[ \t]*(\S[\s\S]*)$/i.exec(body);
      const report = match?.[1]?.trim();
      if (!report || report.length > 10_000) return null;
      return persist(thread, report, p);
    },
    queueHistoryRoot(root: unknown): Request | null {
      const thread = at(root, "id"),
        body = at(root, "body");
      if (
        at(root, "kind") !== "message" ||
        at(root, "sender_kind") === "platform" ||
        at(root, "on_behalf_of") ||
        typeof thread !== "string" ||
        !thread ||
        thread.length > 256 ||
        typeof body !== "string" ||
        !/^@feedback(?:\s|$)/i.test(body) ||
        body.length > 10_000
      )
        return null;
      return persist(thread, body, root);
    },
    async approve(id: string, revision: number): Promise<Request> {
      const claimed = db
        .prepare(
          `UPDATE requests SET state = 'dispatching', approved_at = ?
        WHERE id = ? AND room = ? AND revision = ? AND state = 'pending'
          AND NOT EXISTS (SELECT 1 FROM requests WHERE state IN ('dispatching', 'dispatched', 'uncertain'))
        RETURNING ${columns}`,
        )
        .get(new Date().toISOString(), id, room, revision) as
        Request | undefined;
      if (!claimed)
        throw new Error(
          "No matching pending revision, or the configured worker is busy.",
        );
      try {
        const workerMessage = await dispatch(claimed);
        if (!workerMessage) throw new Error("No Switch dispatch receipt.");
        return db
          .prepare(
            `UPDATE requests SET state = 'dispatched', worker_message = ?
          WHERE id = ? RETURNING ${columns}`,
          )
          .get(workerMessage, id) as Request;
      } catch {
        db.prepare("UPDATE requests SET state = 'uncertain' WHERE id = ?").run(
          id,
        );
        throw new Error(
          "Dispatch is uncertain. Check the original thread before releasing the worker; no automatic retry.",
        );
      }
    },
    release(id: string): boolean {
      return (
        db
          .prepare(
            `UPDATE requests SET state = 'done' WHERE room = ? AND id = ?
        AND state IN ('dispatched', 'uncertain', 'dispatching')`,
          )
          .run(room, id).changes === 1
      );
    },
    close: () => db.close(),
  };
}
