import XLSX from '../utils/xlsxCompat.js';

export async function generateExcelBuffer(rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

export async function generateLinkReportExcelBuffer(rows) {
  const header = [
    'Date',
    'Pangkat Nama',
    'NRP',
    'Satfung'
  ];
  const data = rows.map((r) => [
    r.date || '',
    r.pangkat_nama || '',
    r.nrp || '',
    r.satfung || ''
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}
