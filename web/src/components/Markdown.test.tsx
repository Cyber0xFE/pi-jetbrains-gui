import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenFence, Markdown } from "./Markdown";

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

describe("Markdown", () => {
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

  it("keeps web links opening in the external browser", () => {
    const sent: unknown[] = [];
    window.__piNativePost = (message) => sent.push(message);
    const view = render(<Markdown text={'[draw.io](https://draw.io)'} streaming={false} />);

    fireEvent.click(view.getByRole("link", { name: "draw.io" }));

    expect(sent).toEqual([{ type: "open_url", url: "https://draw.io" }]);
  });
});
