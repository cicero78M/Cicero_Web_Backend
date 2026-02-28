import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const pgProtocolVersion =
  packageJson.dependencies?.['pg-protocol'] || packageJson.overrides?.['pg-protocol'] || 'latest';

const pgProtocolEntryPath = path.join(
  projectRoot,
  'node_modules',
  'pg-protocol',
  'dist',
  'index.js',
);

const verifyPgProtocol = () => fs.existsSync(pgProtocolEntryPath);

if (!verifyPgProtocol()) {
  console.warn('\n[postinstall] Missing pg-protocol build artifact:', pgProtocolEntryPath);
  console.warn('[postinstall] Attempting automatic repair via npm install --no-save --ignore-scripts');

  try {
    execSync(`npm install --no-save --ignore-scripts pg-protocol@${pgProtocolVersion}`, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('[postinstall] Automatic repair failed.', error);
  }

  if (!verifyPgProtocol()) {
    console.error('[postinstall] pg-protocol is still missing after repair attempt.');
    console.error('[postinstall] Run: rm -rf node_modules package-lock.json && npm install');
    process.exit(1);
  }
}

console.log('[postinstall] pg-protocol verified:', pgProtocolEntryPath);
