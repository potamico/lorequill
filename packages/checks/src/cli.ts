import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { formatJson, formatText } from "./report";
import { checkRepository, formatProfileIssues } from "./repository";
import { formatSarif } from "./sarif";
import { ENGINE_VERSION } from "./version";

/** Exit codes of the CLI (specification §11). */
export const EXIT = { passed: 0, findings: 1, error: 2 } as const;

const HELP = `Usage: lorequill-checks [options] [repository]

Runs the checks of .lorequill/config.yaml against the files of a repository.

Options:
  --format <text|json|sarif>  Report format on standard output (default: text)
  --output <file>             Also write the report in the chosen format to a file
  --version                   Print the engine version
  --help                      Print this help

Exit codes: 0 no findings, 1 findings, 2 configuration or execution error.
`;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs the CLI and returns its exit code. Separated from `process` for testing. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
        output: { type: "string" },
        version: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return EXIT.error;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return EXIT.passed;
  }
  if (values.version) {
    io.stdout(`${ENGINE_VERSION}\n`);
    return EXIT.passed;
  }
  const format = values.format;
  if (format !== "text" && format !== "json" && format !== "sarif") {
    io.stderr(`error: unknown format "${format}"; use text, json, or sarif\n`);
    return EXIT.error;
  }
  if (positionals.length > 1) {
    io.stderr(`error: expected at most one repository path\n\n${HELP}`);
    return EXIT.error;
  }

  const checked = await checkRepository(positionals[0] ?? ".");
  if (checked.kind === "invalid-profile") {
    io.stderr(
      `error: the profile .lorequill/config.yaml cannot be used:\n${formatProfileIssues(checked.issues)}`,
    );
    return EXIT.error;
  }
  if (checked.kind === "no-content-root") {
    io.stderr(`error: content.root "${checked.root}" is not a directory\n`);
    return EXIT.error;
  }
  const { profile, result } = checked;
  const report =
    format === "json"
      ? formatJson(result)
      : format === "sarif"
        ? formatSarif(result, profile)
        : formatText(result);
  io.stdout(report);
  if (values.output !== undefined) {
    await writeFile(values.output, report, "utf8");
  }
  if (result.status === "error") {
    if (format !== "text") {
      io.stderr(
        `error: check incomplete (${result.error?.code ?? "unknown"}); this is not a pass\n`,
      );
    }
    return EXIT.error;
  }
  return result.status === "passed" ? EXIT.passed : EXIT.findings;
}
