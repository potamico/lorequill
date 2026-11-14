import { describe, expect, it } from "vitest";
import { codeLanguageFor, highlightCodeBlock } from "../../src/code-languages";

describe("codeLanguageFor", () => {
  it("matches names and aliases case-insensitively by the first word of the info", () => {
    expect(codeLanguageFor('py title="a.py"')?.name).toBe("Python");
    expect(codeLanguageFor("YAML")?.name).toBe("YAML");
    expect(codeLanguageFor("yml")?.name).toBe("YAML");
    expect(codeLanguageFor("bash")?.name).toBe("Shell");
    expect(codeLanguageFor("tsx")?.name).toBe("TypeScript");
  });

  it("finds the language in the attribute form of the info", () => {
    expect(codeLanguageFor('{.python linenums="1"}')?.name).toBe("Python");
  });

  it("treats a missing or unknown language as plain text", () => {
    expect(codeLanguageFor("")).toBeNull();
    expect(codeLanguageFor("text")).toBeNull();
    expect(codeLanguageFor("mermaid")).toBeNull();
  });
});

describe("highlightCodeBlock", () => {
  it("returns tokens that join back to the original code", () => {
    const code = "def f(x):\n    # note\n    return 'a' + 1\n";
    const tokens = highlightCodeBlock("python", code);
    expect(tokens?.map((token) => token.text).join("")).toBe(code);
    expect(tokens).toContainEqual({ text: "def", classes: "tok-keyword" });
    expect(tokens).toContainEqual({ text: "f", classes: "tok-function" });
    expect(tokens).toContainEqual({ text: "# note", classes: "tok-comment" });
    expect(tokens).toContainEqual({ text: "'a'", classes: "tok-string" });
    expect(tokens).toContainEqual({ text: "1", classes: "tok-number" });
  });

  it("highlights stream-based languages", () => {
    const tokens = highlightCodeBlock("sh", 'echo "hi" # done');
    expect(tokens).toContainEqual({ text: '"hi"', classes: "tok-string" });
    expect(tokens).toContainEqual({ text: "# done", classes: "tok-comment" });
  });

  it("highlights embedded languages", () => {
    const tokens = highlightCodeBlock("html", "<script>let a = 1;</script>");
    expect(tokens).toContainEqual({ text: "let", classes: "tok-keyword" });
    expect(tokens).toContainEqual({ text: "script", classes: "tok-type" });
  });

  it("leaves unknown languages alone", () => {
    expect(highlightCodeBlock("mermaid", "graph TD")).toBeUndefined();
  });
});
