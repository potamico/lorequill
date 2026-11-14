import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generate, outputPath } from "../../scripts/generate-types.mjs";
import { profileSchema } from "../../src/index";

describe("profile schema", () => {
  it("is a Draft 2020-12 schema", () => {
    expect(profileSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("is closed at the top level", () => {
    expect(profileSchema.additionalProperties).toBe(false);
  });

  it("closes every object definition", () => {
    const definitions = Object.entries(profileSchema.$defs) as [string, Record<string, unknown>][];
    // Union wrappers (`oneOf` with a discriminator) only select among closed object schemas.
    const objectSchemas = definitions.filter(
      ([, schema]) => schema.type === "object" && !("oneOf" in schema),
    );
    expect(objectSchemas.length).toBeGreaterThan(0);
    for (const [name, schema] of objectSchemas) {
      expect(schema.additionalProperties, `$defs.${name}`).toBe(false);
    }
  });

  it("does not offer any parameter that could carry a regular expression or command", () => {
    const forbidden = new Set(["regex", "pattern", "argv", "command", "shell", "script", "exec"]);
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        const properties = record.properties;
        if (typeof properties === "object" && properties !== null) {
          Object.keys(properties).forEach((key) => names.add(key));
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(profileSchema);
    for (const name of names) {
      expect(forbidden.has(name), `property "${name}"`).toBe(false);
    }
  });
});

describe("generated types", () => {
  it("are up to date with the schema", async () => {
    const expected = await generate();
    const actual = await readFile(outputPath, "utf8");
    expect(actual).toBe(expected);
  });
});
