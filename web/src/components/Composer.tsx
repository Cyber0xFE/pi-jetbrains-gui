import type { KeyboardEvent } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  busy: boolean;
}

/** The textarea only; sending is triggered by Enter or the footer button. */
export function Composer({ value, onChange, onSend, disabled, busy }: Props): JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (!disabled && !busy) onSend();
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "pi is not running" : "Send a message to pi… (Enter to send, Shift+Enter for a newline)"}
        rows={3}
        spellCheck={false}
      />
    </div>
  );
}
