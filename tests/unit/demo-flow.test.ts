import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { openDemo } from "../../scripts/demo-store.js";

test("a Slack report stays pending until the operator approves its exact revision; concurrent repeats dispatch once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feedback-demo-"));
  const dispatch = vi.fn(async () => "worker-message");
  const demo = openDemo(
    join(dir, "requests.sqlite"),
    "selected-room",
    dispatch,
  );
  try {
    const incoming = (
      id: string,
      body: string,
      thread: string | null = null,
      room = "selected-room",
    ) => ({
      event: "message",
      data: {
        room_id: room,
        payload: { message_id: id, thread_id: thread, body },
      },
    });
    expect(
      demo.receive(
        incoming(
          "off-room",
          "@feedback report: Fix export",
          null,
          "wrong-room",
        ),
      ),
    ).toBeNull();
    const request = demo.receive(
      incoming("report", "@feedback report: Export ignores status"),
    );
    expect(request).toMatchObject({
      state: "pending",
      revision: 1,
      thread: "report",
    });
    expect(
      demo.receive(
        incoming("report", "@feedback report: Export ignores status"),
      ),
    ).toBeNull();
    expect(
      demo.receive(incoming("reply", "@feedback authorize", "report")),
    ).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    await expect(demo.approve(request!.id, 2)).rejects.toThrow();
    await Promise.allSettled([
      demo.approve(request!.id, 1),
      demo.approve(request!.id, 1),
    ]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        thread: "report",
        body: "Export ignores status",
      }),
    );
    expect(demo.list()[0]).toMatchObject({
      state: "dispatched",
      workerMessage: "worker-message",
    });
  } finally {
    demo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ambiguous Switch dispatch stays reserved across restart and is never replayed automatically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feedback-demo-"));
  const path = join(dir, "requests.sqlite");
  const dispatch = vi.fn(async () => {
    throw new Error("lost receipt");
  });
  let demo = openDemo(path, "room", dispatch);
  try {
    function report(id: string) {
      return demo.receive({
        event: "message",
        data: {
          room_id: "room",
          payload: {
            message_id: id,
            thread_id: null,
            body: "@feedback report: Demo",
          },
        },
      })!;
    }
    const first = report("root-1"),
      second = report("root-2");
    await expect(demo.approve(first.id, 1)).rejects.toThrow("uncertain");
    demo.close();
    demo = openDemo(path, "room", dispatch);
    expect(demo.list().map((r) => r.state)).toEqual(["uncertain", "pending"]);
    await expect(demo.approve(first.id, 1)).rejects.toThrow();
    await expect(demo.approve(second.id, 1)).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    demo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the approved request targets feedback, which delegates the bounded check in the original thread", async () => {
  const { sendFeedbackHandoff } = await import("../../scripts/demo-handoff.js");
  const dir = mkdtempSync(join(tmpdir(), "feedback-relay-"));
  const operation = vi.fn(async (_name: string, _body: object) => ({
    event_id: "feedback-receipt",
  }));
  const demo = openDemo(join(dir, "requests.sqlite"), "room", (request) =>
    sendFeedbackHandoff(operation, request, "implementation-1"),
  );
  try {
    const r = demo.receive({
      event: "message",
      data: {
        room_id: "room",
        payload: {
          message_id: "original-root",
          thread_id: null,
          body: "@feedback report: edit an unrelated repository",
        },
      },
    })!;
    expect(operation).not.toHaveBeenCalled();
    await demo.approve(r.id, 1);
    expect(operation).toHaveBeenCalledExactlyOnceWith("send_targeted_message", {
      target_names: ["feedback"],
      thread_id: "original-root",
      body: expect.stringContaining("implementation-1"),
    });
    const sent = operation.mock.calls[0]![1] as { body: string };
    expect(sent.body).toContain("node --version");
    expect(sent.body).toContain("return the result to feedback");
    expect(sent.body).not.toContain("edit an unrelated repository");
    expect(demo.list()[0]?.workerMessage).toBe("feedback-receipt");
  } finally {
    demo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one tracked request produces one GitHub issue across repeated calls and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feedback-issue-"));
  const path = join(dir, "requests.sqlite");
  const dispatch = vi.fn();
  const create = vi.fn(async () => ({
    number: 17,
    url: "https://github.com/demo/tracker/issues/17",
  }));
  const tracker = {
    repository: "demo/tracker",
    create,
    find: vi.fn(async () => null),
  };
  let demo = openDemo(path, "room", dispatch);
  try {
    const r = demo.queueHistoryRoot({
      id: "root",
      kind: "message",
      body: "@feedback test a report",
    })!;
    await Promise.allSettled([
      demo.track(r.id, tracker),
      demo.track(r.id, tracker),
    ]);
    demo.close();
    demo = openDemo(path, "room", dispatch);
    expect(await demo.track(r.id, tracker)).toEqual({
      number: 17,
      url: "https://github.com/demo/tracker/issues/17",
    });
    expect(create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: r.id, thread: "root" }),
      "room",
    );
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    demo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lost issue receipt reconciles by marker instead of repeating the create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feedback-issue-recovery-"));
  const demo = openDemo(join(dir, "requests.sqlite"), "room", vi.fn());
  const create = vi.fn(async () => {
    throw new Error("lost receipt");
  });
  const found = {
    number: 17,
    url: "https://github.com/demo/tracker/issues/17",
  };
  const tracker = {
    repository: "demo/tracker",
    create,
    find: vi.fn(async () => found),
  };
  try {
    const r = demo.queueHistoryRoot({
      id: "root",
      kind: "message",
      body: "@feedback test a report",
    })!;
    await expect(demo.track(r.id, tracker)).rejects.toThrow("uncertain");
    await expect(demo.track(r.id, tracker)).resolves.toEqual(found);
    expect(create).toHaveBeenCalledTimes(1);
    expect(tracker.find).toHaveBeenCalledExactlyOnceWith(r.id);
  } finally {
    demo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
