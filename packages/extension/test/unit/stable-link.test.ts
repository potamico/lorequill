import type { Profile } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import { stableLink } from "../../src/core/links/stable-link";

const base: Profile = { version: 1, content: { root: "docs", include: ["**/*.md"] } };
const site: Profile = {
  ...base,
  site: {
    url: "https://docs.example.org/handbook/",
    stable_links: { field: "id", path: "id/{value}/" },
  },
};

describe("stableLink", () => {
  it("builds the address from the site URL, the path, and the encoded value", () => {
    expect(stableLink(site, "BOK-2")).toEqual({
      kind: "link",
      url: "https://docs.example.org/handbook/id/BOK-2/",
    });
    expect(stableLink(site, " Ä b ")).toEqual({
      kind: "link",
      url: "https://docs.example.org/handbook/id/%C3%84%20b/",
    });
    expect(stableLink(site, 7)).toMatchObject({ url: "https://docs.example.org/handbook/id/7/" });
  });

  it("needs both the site URL and stable links in the profile", () => {
    expect(stableLink(base, "BOK-2")).toEqual({ kind: "not-configured" });
    expect(stableLink({ ...base, site: { url: "https://x.org/" } }, "BOK-2")).toEqual({
      kind: "not-configured",
    });
    expect(
      stableLink({ ...base, site: { stable_links: { field: "id", path: "{value}" } } }, "BOK-2"),
    ).toEqual({ kind: "not-configured" });
  });

  it("refuses values the site build skips", () => {
    for (const value of [
      undefined,
      null,
      "",
      "  ",
      ".",
      "..",
      "a/b",
      "a\\b",
      "a\nb",
      true,
      ["x"],
      {},
      NaN,
    ]) {
      expect(stableLink(site, value)).toEqual({ kind: "no-value", field: "id" });
    }
  });
});
