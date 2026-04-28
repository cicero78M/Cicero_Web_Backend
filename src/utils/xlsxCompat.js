import XLSXBase from 'xlsx';

const XLSX = {
  ...XLSXBase,
  writeFile(workbook, filePath, options) {
    XLSXBase.writeFile(workbook, filePath, options);
  },
};

export default XLSX;
