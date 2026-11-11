// Tab-separated text, the format Excel, Numbers and Sheets all put on (and
// read from) the system clipboard for a block of cells.

export function encodeTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t"),
    )
    .join("\n");
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const pushRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  while (i < text.length) {
    const char = text[i];
    // A quoted cell (Excel quotes anything containing a tab, newline or
    // quote) only counts when the quote opens the cell.
    if (char === '"' && cell === "") {
      let j = i + 1;
      let quoted = "";
      let closed = false;
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            quoted += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        quoted += text[j++];
      }
      const next = text[j];
      if (closed && (next === undefined || next === "\t" || next === "\n" || next === "\r")) {
        cell = quoted;
        i = j;
        continue;
      }
    }
    if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      cell += char;
    }
    i++;
  }
  // A trailing newline (every spreadsheet adds one) isn't an extra row.
  if (cell !== "" || row.length > 0) pushRow();
  return rows;
}
