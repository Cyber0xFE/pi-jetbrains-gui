import { describe, expect, it } from "vitest";
import { parseDetailsDiff, previewDiff } from "./diff";

describe("previewDiff", () => {
  it("marks added and removed lines", () => {
    const rows = previewDiff("a\nb\nc\n", "a\nB\nc\n");

    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "delete", text: "b" },
      { kind: "add", text: "B" },
      { kind: "context", text: "c" },
    ]);
  });

  it("folds long unchanged runs into a skip row", () => {
    const before = ["head", ...Array.from({ length: 20 }, (_, i) => `line${i}`), "tail"];
    const after = ["HEAD", ...before.slice(1, -1), "TAIL"];
    const rows = previewDiff(before.join("\n"), after.join("\n"), 2);

    expect(rows.filter((row) => row.kind === "skip")).toHaveLength(1);
    expect(rows.some((row) => row.text === "line10")).toBe(false);
  });
});

describe("parseDetailsDiff", () => {
  it("parses pi's display diff including skipped context", () => {
    const rows = parseDetailsDiff([" 1 context", "-2 old", "+2 new", "   ...", " 9 tail"].join("\n"));

    expect(rows).toEqual([
      { kind: "context", line: 1, text: "context" },
      { kind: "delete", line: 2, text: "old" },
      { kind: "add", line: 2, text: "new" },
      { kind: "skip", text: "…" },
      { kind: "context", line: 9, text: "tail" },
    ]);
  });

  it("keeps unparseable lines as plain context instead of dropping them", () => {
    expect(parseDetailsDiff("not a diff line")).toEqual([{ kind: "context", text: "not a diff line" }]);
  });
});
