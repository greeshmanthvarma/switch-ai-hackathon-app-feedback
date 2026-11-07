import { expect, test, vi } from "vitest";
import { verifyPullRequest } from "../../scripts/demo-pr.js";
import { sendPrHandoff } from "../../scripts/demo-handoff.js";
import { openDemo } from "../../scripts/demo-store.js";

const repository = "demo/project-target";
const sha = "a".repeat(40);
const issueUrl = "https://github.com/demo/feedback/issues/7";
const pull = {
  number: 12,
  state: "open",
  html_url: `https://github.com/${repository}/pull/12`,
  body: `Related to ${issueUrl}`,
  head: { sha, ref: "feedback/export-status", repo: { full_name: repository } },
  base: { ref: "main", repo: { full_name: repository } },
};

test("a verified, issue-linked PR is handed to feedback in the original thread", async () => {
  const verified = await verifyPullRequest({
    repository,
    number: 12,
    sha,
    issueUrl,
    read: async () => pull,
    regression: async () => {},
  });
  const operation = vi.fn(async (_name: string, _args: object) => ({
    event_id: "receipt",
  }));
  const demo = openDemo(":memory:", "demo-room", async () => "smoke-receipt");
  try {
    const request = demo.queueHistoryRoot({
      id: "root",
      kind: "message",
      body: "@feedback report: Export ignores status",
    })!;
    const relay = (approved: typeof request) =>
      sendPrHandoff(operation, approved, "implementation-1", verified);
    await expect(demo.approve(request.id, 2, relay)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    await expect(demo.approve(request.id, 1, relay)).resolves.toMatchObject({
      workerMessage: "receipt",
      state: "dispatched",
    });
    await expect(demo.approve(request.id, 1, relay)).rejects.toThrow();
    expect(operation).toHaveBeenCalledExactlyOnceWith("send_targeted_message", {
      target_names: ["feedback"],
      thread_id: "root",
      body: expect.stringContaining(`Verified PR: ${pull.html_url}`),
    });
  } finally {
    demo.close();
  }
});

test("a head change during verification prevents PR handoff", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(pull)
    .mockResolvedValueOnce({
      ...pull,
      head: { ...pull.head, sha: "b".repeat(40) },
    });
  await expect(
    verifyPullRequest({
      repository,
      number: 12,
      sha,
      issueUrl,
      read,
      regression: async () => {},
    }),
  ).rejects.toThrow("verified head");
});

test("an unrelated PR or a failed regression cannot be presented as verified", async () => {
  const input = { repository, number: 12, sha, issueUrl };
  await expect(
    verifyPullRequest({
      ...input,
      read: async () => ({ ...pull, body: "unrelated" }),
      regression: async () => {},
    }),
  ).rejects.toThrow("issue");
  await expect(
    verifyPullRequest({
      ...input,
      read: async () => pull,
      regression: async () => {
        throw new Error("Regression failed");
      },
    }),
  ).rejects.toThrow("Regression failed");
});
