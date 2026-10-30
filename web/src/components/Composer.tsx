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
  onCompact: () => void;
  pendingContext?: string | null;
  onClearContext: () => void;
  images: PromptImage[];
  onAddImage: (image: PromptImage) => void;
  onRemoveImage: (index: number) => void;
  /** Abort action for the corner stop button, mirroring the composer's Escape semantics. */
  onAbort: () => void;
}

const MAX_SUGGESTIONS = 8;
const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Compact the session context", source: "built-in" },
];

/** The textarea, its corner send/stop button and the `/` command menu; sending is triggered by Enter or the corner button. */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  commands,
  onCompact,
  pendingContext,
  onClearContext,
  images,
  onAddImage,
  onRemoveImage,
  onAbort,
}: Props): JSX.Element {
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const query = useMemo(() => {
    const match = /^\/([^\s]*)$/.exec(value);
    if (!match || match[1] === undefined) return null;
    return match[1].toLowerCase();
  }, [value]);

  const availableCommands = useMemo(() => {
    const names = new Set(commands.map((command) => command.name.toLowerCase()));
    return [...BUILTIN_COMMANDS.filter((command) => !names.has(command.name.toLowerCase())), ...commands];
  }, [commands]);

  const matches = useMemo(() => {
    if (query === null) return [];
    return availableCommands
      .filter((command) => command.name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [availableCommands, query]);

  const open = query !== null && matches.length > 0 && !dismissed;

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    rows.current[highlight]?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.4)}px`;
    element.style.overflowY = element.scrollHeight > element.clientHeight ? "auto" : "hidden";
  }, [value]);

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
    if (event.key === "Enter" && !event.shiftKey && !disabled && !busy && /^\/compact$/.test(value.trim())) {
      event.preventDefault();
      onChange("");
      onCompact();
      return;
    }
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
    if (disabled || busy) return;
    onSend();
  };

  return (
    <div className="composer">
      {pendingContext && (
        <div className="context-attachment" title={pendingContext}>
          <span className="context-attachment-icon">⌁</span>
          <span className="context-attachment-label">{pendingContext}</span>
          <span className="context-attachment-hint">selected code</span>
          <button type="button" className="context-attachment-remove" onClick={onClearContext} aria-label="Remove selected code context">
            ×
          </button>
        </div>
      )}
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
      <div className="composer-input-wrap">
        <textarea
          aria-label="Message to pi"
          aria-multiline="true"
          ref={textarea}
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
        {busy ? (
          <button type="button" className="composer-send composer-send-stop" onClick={onAbort} title="Stop" aria-label="Stop">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            onClick={onSend}
            disabled={disabled || (value.trim().length === 0 && images.length === 0)}
            title="Send"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4 22 12 3.4 3.6v6.53L15 12 3.39 13.87z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
