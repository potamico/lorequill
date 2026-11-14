import type { TargetKind } from "@lorequill/markdown";
import type { CheckRule, Profile } from "@lorequill/profile";
import type { ContentSnapshot } from "../../src";

/** An in-memory snapshot; paths are relative to the content root. */
export function memorySnapshot(
  files: Readonly<Record<string, string>>,
  options: { readonly order?: "sorted" | "reversed"; readonly delayMs?: number } = {},
): ContentSnapshot {
  const paths = Object.keys(files);
  const directories = new Set<string>(["."]);
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  const delay = async (): Promise<void> => {
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  };
  return {
    async describe(path): Promise<TargetKind> {
      await delay();
      if (Object.hasOwn(files, path)) {
        return "file";
      }
      return directories.has(path) ? "directory" : "missing";
    },
    async readText(path) {
      await delay();
      return Object.hasOwn(files, path) ? files[path] : undefined;
    },
    async listFiles() {
      await delay();
      const sorted = [...paths].sort();
      return { files: options.order === "reversed" ? sorted.reverse() : sorted, truncated: false };
    },
  };
}

export function profileWith(rules: CheckRule[], overrides: Partial<Profile> = {}): Profile {
  return {
    version: 1,
    content: { root: "docs", include: ["**/*.md"] },
    checks: { rules },
    ...overrides,
  };
}
