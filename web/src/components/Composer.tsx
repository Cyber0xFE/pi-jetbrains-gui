import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, JSX, KeyboardEvent } from "react";
import type { PromptImage, SlashCommand } from "../types";
import { useI18n } from "../i18n";
import { ImagePreview } from "./ImagePreview";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Incremented when native actions place text in the composer. */
  focusRequest: number;
  onSend: (followUp?: boolean) => void;
  disabled: boolean;
  busy: boolean;
  /** True while pi is streaming: Enter steers and Alt+Enter queues a follow-up, like the pi TUI. */
  steering?: boolean;
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
  /** Restores all queued steering/follow-up messages to the composer (pi TUI Alt+Up). */
  onDequeue: () => void;
  /** Recent user prompts of the current session for ↑/↓ recall, newest first (pi TUI editor history). */
  history?: string[];
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
  steering = false,
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
  onDequeue,
  history = [],
}: Props): JSX.Element {
  const { t } = useI18n();
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Prompt history browsing like the pi TUI editor: -1 = not browsing, 0 = most recent,
  // 1 = older, etc. `historyDraft` keeps the in-progress text so ↓ can restore it.
  const historyIndex = useRef(-1);
  const historyDraft = useRef<string | null>(null);
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
    const localizedBuiltins = BUILTIN_COMMANDS.map((command) => ({
      ...command,
      description: command.name === "compact" ? t("compactDescription") : command.name === "tree" ? t("treeDescription") : t("thinkingDescription"),
    }));
    const names = new Set(commands.map((command) => command.name.toLowerCase()));
    return [...localizedBuiltins.filter((command) => !names.has(command.name.toLowerCase())), ...commands];
  }, [commands, t]);

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

  // Leaving history browsing whenever the composer returns to empty (send, dequeue edit) or the
  // session's messages change (new send, fork, session switch) — mirrors the TUI's resets.
  useEffect(() => {
    if (value === "") {
      historyIndex.current = -1;
      historyDraft.current = null;
    }
  }, [value]);
  useEffect(() => {
    historyIndex.current = -1;
    historyDraft.current = null;
  }, [history]);

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
    // Editing the draft exits history browsing, like the TUI editor's editing operations.
    historyIndex.current = -1;
    historyDraft.current = null;
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

  /** Walks the prompt history; ↑ (direction -1) goes older, ↓ goes newer or restores the draft. */
  const navigateHistory = (direction: 1 | -1): void => {
    if (history.length === 0) return;
    const newIndex = historyIndex.current - direction;
    if (newIndex < -1 || newIndex >= history.length) return;
    if (historyIndex.current === -1 && newIndex >= 0) {
      historyDraft.current = value;
    }
    historyIndex.current = newIndex;
    const next = newIndex === -1 ? historyDraft.current ?? "" : history[newIndex] ?? "";
    if (newIndex === -1) historyDraft.current = null;
    onChange(next);
    // Like the TUI: caret to the start when walking to older prompts, the end otherwise.
    const caret = direction === -1 ? 0 : next.length;
    window.requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Restore queued messages for editing, like the pi TUI's Alt+Up; skipped while a completion
    // menu is open so the arrow keys keep navigating it.
    if (event.altKey && event.key === "ArrowUp" && !filesOpen && !open) {
      event.preventDefault();
      onDequeue();
      return;
    }
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
    // Prompt history recall like the pi TUI editor: ↑ at the very start of the text (or while
    // already browsing) walks to older prompts, ↓ at the very end walks back toward the draft.
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "ArrowUp" && (historyIndex.current > -1 || (textarea.current?.selectionStart ?? value.length) === 0)) {
        event.preventDefault();
        navigateHistory(-1);
        return;
      }
      if (event.key === "ArrowDown" && historyIndex.current > -1 && (textarea.current?.selectionEnd ?? 0) >= value.length) {
        event.preventDefault();
        navigateHistory(1);
        return;
      }
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (disabled) return;
    // While compacting the input stays blocked; while streaming the message is queued (steer).
    if (busy && !steering) return;
    onSend(event.altKey);
  };

  const canSend = value.trim().length > 0 || images.length > 0 || Boolean(pendingContext);
  // With room to steer, the corner button queues the message; otherwise it stops the run.
  const showStop = busy && (!steering || !canSend);
  // Like the pi TUI's bash-mode editor tint: a leading `!` runs as a shell command.
  const bashMode = value.trimStart().startsWith("!");
  return (
    <div className="composer">
      {pendingContext && (
        <div className="context-attachment" title={pendingContext}>
          <span className="context-attachment-icon">⌁</span>
          <span className="context-attachment-label">{pendingContext}</span>
          <span className="context-attachment-hint">{t("selectedCode")}</span>
          <button type="button" className="context-attachment-remove" onClick={onClearContext} aria-label={t("removeSelectedCode")}>
            ×
          </button>
        </div>
      )}
      {images.length > 0 && (
        <div className="composer-images" aria-label={t("attachedImages")}>
          {images.map((image, index) => (
            <div className="composer-image" key={`${image.mimeType}:${index}`}>
              <ImagePreview
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={t("attachment", { index: index + 1 })}
                triggerClassName="composer-image-preview"
              />
              <button type="button" className="composer-image-remove" onClick={() => onRemoveImage(index)} aria-label={t("removeImage")}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {filesOpen && (
        <div className="slash-menu file-menu" role="listbox" aria-label={t("referencedFiles")}>
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
        <div className="slash-menu" role="listbox" aria-label={t("slashCommands")}>
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
      <div className={`composer-input-wrap${bashMode ? " composer-bash-mode" : ""}`}>
        <textarea
          aria-label={bashMode ? t("shellCommand") : t("messageToPi")}
          aria-multiline="true"
          ref={textarea}
          className={`composer-input${bashMode ? " composer-input-bash" : ""}`}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? t("piNotRunning")
              : bashMode
                ? t("shellPlaceholder")
                : steering
                  ? t("streamingPlaceholder")
                  : t("messagePlaceholder")
          }
          rows={3}
          spellCheck={false}
        />
        {bashMode && <span className="bash-mode-badge" aria-hidden="true">bash</span>}
        {showStop ? (
          <button type="button" className="composer-send composer-send-stop" onClick={onAbort} title={t("stop")} aria-label={t("stop")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            onClick={() => onSend(false)}
            disabled={disabled || !canSend}
            title={steering ? t("steer") : t("send")}
            aria-label={steering ? t("steer") : t("send")}
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
