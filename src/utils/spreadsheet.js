const spreadsheetFormulaPrefix = /^[=+\-@]/;

export function sanitizeSpreadsheetCell(value) {
  const text = String(value ?? '');
  return spreadsheetFormulaPrefix.test(text) ? `'${text}` : text;
}
