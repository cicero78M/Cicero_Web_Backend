import fs from 'node:fs';
import path from 'node:path';

import XLSX from '../src/utils/xlsxCompat.js';

const sourceRoot = path.resolve(process.cwd(), 'src');

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
  });
}

test('production source accesses xlsx only through the write-only facade', () => {
  const directImports = collectJavaScriptFiles(sourceRoot)
    .filter((filePath) => !filePath.endsWith(path.join('utils', 'xlsxCompat.js')))
    .filter((filePath) => /from\s+['"]xlsx['"]|require\(\s*['"]xlsx['"]\s*\)/.test(
      fs.readFileSync(filePath, 'utf8')
    ));

  expect(directImports).toEqual([]);
  expect(XLSX.read).toBeUndefined();
  expect(XLSX.readFile).toBeUndefined();
  expect(typeof XLSX.write).toBe('function');
  expect(typeof XLSX.writeFile).toBe('function');
});
