import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PROFILE_BYTES, PROFILE_RELATIVE_PATH, loadProfile } from "../../src/index";
import { BASE, fixture, summarize } from "./helpers";

let sandbox: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "lorequill-profile-"));
  workspace = join(sandbox, "workspace");
  outside = join(sandbox, "outside");
  await mkdir(workspace);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function writeProfile(content: string | Buffer): Promise<string> {
  const file = join(workspace, ...PROFILE_RELATIVE_PATH.split("/"));
  await mkdir(join(workspace, ".lorequill"), { recursive: true });
  await writeFile(file, content);
  return file;
}

describe("loadProfile", () => {
  it("loads a valid profile", async () => {
    await writeProfile(fixture("valid/full.yaml"));
    const result = await loadProfile(workspace);
    expect(result.ok).toBe(true);
  });

  it("strips a UTF-8 byte order mark", async () => {
    await writeProfile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BASE)]));
    expect((await loadProfile(workspace)).ok).toBe(true);
  });

  it("reports a missing profile", async () => {
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-not-found"]);
  });

  it("reports a missing workspace folder as a missing profile", async () => {
    const result = await loadProfile(join(sandbox, "does-not-exist"));
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-not-found"]);
  });

  it("reports a missing .lorequill directory as a missing profile", async () => {
    await mkdir(join(workspace, ".lorequill"));
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-not-found"]);
  });

  it("rejects a directory in place of the profile file", async () => {
    await mkdir(join(workspace, ".lorequill", "config.yaml"), { recursive: true });
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-not-a-file"]);
  });

  it("rejects invalid UTF-8", async () => {
    await writeProfile(Buffer.from([0x76, 0x65, 0xff, 0xfe, 0x0a]));
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-invalid-encoding"]);
  });

  it("rejects an oversized profile without parsing it", async () => {
    await writeProfile(`# ${"x".repeat(MAX_PROFILE_BYTES)}\n${BASE}`);
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-too-large"]);
  });

  it("accepts a profile exactly at the size limit", async () => {
    const padding = "#".repeat(MAX_PROFILE_BYTES - Buffer.byteLength(BASE) - 1);
    await writeProfile(`${padding}\n${BASE}`);
    expect((await loadProfile(workspace)).ok).toBe(true);
  });

  it("reports YAML and schema issues from the file", async () => {
    await writeProfile(`${BASE}argv: [sh]\n`);
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["unknown-key /argv"]);
  });

  it("rejects a profile file that is a symlink to a file outside the workspace", async () => {
    await writeFile(join(outside, "config.yaml"), BASE);
    await mkdir(join(workspace, ".lorequill"));
    await symlink(join(outside, "config.yaml"), join(workspace, ".lorequill", "config.yaml"));
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-outside-workspace"]);
  });

  it("rejects a .lorequill directory that is a symlink to a directory outside the workspace", async () => {
    await writeFile(join(outside, "config.yaml"), BASE);
    await symlink(outside, join(workspace, ".lorequill"), "dir");
    const result = await loadProfile(workspace);
    expect(!result.ok && summarize(result.issues)).toEqual(["profile-outside-workspace"]);
  });

  it("accepts a symlink that stays inside the workspace", async () => {
    await mkdir(join(workspace, ".lorequill"));
    await writeFile(join(workspace, "real-profile.yaml"), BASE);
    await symlink(
      join(workspace, "real-profile.yaml"),
      join(workspace, ".lorequill", "config.yaml"),
    );
    expect((await loadProfile(workspace)).ok).toBe(true);
  });

  it("works when the workspace folder itself is reached through a symlink", async () => {
    await writeProfile(BASE);
    const alias = join(sandbox, "alias");
    await symlink(workspace, alias, "dir");
    expect((await loadProfile(alias)).ok).toBe(true);
  });
});
