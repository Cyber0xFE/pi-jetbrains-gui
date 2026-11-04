import { useEffect, useRef, useState } from "react";
import { post } from "../bridge";
import type { PromptImage } from "../types";

interface Props {
  src: string;
  alt: string;
  className?: string;
  triggerClassName?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/** Matches the `data:<mime>;base64,<data>` URLs this app renders for images. */
const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/;

/** Extracts the base64 payload and MIME type so the host can copy the image bytes. */
export function parseImageDataUrl(src: string): PromptImage | null {
  const match = DATA_URL_PATTERN.exec(src);
  if (!match) return null;
  const mimeType = match[1];
  const data = match[2];
  return mimeType !== undefined && data !== undefined ? { mimeType, data } : null;
}

interface Offset {
  x: number;
  y: number;
}

const CONTEXT_MENU_WIDTH = 140;
const CONTEXT_MENU_HEIGHT = 40;

/** Displays an image that can be opened in a focused, dismissible preview with wheel zoom and drag pan. */
export function ImagePreview({ src, alt, className, triggerClassName }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<Offset | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ pointerId: number; startOffset: Offset; startClient: Offset } | null>(null);
  const imageData = parseImageDataUrl(src);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Escape dismisses the context menu first, then the preview itself.
      if (menu) setMenu(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, menu]);

  // Close the context menu on any interaction outside of it.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Reset zoom/pan and any open context menu whenever the preview opens or the image changes.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    setMenu(null);
    dragState.current = null;
  }, [open, src]);

  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!imageData) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const copyImage = (): void => {
    if (!imageData) return;
    post({ type: "copy_image", images: [imageData] });
    setMenu(null);
  };

  // Wheel zoom is attached non-passively so we can preventDefault the page scroll.
  useEffect(() => {
    if (!open) return;
    const image = imageRef.current;
    if (!image) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = image.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      setScale((prevScale) => {
        const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor));
        if (nextScale === prevScale) return prevScale;
        // Keep the point under the cursor fixed while zooming.
        setOffset((prevOffset) => {
          if (nextScale === MIN_SCALE) return { x: 0, y: 0 };
          const cx = event.clientX - centerX;
          const cy = event.clientY - centerY;
          const ratio = nextScale / prevScale;
          return {
            x: cx - (cx - prevOffset.x) * ratio,
            y: cy - (cy - prevOffset.y) * ratio,
          };
        });
        return nextScale;
      });
    };
    image.addEventListener("wheel", handleWheel, { passive: false });
    return () => image.removeEventListener("wheel", handleWheel);
  }, [open]);

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (scale <= MIN_SCALE) return;
    event.preventDefault();
    event.stopPropagation();
    imageRef.current?.setPointerCapture?.(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startOffset: offset,
      startClient: { x: event.clientX, y: event.clientY },
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>): void => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setOffset({
      x: state.startOffset.x + (event.clientX - state.startClient.x),
      y: state.startOffset.y + (event.clientY - state.startClient.y),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    dragState.current = null;
    setDragging(false);
  };

  const zoomed = scale > MIN_SCALE;

  return (
    <>
      <button
        type="button"
        className={`image-preview-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        onClick={() => setOpen(true)}
        aria-label={`Preview ${alt.toLowerCase()}`}
      >
        <img className={className} src={src} alt={alt} onContextMenu={handleContextMenu} />
      </button>
      {menu && imageData && (
        <div
          className="image-context-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - CONTEXT_MENU_WIDTH),
            top: Math.min(menu.y, window.innerHeight - CONTEXT_MENU_HEIGHT),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={copyImage}>
            Copy image
          </button>
        </div>
      )}
      {open && (
        <div
          className="image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="image-preview-close"
            onClick={() => setOpen(false)}
            aria-label="Close image preview"
            title="Close"
          >
            ×
          </button>
          <img
            ref={imageRef}
            className={`image-preview-image${zoomed ? " zoomed" : ""}${dragging ? " dragging" : ""}`}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            src={src}
            alt={alt}
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={handleContextMenu}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      )}
    </>
  );
}
