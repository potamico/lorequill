import type { Profile } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import { engineMismatch } from "../../src/core/engine-version";

const profile = (engineVersion?: string): Profile => ({
  version: 1,
  content: { root: "docs", include: ["**/*.md"] },
  ...(engineVersion === undefined ? {} : { checks: { engine_version: engineVersion } }),
});

describe("engineMismatch", () => {
  it("reports a CI engine that differs from the bundled one", () => {
    expect(engineMismatch(profile("0.2.0"), "0.1.0")).toEqual({
      expected: "0.2.0",
      actual: "0.1.0",
    });
  });

  it("reports nothing for the same engine or an undeclared one", () => {
    expect(engineMismatch(profile("0.1.0"), "0.1.0")).toBeUndefined();
    expect(engineMismatch(profile(), "0.1.0")).toBeUndefined();
  });
});
