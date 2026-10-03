// Minimal RFC 4180 CSV: quoted fields, doubled quotes, embedded commas and
// newlines, CRLF or LF, optional UTF-8 BOM. No dependency needed.

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

// Cells whose *text* begins with = + - @ are executed as formulas when the
// CSV is opened in Excel/Sheets (CSV injection). Numbers are left alone;
// anything else gets a leading apostrophe, the spreadsheet convention for
// "treat as text".
function neutralize(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) && !Number.isFinite(Number(value))) return `'${value}`;
  return value;
}

function escapeField(value: string): string {
  const safe = neutralize(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
