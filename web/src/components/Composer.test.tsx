import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState, type JSX } from "react";
import { Composer } from "./Composer";

afterEach(cleanup);

/** Stateful wrapper so ↑/↓ history navigation can drive the controlled value like App does. */
function HistoryHarness({ history, initialValue = "" }: { history: string[]; initialValue?: string }): JSX.Element {
  const [value, setValue] = useState(initialValue);
  return (
    <Composer
      value={value}
      onChange={setValue}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={() => undefined}
      history={history}
    />
  );
}

it("opens pending images in a dismissible preview without removing them", () => {
  const onRemoveImage = vi.fn();
  const view = render(
    <Composer
      value=""
      onChange={() => undefined}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[{ data: "aGVsbG8=", mimeType: "image/png" }]}
      onAddImage={() => undefined}
      onRemoveImage={onRemoveImage}
      onAbort={() => undefined}
      onDequeue={() => undefined}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Preview attachment 1" }));
  expect(view.getByRole("dialog", { name: "Image preview" })).toBeDefined();
  expect(view.getByRole("button", { name: "Close image preview" })).toBeDefined();

  fireEvent.click(view.getByRole("button", { name: "Close image preview" }));
  expect(view.queryByRole("dialog", { name: "Image preview" })).toBeNull();
  expect(onRemoveImage).not.toHaveBeenCalled();
});

it("offers /btw as a built-in command when the composer starts with /", () => {
  const view = render(
    <Composer
      value="/"
      onChange={() => undefined}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={() => undefined}
    />,
  );

  const menu = view.getByRole("listbox", { name: "Slash commands" });
  expect(menu.textContent).toContain("/btw");
  expect(menu.textContent).toContain("Ask a side question without adding it to the session");
});

it("restores queued messages for editing with Alt+Up", () => {
  const onDequeue = vi.fn();
  const view = render(
    <Composer
      value=""
      onChange={() => undefined}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={onDequeue}
    />,
  );
  const input = view.getByRole("textbox", { name: "Message to pi" });

  fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
  expect(onDequeue).toHaveBeenCalledTimes(1);

  // Without Alt the arrow key is left to the browser.
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(onDequeue).toHaveBeenCalledTimes(1);
});

it("tints the composer and shows a bash badge while the draft starts with !", () => {
  const view = render(
    <Composer
      value="! npm"
      onChange={() => undefined}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={() => undefined}
    />,
  );

  const input = view.getByRole("textbox", { name: "Shell command to run" });
  expect(input.className).toContain("composer-input-bash");
  expect(view.container.querySelector(".bash-mode-badge")).not.toBeNull();
});

it("keeps the normal composer chrome for a mid-text exclamation mark", () => {
  const view = render(
    <Composer
      value="why is this slow!"
      onChange={() => undefined}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={() => undefined}
    />,
  );

  expect(view.getByRole("textbox", { name: "Message to pi" }).className).not.toContain("composer-input-bash");
});

it("recalls session prompts with ↑/↓ like the pi TUI editor", () => {
  const view = render(<HistoryHarness history={["newer prompt", "older prompt"]} />);
  const input = view.getByRole("textbox", { name: "Message to pi" }) as HTMLTextAreaElement;

  // ↑ from an empty composer fills the most recent prompt, further ↑ walks older ones.
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("newer prompt");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("older prompt");

  // ↓ walks back toward the draft, ending with the empty in-progress text.
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("newer prompt");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("");

  // Browsing restarted from an empty composer begins at the most recent prompt again.
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("newer prompt");
});

it("keeps the in-progress draft while browsing and editing exits history mode", () => {
  const view = render(<HistoryHarness history={["saved prompt"]} initialValue="draft text" />);
  const input = view.getByRole("textbox", { name: "Message to pi" }) as HTMLTextAreaElement;

  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("saved prompt");

  // ↓ past the newest entry restores the untouched draft.
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("draft text");

  // Editing the draft exits browsing: a later ↓ leaves the text alone.
  input.setSelectionRange(0, 0);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("saved prompt");
  fireEvent.change(input, { target: { value: "saved prompt!" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("saved prompt!");
});

it("does not open history when ↑ is pressed away from the very start of the text", () => {
  const onChange = vi.fn();
  const view = render(
    <Composer
      value="multi
line draft"
      onChange={onChange}
      focusRequest={0}
      onSend={() => undefined}
      disabled={false}
      busy={false}
      commands={[]}
      files={[]}
      onCompact={() => undefined}
      onOpenTree={() => undefined}
      pendingContext={null}
      onClearContext={() => undefined}
      images={[]}
      onAddImage={() => undefined}
      onRemoveImage={() => undefined}
      onAbort={() => undefined}
      onDequeue={() => undefined}
      history={["saved prompt"]}
    />,
  );
  const input = view.getByRole("textbox", { name: "Message to pi" }) as HTMLTextAreaElement;
  input.setSelectionRange("multi\n".length, "multi\n".length);

  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(onChange).not.toHaveBeenCalled();

  // But from the very start of the text history browsing still opens.
  input.setSelectionRange(0, 0);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(onChange).toHaveBeenCalledWith("saved prompt");
});
