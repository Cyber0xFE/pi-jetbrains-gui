import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import type { PromptImage, SlashCommand } from "../types";
import { ImagePreview } from "./ImagePreview";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Incremented when native actions place text in the composer. */
  focusRequest: number;
  onSend: () => void;
  disabled: boolean;
  busy: boolean;
  /** Discoverable commands from `get_commands` (plan M3.8). */
  commands: SlashCommand[];
  /** Project-relative files available for @ references. */
  files: string[];
  onCompact: () => void;
  onOpenTree: () => void;
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
  { name: "tree", description: "Open the current session tree", source: "built-in" },
  { name: "btw", description: "Ask a side question without adding it to the session", source: "built-in" },
];

/** The textarea, its corner send/stop button and the `/` command menu; sending is triggered by Enter or the corner button. */
export function Composer({
  value,
  onChange,
  focusRequest,
  onSend,
  disabled,
  busy,
  commands,
  files,
  onCompact,
  onOpenTree,
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
  const fileRows = useRef<Array<HTMLButtonElement | null>>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const fileQuery = useMemo(() => {
    const match = /(^|\s)@([^\s]*)$/.exec(value);
    if (!match || match[2] === undefined || match.index === undefined) return null;
    const queryText = match[2];
    return {
      text: queryText.toLowerCase(),
      start: match.index + (match[1]?.length ?? 0),
      end: value.length,
    };
  }, [value]);

  const fileMatches = useMemo(() => {
    if (fileQuery === null) return [];
    return files.filter((file) => file.toLowerCase().includes(fileQuery.text));
  }, [fileQuery, files]);

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
      .filter((command) => {
        const searchable = `${command.name} ${command.description ?? ""}`.toLowerCase();
        return searchable.includes(query);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [availableCommands, query]);

  const open = query !== null && matches.length > 0 && !dismissed;
  const filesOpen = fileQuery !== null && fileMatches.length > 0 && !dismissed;

  useEffect(() => {
    setHighlight(0);
  }, [query, fileQuery?.text]);

  useEffect(() => {
    if (filesOpen) fileRows.current[highlight]?.scrollIntoView?.({ block: "nearest" });
    else if (open) rows.current[highlight]?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open, filesOpen]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.4)}px`;
    element.style.overflowY = element.scrollHeight > element.clientHeight ? "auto" : "hidden";
  }, [value]);

  useEffect(() => {
    if (focusRequest === 0) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [focusRequest]);

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

  const acceptFile = (file: string): void => {
    if (!fileQuery) return;
    onChange(`${value.slice(0, fileQuery.start)}@${file} ${value.slice(fileQuery.end)}`);
    setDismissed(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !disabled && !busy) {
      const command = value.trim();
      if (command === "/compact") {
        event.preventDefault();
        onChange("");
        onCompact();
        return;
      }
      if (command === "/tree") {
        event.preventDefault();
        onChange("");
        onOpenTree();
        return;
      }
    }
    if (filesOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % fileMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => (current - 1 + fileMatches.length) % fileMatches.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const chosen = fileMatches[highlight];
        if (chosen) acceptFile(chosen);
        return;
      }
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
              <ImagePreview
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={`Attachment ${index + 1}`}
                triggerClassName="composer-image-preview"
              />
              <button type="button" className="composer-image-remove" onClick={() => onRemoveImage(index)} aria-label="Remove image">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {filesOpen && (
        <div className="slash-menu file-menu" role="listbox" aria-label="Referenced files">
          {fileMatches.map((file, index) => (
            <button
              key={file}
              ref={(element) => {
                fileRows.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={`slash-row ${index === highlight ? "slash-row-selected" : ""}`}
              onMouseMove={() => setHighlight(index)}
              onClick={() => acceptFile(file)}
            >
              <span className="file-reference-at">@</span>
              <span className="slash-name">{file}</span>
            </button>
          ))}
        </div>
      )}
      {open && !filesOpen && (
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
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            onClick={onSend}
            disabled={disabled || (value.trim().length === 0 && images.length === 0 && !pendingContext)}
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
