import { writeFile } from "fs/promises";
import ExcelJS from "exceljs";

const CELL_REF_REGEX = /^[A-Z]+\d+$/;

function encodeCol(col) {
  let dividend = Number(col) + 1;
  let columnName = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

function encodeCell({ r, c }) {
  return `${encodeCol(c)}${Number(r) + 1}`;
}

function normalizeArgb(color) {
  const raw = color?.rgb || color?.argb;
  if (!raw) return undefined;
  const hex = String(raw).replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return `FF${hex}`;
  return undefined;
}

function mapBorderStyle(style) {
  if (!style) return undefined;
  return {
    style: style.style || "thin",
    color: normalizeArgb(style.color) ? { argb: normalizeArgb(style.color) } : undefined,
  };
}

function mapCellStyle(style = {}, cell) {
  if (style.font) {
    cell.font = {
      ...style.font,
      color: normalizeArgb(style.font.color) ? { argb: normalizeArgb(style.font.color) } : undefined,
    };
  }

  if (style.alignment) {
    cell.alignment = { ...style.alignment };
  }

  if (style.fill) {
    const argb = normalizeArgb(style.fill.fgColor || style.fill.bgColor);
    cell.fill = {
      type: "pattern",
      pattern: style.fill.patternType || "solid",
      fgColor: argb ? { argb } : undefined,
      bgColor: normalizeArgb(style.fill.bgColor) ? { argb: normalizeArgb(style.fill.bgColor) } : undefined,
    };
  }

  if (style.border) {
    cell.border = {
      top: mapBorderStyle(style.border.top),
      left: mapBorderStyle(style.border.left),
      bottom: mapBorderStyle(style.border.bottom),
      right: mapBorderStyle(style.border.right),
      diagonal: mapBorderStyle(style.border.diagonal),
    };
  }
}

function toCellObject(value) {
  if (value && typeof value === "object" && (Object.prototype.hasOwnProperty.call(value, "v") || Object.prototype.hasOwnProperty.call(value, "f") || Object.prototype.hasOwnProperty.call(value, "t"))) {
    return { ...value };
  }

  if (value === null || typeof value === "undefined") {
    return { t: "s", v: "" };
  }

  if (typeof value === "number") {
    return { t: "n", v: value };
  }

  if (typeof value === "boolean") {
    return { t: "b", v: value };
  }

  return { t: "s", v: String(value) };
}

function aoaToSheet(aoa = []) {
  const sheet = {};
  let maxCol = 0;
  let maxRow = aoa.length;

  aoa.forEach((row = [], rowIdx) => {
    maxCol = Math.max(maxCol, row.length);
    row.forEach((value, colIdx) => {
      const address = encodeCell({ r: rowIdx, c: colIdx });
      sheet[address] = toCellObject(value);
    });
  });

  if (maxCol > 0 && maxRow > 0) {
    sheet["!ref"] = `${encodeCell({ r: 0, c: 0 })}:${encodeCell({ r: maxRow - 1, c: maxCol - 1 })}`;
  }

  return sheet;
}

function jsonToSheet(rows = [], options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const header = Array.isArray(options.header) && options.header.length
    ? options.header
    : Object.keys(safeRows[0] || {});

  const aoa = [header];
  safeRows.forEach((row) => {
    aoa.push(header.map((key) => row?.[key]));
  });

  return aoaToSheet(aoa);
}

function toMergeRange(merge) {
  if (!merge) return null;
  if (typeof merge === "string") return merge;
  if (merge?.s && merge?.e) {
    return `${encodeCell(merge.s)}:${encodeCell(merge.e)}`;
  }
  return null;
}

function applySheetToWorkbook(excelWorkbook, name, sheet = {}) {
  const worksheet = excelWorkbook.addWorksheet(name || "Sheet1");

  if (sheet["!freeze"]) {
    const { xSplit = 0, ySplit = 0 } = sheet["!freeze"];
    worksheet.views = [{ state: "frozen", xSplit, ySplit }];
  }

  if (sheet["!cols"] && Array.isArray(sheet["!cols"])) {
    worksheet.columns = sheet["!cols"].map((col) => ({
      width: typeof col?.wch === "number" ? col.wch : undefined,
    }));
  }

  if (sheet["!autofilter"]) {
    worksheet.autoFilter = typeof sheet["!autofilter"] === "string"
      ? sheet["!autofilter"]
      : sheet["!autofilter"]?.ref;
  }

  Object.entries(sheet).forEach(([address, cellData]) => {
    if (!CELL_REF_REGEX.test(address)) return;

    const cell = worksheet.getCell(address);
    const data = cellData || {};

    if (Object.prototype.hasOwnProperty.call(data, "f")) {
      cell.value = {
        formula: data.f,
        result: Object.prototype.hasOwnProperty.call(data, "v") ? data.v : undefined,
      };
    } else if (Object.prototype.hasOwnProperty.call(data, "v")) {
      cell.value = data.v;
    } else {
      cell.value = "";
    }

    if (data.z) {
      cell.numFmt = data.z;
    }

    if (data.s) {
      mapCellStyle(data.s, cell);
    }
  });

  const merges = Array.isArray(sheet["!merges"]) ? sheet["!merges"] : [];
  merges.forEach((merge) => {
    const range = toMergeRange(merge);
    if (!range) return;
    try {
      worksheet.mergeCells(range);
    } catch {
      // Ignore duplicate/invalid merge ranges to match permissive XLSX behavior.
    }
  });
}

async function writeWorkbookBuffer(workbook) {
  const excelWorkbook = new ExcelJS.Workbook();
  const sheets = workbook?.__sheets || [];

  sheets.forEach(({ name, sheet }) => {
    applySheetToWorkbook(excelWorkbook, name, sheet);
  });

  return excelWorkbook.xlsx.writeBuffer();
}

const XLSX = {
  utils: {
    book_new() {
      return { __sheets: [] };
    },
    book_append_sheet(workbook, worksheet, name) {
      if (!workbook || !Array.isArray(workbook.__sheets)) {
        throw new Error("Workbook tidak valid");
      }
      workbook.__sheets.push({ name, sheet: worksheet || {} });
    },
    aoa_to_sheet: aoaToSheet,
    json_to_sheet: jsonToSheet,
    encode_col: encodeCol,
    encode_cell: encodeCell,
    encode_range(start, end) {
      return `${encodeCell(start)}:${encodeCell(end)}`;
    },
  },
  async writeFile(workbook, filePath) {
    const buffer = await writeWorkbookBuffer(workbook);
    await writeFile(filePath, Buffer.from(buffer));
  },
  async write(workbook, options = {}) {
    const buffer = await writeWorkbookBuffer(workbook);
    if (options?.type === "buffer") {
      return Buffer.from(buffer);
    }
    return buffer;
  },
};

export default XLSX;
