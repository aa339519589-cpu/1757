import { describe, expect, it } from "vitest";
import { extractJsonPath, renderTemplate, requireMappedValue } from "./json-path";

describe("extractJsonPath", () => {
  it("reads dot, index, and quoted-key paths", () => {
    const value = { data: [{ result: { "asset-url": "https://example.com/a.png" } }] };
    expect(extractJsonPath(value, "$.data[0].result['asset-url']")).toBe("https://example.com/a.png");
  });

  it("returns undefined when a segment is missing", () => {
    expect(extractJsonPath({ data: {} }, "$.data.missing.value")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("preserves the original type for an exact placeholder", () => {
    expect(renderTemplate("{{ count }}", { count: 4 })).toBe(4);
  });

  it("interpolates placeholders inside strings and nested objects", () => {
    expect(renderTemplate({ prompt: "Create {{ subject }}", options: ["{{ size }}"] }, { subject: "a poster", size: "1024x1024" })).toEqual({
      prompt: "Create a poster",
      options: ["1024x1024"],
    });
  });
});

describe("requireMappedValue", () => {
  it("returns a mapped value and rejects an empty mapping", () => {
    expect(requireMappedValue({ task: { id: "abc" } }, "$.task.id", "a task ID")).toBe("abc");
    expect(() => requireMappedValue({ task: {} }, "$.task.id", "a task ID")).toThrow("The response did not contain a task ID");
  });
});
