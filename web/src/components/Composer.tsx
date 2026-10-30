import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import type { PromptImage, SlashCommand } from "../types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  busy: boolean;
  /** Discoverable commands from `get_commands` (plan M3.8). */
  commands: SlashCommand[];
  images: PromptImage[];
  onAddImage: (image: PromptImage) => void;
  onRemoveImage: (index: number) => void;
}

const MAX_SUGGESTIONS = 8;

/** The textarea plus the `/` command menu; sending is triggered by Enter or the footer button. */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  commands,
  images,
  onAddImage,
  onRemoveImage,
}: Props): JSX.Element {
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);

  const query = useMemo(() => {
    const match = /^\/([^\s]*)$/.exec(value);
    if (!match || match[1] === undefined) return null;
    return match[1].toLowerCase();
  }, [value]);

  const matches = useMemo(() => {
    if (query === null) return [];
    return commands
      .filter((command) => command.name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [commands, query]);

  const open = query !== null && matches.length > 0 && !dismissed;

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    rows.current[highlight]?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const comma = result.indexOf(",");
        if (comma >= 0) onAddImage({ mimeType: file.type, data: result.slice(comma + 1) });
      };
      reader.readAsDataURL(file);
      event.preventDefault();
    }
  };

  const handleChange = (next: string): void => {
    setDismissed(false);
    onChange(next);
  };

  const accept = (command: SlashCommand): void => {
    onChange(`/${command.name} `);
    setDismissed(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const chosen = matches[highlight];
        if (chosen) accept(chosen);
        return;
      }
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (!disabled && !busy) onSend();
  };

  return (
    <div className="composer">
      {images.length > 0 && (
        <div className="composer-images" aria-label="Attached images">
          {images.map((image, index) => (
            <div className="composer-image" key={`${image.mimeType}:${index}`}>
              <img src={`data:${image.mimeType};base64,${image.data}`} alt={`Attachment ${index + 1}`} />
              <button type="button" className="composer-image-remove" onClick={() => onRemoveImage(index)} aria-label="Remove image">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="slash-menu" role="listbox" aria-label="Slash commands">
          {matches.map((command, index) => (
            <button
              key={`${command.source}:${command.name}`}
              ref={(element) => {
                rows.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={`slash-row ${index === highlight ? "slash-row-selected" : ""}`}
              onMouseMove={() => setHighlight(index)}
              onClick={() => accept(command)}
            >
              <span className="slash-name">/{command.name}</span>
              {command.description && <span className="slash-description">{command.description}</span>}
              <span className="slash-source">{command.source}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        className="composer-input"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={
          disabled
            ? "pi is not running"
            : "Send a message to pi… (Enter to send, Shift+Enter for a newline, / for commands)"
        }
        rows={3}
        spellCheck={false}
      />
    </div>
  );
}
