import type { ReactNode } from "react";

type Block = { kind: "text"; lines: string[] } | { kind: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/**
 * The assistant's reply as the model wrote it, made readable: line breaks are kept, a "- " or
 * "1." list becomes a list, and Markdown markers (**, #, |, ```) are shown as formatting or
 * dropped instead of appearing as symbols. No HTML from the model is ever rendered.
 */
export function ReplyText({ text }: { text: string }) {
  return (
    <div className="tracker-reply">
      {toBlocks(text).map((block, index) =>
        block.kind === "list" ? (
          block.ordered ? (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ol>
          ) : (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ul>
          )
        ) : (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) continue;
    const line = raw.replace(/^\s*#{1,6}\s+/, "").replace(/\s*\|\s*/g, " · ").replace(/^ · | · $/g, "").trimEnd();
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)?.[1] ?? "";
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    if (!line.trim()) {
      if (last?.kind === "text") blocks.push({ kind: "text", lines: [] });
      continue;
    }
    if (last?.kind === "text") last.lines.push(line);
    else blocks.push({ kind: "text", lines: [line] });
  }
  return blocks.filter((block) => (block.kind === "text" ? block.lines.length > 0 : block.items.length > 0));
}

/** **bold** becomes bold and ` is dropped. A single * stays: payees such as "SUMUP *SHOP" contain one. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={index}>{part.slice(2, -2)}</strong> : part.replace(/`/g, ""),
  );
}
