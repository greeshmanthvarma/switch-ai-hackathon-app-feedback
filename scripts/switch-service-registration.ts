import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function serverOrigin(raw: string): URL {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use a server origin without credentials or path.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("HTTPS is required except on loopback.");
  return url;
}
export const registrationBody = {
  name: "app-feedback-f1-probe",
  description:
    "Deterministic App Feedback F1 transport probe; no model runtime",
  connector_type: "app-feedback-service",
  integration_profile: {
    connection_model: "always_on",
    message_exchange: true,
    pre_invocation_mediation: [],
    post_invocation_mediation: [],
    event_reporting: [],
  },
  overwrite: false,
};
export async function registerService(
  base: URL,
  key: string,
  request: typeof fetch = fetch,
): Promise<{ id: string; api_key: string }> {
  if (!key.trim() || /[\r\n]/.test(key))
    throw new Error("A private registration credential is required.");
  const response = await request(new URL("/agents", base), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(registrationBody),
  });
  if (!response.ok)
    throw new Error(
      `Registration HTTP ${response.status}; response body withheld.`,
    );
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("api_key" in value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.api_key !== "string" ||
    !value.api_key
  )
    throw new Error(
      "Unexpected registration response; inspect private setup before retrying.",
    );
  return { id: value.id, api_key: value.api_key };
}
async function main() {
  if (process.argv.slice(2).join(" ") !== "--register")
    throw new Error(
      "Use --register only after confirming the intended server.",
    );
  const base = serverOrigin(process.env.SWITCH_PROBE_BASE_URL ?? "");
  const key = process.env.SWITCH_PROBE_REGISTRATION_KEY;
  if (!key)
    throw new Error(
      "Supply the registration credential privately, not in chat or command arguments.",
    );
  const directory = resolve(".local/switch-probe");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = resolve(directory, "service.json");
  try {
    await readFile(destination);
    throw new Error(
      "Service credentials already exist; registration will not overwrite them.",
    );
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  // Reserve the output before making an external write. On interruption this file
  // prevents blind re-registration; inspect the private attempt state first.
  const file = await open(destination, "wx", 0o600);
  const attempt = resolve(directory, "registration-attempt.json");
  try {
    await writeFile(
      attempt,
      JSON.stringify({
        server: base.origin,
        name: registrationBody.name,
        status: "started",
        at: new Date().toISOString(),
      }),
      { mode: 0o600, flag: "wx" },
    );
    const service = await registerService(base, key);
    await file.writeFile(
      JSON.stringify(
        {
          server: base.origin,
          identityKind: "separate-unmanaged-service",
          ...service,
        },
        null,
        2,
      ),
    );
    await file.sync();
    await writeFile(
      attempt,
      JSON.stringify({
        server: base.origin,
        name: registrationBody.name,
        status: "credentials-saved",
      }),
      { mode: 0o600 },
    );
    console.log(
      "Separate probe service registered; credentials saved privately. No room joined, socket opened, or message posted.",
    );
  } finally {
    await file.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Registration stopped. No credentials or remote response bodies are printed. If a private service.json reservation exists, inspect the registration attempt before retrying; never overwrite an existing agent.",
    );
    process.exitCode = 1;
  });
