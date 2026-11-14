import { describe, expect, it } from "vitest";
import {
  createLogger,
  formatLogLine,
  type LogFields,
  type LogLevel,
  type LogSink,
} from "../../src/core/logger";

describe("formatLogLine", () => {
  it("prints the event and sorted fields", () => {
    expect(formatLogLine("pages-scanned", { truncated: false, pages: 12, folder: 0 })).toBe(
      "pages-scanned folder=0 pages=12 truncated=false",
    );
  });

  it("prints state names from the closed vocabulary", () => {
    expect(formatLogLine("profile-loaded", { status: "profile-invalid", problems: 3 })).toBe(
      "profile-loaded problems=3 status=profile-invalid",
    );
  });

  it("prints a bare event", () => {
    expect(formatLogLine("activated")).toBe("activated");
  });

  it("replaces anything that is not a known kind of value", () => {
    // Types prevent this; the test shows what happens if the types are bypassed.
    const secret = "Title: My confidential plan";
    const fields = { note: secret, value: Number.NaN } as unknown as LogFields;
    const line = formatLogLine("pages-scanned", fields);
    expect(line).toBe("pages-scanned note=redacted value=redacted");
    expect(line).not.toContain("confidential");
  });

  it("drops fields with unsafe names", () => {
    const fields = { "bad key": 1, ok: 2 } as unknown as LogFields;
    expect(formatLogLine("activated", fields)).toBe("activated ok=2");
  });

  it("cannot be used to log text containing line breaks or paths", () => {
    const fields = {
      status: "a\nb",
      other: "/home/user/docs/page.md",
    } as unknown as LogFields;
    expect(formatLogLine("activated", fields)).toBe("activated other=redacted status=redacted");
  });
});

describe("createLogger", () => {
  it("writes formatted lines with the level to the sink", () => {
    const lines: [LogLevel, string][] = [];
    const sink: LogSink = {
      write: (level, line) => {
        lines.push([level, line]);
      },
    };
    const logger = createLogger(sink);
    logger.info("folder-added", { folder: 1 });
    logger.warn("profile-loaded", { status: "unsupported-location" });
    expect(lines).toEqual([
      ["info", "folder-added folder=1"],
      ["warn", "profile-loaded status=unsupported-location"],
    ]);
  });
});
