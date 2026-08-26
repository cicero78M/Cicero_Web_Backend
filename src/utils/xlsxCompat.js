import XLSXBase from 'xlsx';

// Keep SheetJS behind a write-only facade. The installed npm release has
// known parser vulnerabilities, while this backend only generates workbooks.
// Do not expose read/readFile so untrusted Excel input cannot accidentally be
// introduced through the shared compatibility helper.
const XLSX = Object.freeze({
  utils: XLSXBase.utils,
  write(workbook, options) {
    return XLSXBase.write(workbook, options);
  },
  writeFile(workbook, filePath, options) {
    return XLSXBase.writeFile(workbook, filePath, options);
  },
});

export default XLSX;
