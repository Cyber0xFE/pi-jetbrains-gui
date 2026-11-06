import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

afterEach(cleanup);

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
    />,
  );

  const menu = view.getByRole("listbox", { name: "Slash commands" });
  expect(menu.textContent).toContain("/btw");
  expect(menu.textContent).toContain("Ask a side question without adding it to the session");
});
