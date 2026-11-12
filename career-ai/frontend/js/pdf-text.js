// Turns pdf.js text items for one page into plain text lines. Pure; tested in Node.
//
// pdf.js returns positioned text fragments. A new line starts when the item ends a line (hasEOL)
// or when its baseline moves; a space is added between fragments on the same line when there is a
// visible horizontal gap and neither side already has whitespace.

const SAME_LINE_TOLERANCE = 2;

/** @param {{ str: string, transform?: number[], width?: number, hasEOL?: boolean }[]} items */
export function joinTextItems(items) {
  let out = "";
  let lastY = null;
  let lastEndX = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > SAME_LINE_TOLERANCE && out && !out.endsWith("\n")) {
      out += "\n";
      lastEndX = null;
    }
    if (item.str !== "") {
      const needsSpace = lastEndX !== null && x - lastEndX > 1 && out && !/\s$/.test(out) && !/^\s/.test(item.str);
      out += (needsSpace ? " " : "") + item.str;
      lastEndX = x + (item.width ?? 0);
      lastY = y;
    }
    if (item.hasEOL && !out.endsWith("\n")) {
      out += "\n";
      lastEndX = null;
    }
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}
