import { sanitizeSpreadsheetCell } from '../src/utils/spreadsheet.js';

test.each(['=CMD()', '+SUM(A1:A2)', '-1+2', '@IMPORTDATA("x")'])(
  'neutralizes spreadsheet formula prefix in %s',
  (value) => {
    expect(sanitizeSpreadsheetCell(value)).toBe(`'${value}`);
  },
);

test('preserves ordinary spreadsheet values', () => {
  expect(sanitizeSpreadsheetCell('catatan aman')).toBe('catatan aman');
});
