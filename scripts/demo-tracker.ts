import { execFile } from "node:child_process";
import type { Request } from "./demo-store.js";
import { array, at, record } from "./switch-evidence.js";

export type Issue = { number: number; url: string };
export interface Tracker {
  repository: string;
  create(
    request: Request,
    room: string,
    expectedBehavior?: string,
  ): Promise<Issue>;
  find(requestId: string): Promise<Issue | null>;
}

function github(args: string[], input?: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      ["api", "--hostname", "github.com", ...args],
      {
        timeout: 15_000,
        maxBuffer: 8_000_000,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
      (error, out) => {
        if (error)
          return reject(
            new Error("GitHub API request failed; response withheld."),
          );
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Invalid GitHub response."));
        }
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ? JSON.stringify(input) : undefined);
  });
}

export function issueMarker(id: string) {
  return `<!-- app-feedback:request=${id} -->`;
}

export function issueBody(r: Request, room: string, expectedBehavior?: string) {
  // Indent untrusted report data as a literal block: no mentions or embedded HTML.
  const literal = (s: string) =>
    s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
  const screenshots = array(JSON.parse(r.attachments)).map((a) => ({
    name: at(a, "name"),
    type: at(a, "type"),
    switchReference: at(a, "reference"),
  }));
  return [
    issueMarker(r.id),
    "## App Feedback demo report",
    ...(expectedBehavior
      ? [
          "### Status",
          "Approved for implementation",
          "### Confirmed behavior",
          literal(expectedBehavior),
        ]
      : [
          "This is a transport test record. It does not authorize implementation or report a code fix.",
        ]),
    "### Source and revision",
    literal(
      JSON.stringify(
        { switchRoom: room, switchThread: r.thread, revision: r.revision },
        null,
        2,
      ),
    ),
    "### Original report",
    literal(r.body),
    "### Screenshot references",
    screenshots.length
      ? literal(JSON.stringify(screenshots, null, 2))
      : "None.",
  ].join("\n\n");
}

export async function privateGithubTracker(
  repository: string,
): Promise<Tracker> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository)
  )
    throw new Error("Tracker must be an explicit GitHub owner/repository.");
  const path = `repos/${repository}`;
  const metadata = await github([path]);
  if (
    String(at(metadata, "full_name")).toLowerCase() !==
      repository.toLowerCase() ||
    at(metadata, "private") !== true ||
    at(metadata, "has_issues") !== true ||
    at(metadata, "archived") === true ||
    at(metadata, "permissions", "push") !== true
  ) {
    throw new Error(
      "Tracker must be an accessible private repository with Issues enabled.",
    );
  }
  const canonical = String(at(metadata, "full_name"));
  function receipt(value: unknown): Issue {
    const number = at(value, "number");
    const url = at(value, "html_url");
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      url !== `https://github.com/${canonical}/issues/${number}` ||
      "pull_request" in record(value)
    )
      throw new Error("Unexpected GitHub issue receipt.");
    return { number, url };
  }
  return {
    repository: canonical,
    async create(request, room, expectedBehavior) {
      const response = await github(
        ["--method", "POST", `${path}/issues`, "--input", "-"],
        {
          title: expectedBehavior
            ? `App feedback: ${request.body.trim().replace(/\s+/g, " ").slice(0, 100)}`
            : `[Demo test] App Feedback request ${request.id.slice(0, 8)}`,
          body: issueBody(request, room, expectedBehavior),
        },
      );
      if (
        !String(at(response, "body")).startsWith(issueMarker(request.id) + "\n")
      )
        throw new Error("GitHub receipt is missing the request marker.");
      return receipt(response);
    },
    async find(requestId) {
      const pages = await github([
        "--paginate",
        "--slurp",
        `${path}/issues?state=all&per_page=100`,
      ]);
      const matches = array(pages)
        .flatMap(array)
        .filter(
          (item) =>
            !("pull_request" in record(item)) &&
            String(at(item, "body")).startsWith(issueMarker(requestId) + "\n"),
        );
      if (matches.length > 1)
        throw new Error(
          "More than one GitHub issue has this marker; review manually.",
        );
      return matches.length === 1 ? receipt(matches[0]) : null;
    },
  };
}
