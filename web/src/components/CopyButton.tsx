import { useState } from "react";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    return true;
  } catch {
    return false;
  }
}

interface Props {
  text: string;
  className?: string;
  title?: string;
  iconOnly?: boolean;
}

export function CopyButton({ text, className = "", title = "Copy card", iconOnly = false }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const success = await copyText(text);
    if (!success) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button type="button" className={`card-copy ${className}`.trim()} onClick={copy}
      title={copied ? "已复制" : title} aria-label={iconOnly ? (copied ? "已复制" : title) : undefined}>
      {iconOnly ? (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied ? <path d="m5 12 4 4L19 6" /> : <>
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
          </>}
        </svg>
      ) : (copied ? "已复制" : "复制")}
    </button>
  );
}
