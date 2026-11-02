import { useEffect, useState } from "react";

interface Props {
  src: string;
  alt: string;
  className?: string;
  triggerClassName?: string;
}

/** Displays an image that can be opened in a focused, dismissible preview. */
export function ImagePreview({ src, alt, className, triggerClassName }: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`image-preview-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        onClick={() => setOpen(true)}
        aria-label={`Preview ${alt.toLowerCase()}`}
      >
        <img className={className} src={src} alt={alt} />
      </button>
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
          <img className="image-preview-image" src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
