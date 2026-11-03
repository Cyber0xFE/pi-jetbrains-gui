import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenFence, escapeBackslashEscapes, fileReferenceFromLink, Markdown } from "./Markdown";

afterEach(() => {
  cleanup();
  window.__piNativePost = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("closeOpenFence", () => {
  it("leaves balanced fences untouched", () => {
    const text = "```ts\nconst a = 1;\n```";
    expect(closeOpenFence(text)).toBe(text);
  });

  it("closes an unterminated fence", () => {
    expect(closeOpenFence("text\n```ts\nconst a = 1;")).toBe("text\n```ts\nconst a = 1;\n```");
  });
});

describe("escapeBackslashEscapes", () => {
  it("doubles backslashes before ASCII punctuation", () => {
    expect(escapeBackslashEscapes("C:\\Users\\Bebop\\.pi\\agent")).toBe("C:\\Users\\Bebop\\\\.pi\\agent");
    expect(escapeBackslashEscapes("写 \\* 转义")).toBe("写 \\\\* 转义");
  });

  it("leaves backslashes before letters and digits untouched", () => {
    expect(escapeBackslashEscapes("\\Users\\Bebop2")).toBe("\\Users\\Bebop2");
  });
});

describe("Markdown", () => {
  it("renders user text backslashes literally instead of eating CommonMark escapes", () => {
    const source = "我刚才打开 @C:\\Users\\Bebop\\.pi\\agent\\models-store.json 怎么还有?";
    const { container } = render(<Markdown text={source} streaming={false} userText />);
    expect(container.textContent).toContain("Bebop\\.pi\\agent");
  });

  it("keeps assistant Markdown escape semantics by default", () => {
    const { container } = render(<Markdown text={"C:\\Users\\Bebop\\.pi"} streaming={false} />);
    expect(container.textContent).toContain("Bebop.pi");
  });

  it("keeps file paths inside inline code as code", () => {
    const source = "你指向的 `api/app/agents/specialists.py:154-232` 是 **`QualityReviewAgent`（质量审查 Agent）**。";
    const { container } = render(
      <Markdown text={source} streaming={false} fileReferences={["api/app/agents/specialists.py"]} />,
    );
    expect(container.querySelector(".md-file-reference")).toBeNull();
    expect(container.querySelectorAll("code")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("QualityReviewAgent（质量审查 Agent）");
  });

  it("keeps ordinary inline code containing an operator untouched", () => {
    const source = "Use `a ** b` in the expression.";
    const { container } = render(<Markdown text={source} streaming={false} />);
    expect(container.querySelector("code")?.textContent).toBe("a ** b");
  });

  it("parses line numbers from local file links", () => {
    expect(fileReferenceFromLink("api/app/services/agent_runs.py:499")).toEqual({
      path: "api/app/services/agent_runs.py",
      line: 499,
    });
    expect(fileReferenceFromLink("src/main.kt:12-14")).toEqual({
      path: "src/main.kt",
      line: 12,
      endLine: 14,
    });
    expect(fileReferenceFromLink("src/main.kt#L12")).toEqual({ path: "src/main.kt", line: 12 });
    expect(fileReferenceFromLink("C:/src/main.kt:12")).toEqual({ path: "C:/src/main.kt", line: 12 });
    expect(fileReferenceFromLink("src/main.kt:12", "src/main.kt:12-14")).toEqual({
      path: "src/main.kt",
      line: 12,
      endLine: 14,
    });
  });

  it("renders paragraphs, code and lists", () => {
    const { container } = render(<Markdown text={"hello **world**\n\n- one\n- two"} streaming={false} />);
    expect(container.querySelector("strong")?.textContent).toBe("world");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("highlights fenced code once the message is complete", () => {
    const { container } = render(
      <Markdown text={"```ts\nconst answer: number = 42;\n```"} streaming={false} />,
    );
    expect(container.querySelector("pre code .hljs-keyword")).not.toBeNull();
    expect(container.querySelector(".markdown-card-copy")).not.toBeNull();
  });

  it("keeps a still-open fence inside the code block while streaming", () => {
    const { container } = render(<Markdown text={"before\n```ts\nconst a = 1;"} streaming={true} />);
    expect(container.querySelector("pre code")?.textContent).toContain("const a = 1;");
  });

  it("copies code when clicking the icon and restores it after success feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    const view = render(<Markdown text={"```\nMySQL 业务库\n```"} streaming={false} />);
    const button = view.getByRole("button", { name: "复制代码块" });
    expect(button.textContent).toBe("");
    const icon = button.querySelector("svg")!;
    const original = icon.outerHTML;

    await act(async () => { fireEvent.click(icon.querySelector("path")!); });
    expect(writeText).toHaveBeenCalledWith("MySQL 业务库\n");
    expect(view.getByRole("button", { name: "已复制" }).title).toBe("已复制");
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")?.outerHTML).not.toBe(original);

    act(() => { vi.advanceTimersByTime(1200); });
    expect(view.getByRole("button", { name: "复制代码块" }).title).toBe("复制代码块");
    expect(button.querySelector("svg")?.outerHTML).toBe(original);
  });

  it("never lets raw HTML through", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} streaming={false} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens relative Markdown file links in the IDE", () => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(
      <Markdown text={'[agent-graph.drawio](agent-graph.drawio)'} streaming={false} />,
    );

    fireEvent.click(view.getByRole("link", { name: "agent-graph.drawio" }));

    expect(sent).toEqual([{ type: "open_path", path: "agent-graph.drawio" }]);
  });

  it("opens Markdown file links at their referenced line", () => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(
      <Markdown text={'[api/app/services/agent_runs.py:499](api/app/services/agent_runs.py:499)'} streaming={false} />,
    );

    fireEvent.click(view.getByRole("link", { name: "api/app/services/agent_runs.py:499" }));

    expect(sent).toEqual([{ type: "open_path", path: "api/app/services/agent_runs.py", line: 499 }]);
  });

  it("selects a referenced line range from Markdown file links", () => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(
      <Markdown text={'[api/app/agents/contracts.py:20-31](api/app/agents/contracts.py:20-31)'} streaming={false} />,
    );

    fireEvent.click(view.getByRole("link", { name: "api/app/agents/contracts.py:20-31" }));

    expect(sent).toEqual([{
      type: "open_path",
      path: "api/app/agents/contracts.py",
      line: 20,
      endLine: 31,
    }]);
  });

  it.each([
    { href: "api/app/agents/contracts.py:20", path: "api/app/agents/contracts.py" },
    {
      href: "D:/workspace/ecommerce_operation_assistant/api/app/agents/contracts.py#L20",
      path: "D:/workspace/ecommerce_operation_assistant/api/app/agents/contracts.py",
    },
  ])("keeps the label range when href has only a start line: $href", ({ href, path }) => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(
      <Markdown text={`[api/app/agents/contracts.py:20-31](${href})`} streaming={false} />,
    );

    fireEvent.click(view.getByRole("link", { name: "api/app/agents/contracts.py:20-31" }));

    expect(sent).toEqual([{
      type: "open_path",
      path,
      line: 20,
      endLine: 31,
    }]);
  });

  it("keeps web links opening in the external browser", () => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(<Markdown text={'[draw.io](https://draw.io)'} streaming={false} />);

    fireEvent.click(view.getByRole("link", { name: "draw.io" }));

    expect(sent).toEqual([{ type: "open_url", url: "https://draw.io" }]);
  });
});
