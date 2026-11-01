import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolState } from "../../state/sessionReducer";
import type { Outbound } from "../../types";
import { ToolCard } from "./ToolCard";

declare global {
  interface Window {
    __piSent?: Outbound[];
  }
}

beforeEach(() => {
  window.__piSent = [];
  window.__piNativePost = (message) => window.__piSent?.push(message);
});

afterEach(() => {
  cleanup();
  delete window.__piNativePost;
  delete window.__piSent;
});

function card(tool: ToolState): JSX.Element {
  return <ToolCard callId={tool.callId} name={tool.name} tool={tool} tools={{ [tool.callId]: tool }} />;
}

describe("ToolCard", () => {
  it("renders read paths and file contents, opening the file on click", () => {
    render(
      card({
        callId: "read-1",
        name: "read",
        status: "done",
        args: { path: "src/index.ts", offset: 40, limit: 10 },
        output: "40\tconst x = 1;",
      }),
    );

    expect(screen.getByText("40–49")).toBeDefined();
    expect(screen.getByText(/const x = 1;/)).toBeDefined();

    fireEvent.click(screen.getByTitle("Open src/index.ts:40-49"));
    expect(window.__piSent).toEqual([{ type: "open_path", path: "src/index.ts", line: 40, endLine: 49 }]);
  });

  it("collapses long read output by default", () => {
    render(
      card({
        callId: "read-long",
        name: "read",
        status: "done",
        args: { path: "SKILL.md" },
        output: "line 1\nline 2\nline 3\nline 4",
      }),
    );

    const summary = screen.getByText("content · 4 lines");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);

    fireEvent.click(summary);
    expect(details?.open).toBe(true);
  });

  it("shows the authoritative diff from tool details and jumps to a line", () => {
    render(
      card({
        callId: "edit-1",
        name: "edit",
        status: "done",
        args: { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] },
        details: { diff: "-3 old\n+3 new", firstChangedLine: 3 },
      }),
    );

    expect(screen.getByText("old")).toBeDefined();
    expect(screen.getByText("new")).toBeDefined();
    expect(screen.queryByText("preview")).toBeNull();

    fireEvent.click(screen.getAllByTitle("Open src/a.ts:3")[0]!);
    expect(window.__piSent).toEqual([{ type: "open_path", path: "src/a.ts", line: 3 }]);
  });

  it("labels a running edit as a preview", () => {
    render(
      card({
        callId: "edit-2",
        name: "edit",
        status: "running",
        args: { path: "src/a.ts", edits: [{ oldText: "old", newText: "fresh" }] },
      }),
    );

    expect(screen.getByText("preview")).toBeDefined();
    expect(screen.getByText("old")).toBeDefined();
    expect(screen.getByText("fresh")).toBeDefined();
  });

  it("renders bash commands, streaming output and the full-output link", () => {
    render(
      card({
        callId: "bash-1",
        name: "bash",
        status: "done",
        args: { command: "npm test", timeout: 120 },
        output: "all green",
        details: { fullOutputPath: "/tmp/pi-bash-1.log" },
        fullOutputPath: "/tmp/pi-bash-1.log",
      }),
    );

    expect(screen.getByText("$ npm test")).toBeDefined();
    expect(screen.getByText("all green")).toBeDefined();
    expect(screen.getByText("120s timeout")).toBeDefined();

    fireEvent.click(screen.getByText("Open full output"));
    expect(window.__piSent).toEqual([{ type: "open_path", path: "/tmp/pi-bash-1.log" }]);
  });

  it("turns grep output into clickable hits", () => {
    render(
      card({
        callId: "grep-1",
        name: "grep",
        status: "done",
        args: { pattern: "createTool", path: "src" },
        output: "src/a.ts:12: const x = createTool();\nsrc/b.ts:3: createTool();",
      }),
    );

    expect(screen.getByText("2 hit(s)")).toBeDefined();
    expect(screen.getByText("const x = createTool();")).toBeDefined();

    fireEvent.click(screen.getByTitle("Open src/a.ts:12"));
    expect(window.__piSent).toEqual([{ type: "open_path", path: "src/a.ts", line: 12 }]);
  });

  it("renders nested tool calls under their parent", () => {
    const parent: ToolState = { callId: "parent", name: "task", status: "running", args: { goal: "x" } };
    const child: ToolState = {
      callId: "child",
      name: "read",
      status: "done",
      parentCallId: "parent",
      args: { path: "src/nested.ts" },
      output: "nested body",
    };

    render(
      <ToolCard
        callId="parent"
        name="task"
        tool={parent}
        tools={{ parent, child }}
      />,
    );

    expect(screen.getByText("1 nested call(s)")).toBeDefined();
    expect(screen.getByText("nested body")).toBeDefined();
    expect(screen.getByTitle("Open src/nested.ts")).toBeDefined();
  });

  it("falls back to a JSON card for unknown tools", () => {
    render(
      card({
        callId: "custom-1",
        name: "custom_tool",
        status: "error",
        args: { query: "x" },
        output: "boom",
        isError: true,
      }),
    );

    expect(screen.getByText(/"query": "x"/)).toBeDefined();
    expect(screen.getByText("failed")).toBeDefined();
  });
});
