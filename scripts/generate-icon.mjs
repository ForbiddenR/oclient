// Generates build/icon.ico from build/icon.svg.
// One-off dev utility. Requires: npm install --no-save sharp to-ico
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import toIco from 'to-ico';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svg = readFileSync(resolve(root, 'build/icon.svg'), 'utf8');
const outDir = resolve(root, 'build');
mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer())
);

const ico = await toIco(pngs);
writeFileSync(resolve(outDir, 'icon.ico'), ico);
console.log(`wrote build/icon.ico (${ico.length} bytes) at ${sizes.join(', ')}px`);
