import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreview } from "./ImagePreview";

afterEach(cleanup);

function openPreview(): void {
  render(<ImagePreview src="data:image/png;base64,abc" alt="Screenshot" />);
  fireEvent.click(screen.getByRole("button", { name: "Preview screenshot" }));
}

function previewImage(): HTMLImageElement {
  return screen.getByRole("dialog", { name: "Image preview" }).querySelector("img") as HTMLImageElement;
}

/** jsdom has no PointerEvent; use MouseEvent plus a manual pointerId instead. */
function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { pointerId: number; clientX: number; clientY: number },
): void {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as MouseEvent & {
    pointerId: number;
  };
  event.pointerId = init.pointerId;
  fireEvent(target, event);
}

describe("ImagePreview", () => {
  it("opens a preview dialog from the trigger", () => {
    render(<ImagePreview src="data:image/png;base64,abc" alt="Screenshot" />);
    expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview screenshot" }));
    expect(screen.getByRole("dialog", { name: "Image preview" })).not.toBeNull();
  });

  it("zooms with the mouse wheel and clamps the scale", () => {
    openPreview();
    const image = previewImage();

    for (let i = 0; i < 3; i++) fireEvent.wheel(image, { deltaY: -100 });
    expect(image.style.transform).toContain("scale(");
    expect(Number(image.style.transform.match(/scale\(([\d.]+)\)/)![1])).toBeCloseTo(1.728, 3);

    for (let i = 0; i < 20; i++) fireEvent.wheel(image, { deltaY: 100 });
    expect(Number(image.style.transform.match(/scale\(([\d.]+)\)/)![1])).toBe(1);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("keeps the cursor point fixed while zooming", () => {
    openPreview();
    const image = previewImage();
    // jsdom rects are zero-sized, so the container center is (0, 0) and the
    // cursor position directly drives the pan offset.
    fireEvent.wheel(image, { deltaY: -100, clientX: -60, clientY: -30 });
    // ratio = 1.2, offset = c - (c - 0) * ratio = c * (1 - 1.2)
    expect(image.style.transform).toBe("translate(12px, 6px) scale(1.2)");
  });

  it("drags the zoomed image with the pointer and stops on release", () => {
    openPreview();
    const image = previewImage();
    fireEvent.wheel(image, { deltaY: -100 });

    firePointer(image, "pointerdown", { pointerId: 1, clientX: 100, clientY: 50 });
    firePointer(image, "pointermove", { pointerId: 1, clientX: 130, clientY: 20 });
    expect(image.style.transform).toBe("translate(30px, -30px) scale(1.2)");

    firePointer(image, "pointerup", { pointerId: 1, clientX: 130, clientY: 20 });
    firePointer(image, "pointermove", { pointerId: 1, clientX: 200, clientY: 200 });
    expect(image.style.transform).toBe("translate(30px, -30px) scale(1.2)");
  });

  it("does not drag when not zoomed", () => {
    openPreview();
    const image = previewImage();

    firePointer(image, "pointerdown", { pointerId: 1, clientX: 100, clientY: 50 });
    firePointer(image, "pointermove", { pointerId: 1, clientX: 150, clientY: 90 });
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("resets zoom when the preview is reopened", () => {
    render(<ImagePreview src="data:image/png;base64,abc" alt="Screenshot" />);
    const trigger = screen.getByRole("button", { name: "Preview screenshot" });

    fireEvent.click(trigger);
    let image = previewImage();
    fireEvent.wheel(image, { deltaY: -100 });
    expect(image.style.transform).not.toBe("translate(0px, 0px) scale(1)");

    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    fireEvent.click(trigger);
    image = previewImage();
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("offers Copy image in a context menu on the preview and posts the payload to the host", () => {
    const nativePost = vi.fn();
    window.__piNativePost = nativePost as unknown as typeof window.__piNativePost;
    try {
      openPreview();
      const image = previewImage();
      expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();

      fireEvent.contextMenu(image, { clientX: 40, clientY: 30 });
      const item = screen.getByRole("menuitem", { name: "Copy image" });
      expect(item.closest(".image-context-menu")).not.toBeNull();

      fireEvent.click(item);
      expect(nativePost).toHaveBeenCalledWith({
        type: "copy_image",
        images: [{ data: "abc", mimeType: "image/png" }],
      });
      expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();
    } finally {
      delete window.__piNativePost;
    }
  });

  it("offers Copy image from the inline trigger thumbnail too", () => {
    const nativePost = vi.fn();
    window.__piNativePost = nativePost as unknown as typeof window.__piNativePost;
    try {
      render(<ImagePreview src="data:image/jpeg;base64,xyz" alt="Screenshot" />);
      const triggerImage = screen.getByRole("button", { name: "Preview screenshot" }).querySelector("img")!;

      fireEvent.contextMenu(triggerImage, { clientX: 10, clientY: 10 });
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
      expect(nativePost).toHaveBeenCalledWith({
        type: "copy_image",
        images: [{ data: "xyz", mimeType: "image/jpeg" }],
      });
      expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
    } finally {
      delete window.__piNativePost;
    }
  });

  it("closes the context menu on Escape before closing the preview", () => {
    openPreview();
    fireEvent.contextMenu(previewImage(), { clientX: 40, clientY: 30 });
    expect(screen.getByRole("menuitem", { name: "Copy image" })).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Image preview" })).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
  });

  it("closes the context menu when clicking elsewhere", () => {
    openPreview();
    fireEvent.contextMenu(previewImage(), { clientX: 40, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy image" }).closest(".image-context-menu")!, { detail: 0 });
    expect(screen.getByRole("menuitem", { name: "Copy image" })).not.toBeNull();

    fireEvent.mouseDown(window);
    expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();
  });

  it("does not open a context menu for non-data URLs", () => {
    render(<ImagePreview src="/assets/photo.png" alt="Screenshot" />);
    const triggerImage = screen.getByRole("button", { name: "Preview screenshot" }).querySelector("img")!;

    fireEvent.contextMenu(triggerImage, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();
  });
});
