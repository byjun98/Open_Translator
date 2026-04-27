import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const sourceDir = resolve(rootDir, '.output', 'chrome-mv3');
const distDir = resolve(rootDir, 'dist');

async function main() {
  await rm(distDir, { force: true, recursive: true });
  await mkdir(distDir, { recursive: true });
  await cp(sourceDir, distDir, { recursive: true });
  console.log(`Synced build output to ${distDir}`);
}

main().catch((error) => {
  console.error('Failed to sync dist folder.');
  console.error(error);
  process.exitCode = 1;
});
