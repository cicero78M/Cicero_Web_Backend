import fs from 'fs';
import path from 'path';

const pgProtocolEntryPath = path.join(
  process.cwd(),
  'node_modules',
  'pg-protocol',
  'dist',
  'index.js',
);

if (!fs.existsSync(pgProtocolEntryPath)) {
  console.error('\n[postinstall] Missing pg-protocol build artifact:', pgProtocolEntryPath);
  console.error('[postinstall] This usually indicates a corrupted/incomplete npm install.');
  console.error('[postinstall] Run: rm -rf node_modules package-lock.json && npm install');
  process.exit(1);
}

console.log('[postinstall] pg-protocol verified:', pgProtocolEntryPath);
