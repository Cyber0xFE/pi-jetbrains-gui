import { useEffect, useRef, type KeyboardEvent } from "react";

interface Props {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Compile error shown instead of the match counter. */
  error: string | null;
  /** Total number of matches across the transcript. */
  count: number;
  /** 1-based position of the active match; 0 when there are no matches. */
  index: number;
  /** Incremented by App on Ctrl+F to (re)focus and select the input. */
  focusRequest: number;
  onChange: (query: string) => void;
  onToggle: (option: "caseSensitive" | "wholeWord" | "regex") => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** Overlay find bar for the conversation; opened with Ctrl+F from the host WebView. */
export function SearchBar({
  query,
  caseSensitive,
  wholeWord,
  regex,
  error,
  count,
  index,
  focusRequest,
  onChange,
  onToggle,
  onPrevious,
  onNext,
  onClose,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusRequest]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const toggles: Array<{ key: "caseSensitive" | "wholeWord" | "regex"; label: string; title: string }> = [
    { key: "caseSensitive", label: "Aa", title: "区分大小写" },
    { key: "wholeWord", label: "ab", title: "全字匹配" },
    { key: "regex", label: ".*", title: "正则表达式" },
  ];

  return (
    <div className="search-bar" role="search" aria-label="搜索消息内容">
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        value={query}
        autoFocus
        spellCheck={false}
        placeholder="搜索消息…"
        aria-label="搜索消息"
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {toggles.map(({ key, label, title }) => (
        <button
          key={key}
          type="button"
          className="search-toggle"
          aria-pressed={key === "caseSensitive" ? caseSensitive : key === "wholeWord" ? wholeWord : regex}
          title={title}
          aria-label={title}
          onClick={() => onToggle(key)}
        >
          {label}
        </button>
      ))}
      <span className={`search-status${error ? " search-status-error" : ""}`} role="status" aria-live="polite">
        {error ?? (count > 0 ? `${index}/${count}` : "无结果")}
      </span>
      <button type="button" className="search-button" aria-label="上一个匹配" title="上一个匹配 (Shift+Enter)" onClick={onPrevious}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
      </button>
      <button type="button" className="search-button" aria-label="下一个匹配" title="下一个匹配 (Enter)" onClick={onNext}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <button type="button" className="search-button" aria-label="关闭搜索" title="关闭 (Esc)" onClick={onClose}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
      </button>
    </div>
  );
}
