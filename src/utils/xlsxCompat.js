import ExcelJS from 'exceljs';
import {
  setImmediate as realSetImmediate,
  clearImmediate as realClearImmediate,
  setTimeout as realSetTimeout,
  clearTimeout as realClearTimeout,
} from 'node:timers';

function encodeCol(columnIndex) {
  let value = Number(columnIndex) + 1;
  let output = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function encodeCell({ r, c }) {
  return `${encodeCol(c)}${Number(r) + 1}`;
}

function encodeRange(rangeOrStart, end) {
  const range = end ? { s: rangeOrStart, e: end } : rangeOrStart;
  return `${encodeCell(range.s)}:${encodeCell(range.e)}`;
}

function createSheet(rows) {
  const sheet = { __rows: rows.map((row) => [...row]) };
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      sheet[encodeCell({ r: rowIndex, c: columnIndex })] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? { ...value }
          : { v: value };
    });
  });
  return sheet;
}

function aoaToSheet(rows = []) {
  return createSheet(rows);
}

function jsonToSheet(rows = [], options = {}) {
  const headers = options.header || Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row || {}).forEach((key) => keys.add(key));
      return keys;
    }, new Set()),
  );
  return createSheet([
    headers,
    ...rows.map((row) => headers.map((header) => row?.[header] ?? null)),
  ]);
}

function normalizeColor(color) {
  const rgb = color?.rgb || color?.argb;
  if (!rgb) return undefined;
  return { argb: String(rgb).replace(/^#/, '').padStart(8, 'FF') };
}

function normalizeStyle(style = {}) {
  const fillColor = normalizeColor(style.fill?.fgColor);
  const border = style.border
    ? Object.fromEntries(
        Object.entries(style.border).map(([side, value]) => [
          side,
          { ...value, color: normalizeColor(value?.color) },
        ]),
      )
    : undefined;
  return {
    ...(style.font ? { font: { ...style.font, color: normalizeColor(style.font.color) } } : {}),
    ...(style.alignment ? { alignment: style.alignment } : {}),
    ...(fillColor
      ? { fill: { type: 'pattern', pattern: 'solid', fgColor: fillColor } }
      : {}),
    ...(border ? { border } : {}),
    ...(style.numFmt ? { numFmt: style.numFmt } : {}),
  };
}

function applyCellDefinition(cell, definition) {
  if (!definition) return;
  if (definition.f) {
    cell.value = { formula: definition.f, result: definition.v ?? undefined };
  } else if (Object.hasOwn(definition, 'v')) {
    cell.value = definition.v;
  }
  if (definition.s) Object.assign(cell, normalizeStyle(definition.s));
  if (definition.z) cell.numFmt = definition.z;
}

function buildExcelWorkbook(workbookDefinition) {
  const workbook = new ExcelJS.Workbook();
  for (const sheetName of workbookDefinition.SheetNames) {
    const definition = workbookDefinition.Sheets[sheetName];
    const worksheet = workbook.addWorksheet(sheetName);
    (definition.__rows || []).forEach((row) => worksheet.addRow(row));

    Object.entries(definition).forEach(([address, cellDefinition]) => {
      if (/^[A-Z]+\d+$/.test(address)) {
        applyCellDefinition(worksheet.getCell(address), cellDefinition);
      }
    });

    (definition['!merges'] || []).forEach((merge) => {
      worksheet.mergeCells(encodeRange(merge));
    });
    (definition['!cols'] || []).forEach((column, index) => {
      worksheet.getColumn(index + 1).width = column.wch || column.width || 10;
    });
    (definition['!rows'] || []).forEach((row, index) => {
      if (row.hpt || row.hpx) worksheet.getRow(index + 1).height = row.hpt || row.hpx;
    });
    if (definition['!autofilter']?.ref) {
      worksheet.autoFilter = definition['!autofilter'].ref;
    }
    if (definition['!freeze']?.ySplit || definition['!freeze']?.xSplit) {
      worksheet.views = [{
        state: 'frozen',
        xSplit: definition['!freeze'].xSplit || 0,
        ySplit: definition['!freeze'].ySplit || 0,
      }];
    }
  }
  return workbook;
}

async function withRealTimers(callback) {
  const previous = {
    setImmediate: globalThis.setImmediate,
    clearImmediate: globalThis.clearImmediate,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.setImmediate = realSetImmediate;
  globalThis.clearImmediate = realClearImmediate;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  try {
    return await callback();
  } finally {
    Object.assign(globalThis, previous);
  }
}

const XLSX = Object.freeze({
  utils: Object.freeze({
    aoa_to_sheet: aoaToSheet,
    json_to_sheet: jsonToSheet,
    book_new() {
      return { SheetNames: [], Sheets: {} };
    },
    book_append_sheet(workbook, worksheet, name) {
      workbook.SheetNames.push(name);
      workbook.Sheets[name] = worksheet;
    },
    encode_col: encodeCol,
    encode_cell: encodeCell,
    encode_range: encodeRange,
  }),
  async write(workbook) {
    return withRealTimers(async () =>
      Buffer.from(await buildExcelWorkbook(workbook).xlsx.writeBuffer()),
    );
  },
  async writeFile(workbook, filePath) {
    await withRealTimers(() => buildExcelWorkbook(workbook).xlsx.writeFile(filePath));
  },
});

export default XLSX;
