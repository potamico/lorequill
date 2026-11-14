import { open, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import type { ProfileIssueCode, ProfileResult } from "./issues";
import { parseProfile } from "./parse";

/** Location of the profile relative to the repository (workspace folder) root. */
export const PROFILE_RELATIVE_PATH = ".lorequill/config.yaml";

/** Profiles are small configuration files; larger files are rejected before parsing. */
export const MAX_PROFILE_BYTES = 256 * 1024;

function fail(code: ProfileIssueCode): ProfileResult {
  return { ok: false, issues: [{ code, path: "" }] };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Reads and validates `.lorequill/config.yaml` below `workspaceRoot`.
 *
 * The real path of the profile must stay inside the real path of the workspace root, so a symlink
 * cannot make the extension read a file outside the repository. The file must be a regular file of
 * at most {@link MAX_PROFILE_BYTES} bytes, encoded as UTF-8.
 */
export async function loadProfile(workspaceRoot: string): Promise<ProfileResult> {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(workspaceRoot);
    realFile = await realpath(path.join(realRoot, ...PROFILE_RELATIVE_PATH.split("/")));
  } catch (error) {
    return fail(
      isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
        ? "profile-not-found"
        : "profile-unreadable",
    );
  }

  if (!isInside(realRoot, realFile)) {
    return fail("profile-outside-workspace");
  }

  let buffer: Buffer;
  try {
    if (!(await stat(realFile)).isFile()) {
      return fail("profile-not-a-file");
    }
    const handle = await open(realFile, "r");
    try {
      // Read one byte more than the limit to detect oversized files without loading them fully.
      const chunk = Buffer.alloc(MAX_PROFILE_BYTES + 1);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
      if (bytesRead > MAX_PROFILE_BYTES) {
        return fail("profile-too-large");
      }
      buffer = chunk.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return fail("profile-unreadable");
  }

  let text: string;
  try {
    // A leading byte order mark is stripped; invalid UTF-8 is an error.
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return fail("profile-invalid-encoding");
  }
  return parseProfile(text);
}
