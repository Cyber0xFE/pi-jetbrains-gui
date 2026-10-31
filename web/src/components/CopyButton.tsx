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
}

export function CopyButton({ text, className = "", title = "Copy card" }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const success = await copyText(text);
    if (!success) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button type="button" className={`card-copy ${className}`.trim()} onClick={copy} title={title}>
      {copied ? "已复制" : "复制"}
    </button>
  );
}
