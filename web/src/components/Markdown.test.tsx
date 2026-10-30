import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenFence, Markdown } from "./Markdown";

afterEach(cleanup);

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
  });

  it("keeps a still-open fence inside the code block while streaming", () => {
    const { container } = render(<Markdown text={"before\n```ts\nconst a = 1;"} streaming={true} />);
    expect(container.querySelector("pre code")?.textContent).toContain("const a = 1;");
  });

  it("never lets raw HTML through", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} streaming={false} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
