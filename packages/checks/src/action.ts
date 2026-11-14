import { randomBytes } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { CheckResult } from "./engine";
import type { Finding } from "./findings";
import { formatText } from "./report";
import { checkRepository, formatProfileIssues } from "./repository";
import { formatSarif } from "./sarif";
import { ENGINE_VERSION } from "./version";

/** At most this many findings become workflow annotations; the log lists all of them. */
export const MAX_ANNOTATIONS = 50;

/** Exit codes of the Action step, the same as the CLI's (specification §11). */
export const ACTION_EXIT = { passed: 0, findings: 1, error: 2 } as const;

export interface ActionIo {
  readonly stdout: (text: string) => void;
}

/**
 * The GitHub Action (specification §14): checks the checked-out repository with its own profile,
 * prints the engine version, annotates findings, and optionally writes SARIF for upload. It reads
 * files only; nothing from the repository is installed or executed.
 *
 * Inputs (as `INPUT_*` variables): `path` (repository directory, default the workspace),
 * `sarif-file` (optional output file), `fail-on-findings` (default `true`).
 */
export async function runAction(env: NodeJS.ProcessEnv, io: ActionIo): Promise<number> {
  const workspace = resolve(env.GITHUB_WORKSPACE ?? ".");
  const repository = resolve(workspace, input(env, "path") || ".");
  const sarifInput = input(env, "sarif-file");
  const failOnFindings = (input(env, "fail-on-findings") || "true").toLowerCase() !== "false";
  // Annotation paths are relative to the workspace, where GitHub resolves them.
  const prefix = toPosix(relative(workspace, repository));

  io.stdout(`Lorequill checks engine ${ENGINE_VERSION}\n`);
  await setOutput(env, "engine-version", ENGINE_VERSION);

  const checked = await checkRepository(repository);
  if (checked.kind !== "checked") {
    const message =
      checked.kind === "invalid-profile"
        ? `The profile .lorequill/config.yaml cannot be used:\n${formatProfileIssues(checked.issues)}`
        : `content.root "${checked.root}" is not a directory.`;
    io.stdout(`${command("error", { title: "Lorequill" }, message)}\n`);
    await setOutput(env, "status", "error");
    return ACTION_EXIT.error;
  }

  const { result, profile } = checked;
  // The report quotes page content; it must not be read as workflow commands.
  const token = randomBytes(16).toString("hex");
  io.stdout(`::stop-commands::${token}\n${formatText(result)}::${token}::\n`);
  for (const finding of result.findings.slice(0, MAX_ANNOTATIONS)) {
    io.stdout(`${annotation(finding, prefix)}\n`);
  }
  if (sarifInput) {
    const sarifFile = resolve(workspace, sarifInput);
    await writeFile(sarifFile, formatSarif(result, profile), "utf8");
    await setOutput(env, "sarif-file", sarifFile);
  }
  await setOutput(env, "status", result.status);
  await setOutput(env, "findings", String(result.findings.length));
  await summarize(env, result);

  if (result.status === "error") {
    io.stdout(
      `${command("error", { title: "Lorequill" }, `Check incomplete (${result.error?.code ?? "unknown"}); this is not a pass.`)}\n`,
    );
    return ACTION_EXIT.error;
  }
  return result.status === "failed" && failOnFindings ? ACTION_EXIT.findings : ACTION_EXIT.passed;
}

function input(env: NodeJS.ProcessEnv, name: string): string {
  return (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** A workflow command, with its data and properties escaped as GitHub requires. */
export function command(
  name: string,
  properties: Readonly<Record<string, string | number | undefined>>,
  message: string,
): string {
  const escapeData = (value: string): string =>
    value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProperty = (value: string): string =>
    escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const list = Object.entries(properties)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(",");
  return `::${name}${list === "" ? "" : ` ${list}`}::${escapeData(message)}`;
}

function annotation(finding: Finding, prefix: string): string {
  const file = prefix === "" ? finding.path : posix.join(prefix, finding.path);
  return command(
    "error",
    {
      file,
      line: finding.line,
      col: finding.column,
      endLine: finding.endLine,
      endColumn: finding.endLine === finding.line ? finding.endColumn : undefined,
      title: `Lorequill ${finding.ruleId}`,
    },
    finding.message,
  );
}

async function setOutput(env: NodeJS.ProcessEnv, name: string, value: string): Promise<void> {
  const file = env.GITHUB_OUTPUT;
  if (file && isAbsolute(file) && !/[\r\n]/.test(value)) {
    await appendFile(file, `${name}=${value}\n`, "utf8");
  }
}

async function summarize(env: NodeJS.ProcessEnv, result: CheckResult): Promise<void> {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file || !isAbsolute(file)) {
    return;
  }
  const status =
    result.status === "passed" ? "passed" : result.status === "failed" ? "findings" : "incomplete";
  await appendFile(
    file,
    `### Lorequill checks\n\nEngine ${ENGINE_VERSION}: ${String(result.pagesChecked)} pages, ${String(result.findings.length)} findings, ${status}.\n`,
    "utf8",
  );
}
