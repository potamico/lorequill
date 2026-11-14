import { describe, expect, it } from "vitest";
import { parsePropertiesHostMessage, parsePropertiesWebviewMessage } from "../../src";

describe("parsePropertiesWebviewMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parsePropertiesWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parsePropertiesWebviewMessage({ type: "set", key: "title", value: "A" })).toEqual({
      type: "set",
      key: "title",
      value: "A",
    });
    expect(parsePropertiesWebviewMessage({ type: "set", key: "tags", value: ["a", "b"] })).toEqual({
      type: "set",
      key: "tags",
      value: ["a", "b"],
    });
    expect(parsePropertiesWebviewMessage({ type: "set", key: "public", value: false })).toEqual({
      type: "set",
      key: "public",
      value: false,
    });
    expect(parsePropertiesWebviewMessage({ type: "insertDefault", key: "status" })).toEqual({
      type: "insertDefault",
      key: "status",
    });
    expect(parsePropertiesWebviewMessage({ type: "chooseCollection", id: "concept" })).toEqual({
      type: "chooseCollection",
      id: "concept",
    });
  });

  it("rejects malformed or oversized messages", () => {
    for (const message of [
      null,
      "set",
      { type: "edit" },
      { type: "ready", extra: 1 },
      { type: "set", key: "", value: "x" },
      { type: "set", key: "title" },
      { type: "set", key: "title", value: 3 },
      { type: "set", key: "title", value: { nested: true } },
      { type: "set", key: "tags", value: ["a", 1] },
      { type: "set", key: "title", value: "x".repeat(64 * 1024 + 1) },
      { type: "set", key: "k".repeat(257), value: "x" },
      { type: "set", key: "tags", value: Array.from({ length: 1001 }, () => "a") },
      { type: "insertDefault" },
    ]) {
      expect(parsePropertiesWebviewMessage(message)).toBeUndefined();
    }
  });
});

describe("parsePropertiesHostMessage", () => {
  it("accepts models and notices and requires every label", () => {
    expect(parsePropertiesHostMessage({ type: "model", model: { status: "empty" } })).toEqual({
      type: "model",
      model: { status: "empty" },
    });
    expect(parsePropertiesHostMessage({ type: "notice", message: "x" })).toEqual({
      type: "notice",
      message: "x",
    });
    expect(parsePropertiesHostMessage({ type: "labels", labels: { empty: "x" } })).toBeUndefined();
    expect(
      parsePropertiesHostMessage({ type: "model", model: { status: "other" } }),
    ).toBeUndefined();
  });
});
