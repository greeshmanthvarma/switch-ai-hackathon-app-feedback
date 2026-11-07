import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { at } from "./switch-evidence.js";

const repoName = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const issueLink =
  /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[1-9]\d*$/;
const branch = "feedback/export-status";

export type VerifiedPr = { url: string; sha: string; issueUrl: string };

export async function verifyPullRequest(input: {
  repository: string;
  number: number;
  sha: string;
  issueUrl: string;
  read: () => Promise<unknown>;
  regression: () => Promise<void>;
}): Promise<VerifiedPr> {
  const { repository, number, sha, issueUrl } = input;
  if (
    !repoName.test(repository) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !issueLink.test(issueUrl)
  ) {
    throw new Error("Invalid target, PR, commit or issue reference.");
  }
  const url = `https://github.com/${repository}/pull/${number}`;
  const check = (pull: unknown) => {
    if (
      at(pull, "state") !== "open" ||
      at(pull, "number") !== number ||
      at(pull, "html_url") !== url ||
      at(pull, "head", "ref") !== branch ||
      at(pull, "head", "sha") !== sha ||
      at(pull, "base", "ref") !== "main" ||
      at(pull, "head", "repo", "full_name") !== repository ||
      at(pull, "base", "repo", "full_name") !== repository
    ) {
      throw new Error(
        "PR is not open on the selected target, baseline and verified head.",
      );
    }
    if (
      !String(at(pull, "body"))
        .split(/\r?\n/)
        .includes(`Related to ${issueUrl}`)
    ) {
      throw new Error("PR does not explicitly reference this request's issue.");
    }
  };
  check(await input.read());
  await input.regression();
  check(await input.read());
  return { url, sha, issueUrl };
}

function command(
  file: string,
  args: string[],
  cwd: string,
  failure: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, env, timeout: 20_000, maxBuffer: 1_000_000 },
      (error, output) => {
        if (error) reject(new Error(failure));
        else resolve(output.trim());
      },
    );
  });
}

export async function verifyTargetPr(options: {
  checkout: string;
  repository: string;
  tracker: string;
  number: number;
  issueUrl: string;
}): Promise<VerifiedPr> {
  if (
    !isAbsolute(options.checkout) ||
    !repoName.test(options.repository) ||
    options.repository.toLowerCase() === options.tracker.toLowerCase() ||
    !Number.isSafeInteger(options.number) ||
    options.number < 1
  ) {
    throw new Error(
      "Select an absolute target checkout and a separate private target repository.",
    );
  }
  const checkout = await realpath(options.checkout);
  if (checkout === (await realpath(process.cwd())))
    throw new Error("The automation checkout cannot be the target.");
  const safeEnv = { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: "0" };
  const git = (...args: string[]) =>
    command(
      "git",
      args,
      checkout,
      "Cannot inspect the selected target checkout.",
      safeEnv,
    );
  if ((await realpath(await git("rev-parse", "--show-toplevel"))) !== checkout)
    throw new Error("The target must be a repository root.");
  const inspect = async () => {
    if (await git("status", "--porcelain", "--untracked-files=all"))
      throw new Error("The target checkout must be clean.");
    if ((await git("branch", "--show-current")) !== branch)
      throw new Error(`Check out ${branch} in the target first.`);
    return git("rev-parse", "HEAD");
  };
  const sha = await inspect();
  const github = async (endpoint: string): Promise<unknown> =>
    JSON.parse(
      await command(
        "gh",
        ["api", "--hostname", "github.com", endpoint],
        checkout,
        "Cannot read GitHub. Check network access and gh authentication.",
        { ...process.env, GH_PROMPT_DISABLED: "1" },
      ),
    );
  const metadata = await github(`repos/${options.repository}`);
  const repository = String(at(metadata, "full_name"));
  if (
    repository.toLowerCase() !== options.repository.toLowerCase() ||
    at(metadata, "private") !== true
  )
    throw new Error(
      "The target must be the selected private GitHub repository.",
    );
  const remote = (await git("remote", "get-url", "origin")).replace(
    /\.git$/,
    "",
  );
  if (
    ![`https://github.com/${repository}`, `git@github.com:${repository}`].some(
      (url) => url.toLowerCase() === remote.toLowerCase(),
    )
  )
    throw new Error(
      "The target origin does not match the selected repository.",
    );
  return verifyPullRequest({
    repository,
    number: options.number,
    sha,
    issueUrl: options.issueUrl,
    read: () => github(`repos/${repository}/pulls/${options.number}`),
    regression: async () => {
      await command(
        process.execPath,
        ["--test", "test/export.test.mjs"],
        checkout,
        "The target export regression did not pass.",
        safeEnv,
      );
      if ((await inspect()) !== sha)
        throw new Error("The target changed during verification.");
    },
  });
}

export async function inspectFixTarget(
  checkoutPath: string,
  repository: string,
  tracker: string,
) {
  if (
    !isAbsolute(checkoutPath) ||
    !repoName.test(repository) ||
    repository.toLowerCase() === tracker.toLowerCase()
  )
    throw new Error(
      "Configure an absolute checkout of a separate target repository.",
    );

  const checkout = await realpath(checkoutPath);
  const git = (...args: string[]) =>
    command("git", args, checkout, "Cannot inspect the target checkout.", {
      PATH: process.env.PATH,
      GIT_OPTIONAL_LOCKS: "0",
    });
  if (
    checkout === (await realpath(process.cwd())) ||
    (await realpath(await git("rev-parse", "--show-toplevel"))) !== checkout ||
    (await git("status", "--porcelain", "--untracked-files=all"))
  )
    throw new Error(
      "The implementation target must be a clean, separate repository root.",
    );
  const origin = (await git("remote", "get-url", "origin")).replace(
    /\.git$/,
    "",
  );
  if (
    ![`https://github.com/${repository}`, `git@github.com:${repository}`].some(
      (url) => url.toLowerCase() === origin.toLowerCase(),
    )
  )
    throw new Error(
      "The target checkout origin does not match the selected GitHub repository.",
    );

  const github = async (endpoint: string): Promise<unknown> =>
    JSON.parse(
      await command(
        "gh",
        ["api", "--hostname", "github.com", endpoint],
        checkout,
        "Cannot read the target repository or its demo baseline from GitHub.",
        { ...process.env, GH_PROMPT_DISABLED: "1" },
      ),
    );
  const base = "demo/atlas-workspace";
  const [metadata, branch] = await Promise.all([
    github(`repos/${repository}`),
    github(`repos/${repository}/branches/${base}`),
  ]);
  const baseSha = at(branch, "commit", "sha");
  if (
    at(metadata, "private") !== true ||
    at(metadata, "permissions", "push") !== true ||
    String(at(metadata, "full_name")).toLowerCase() !==
      repository.toLowerCase() ||
    at(branch, "name") !== base ||
    typeof baseSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(baseSha)
  )
    throw new Error(
      "The approved demo baseline must exist in the selected private, writable target repository.",
    );
  return { checkout, repository, base, baseSha };
}
