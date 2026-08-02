import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src', 'index.ts');
const outDir = path.join(root, 'dist');
mkdirSync(outDir, { recursive: true });

const shared = {
  entryPoints: [entry],
  bundle: true,
  minify: true,
  target: 'es2018',
  sourcemap: true,
  banner: { js: '/* BugDetekter SDK — https://github.com/dalio001/BUGDETEKTER */' }
};

await build({
  ...shared,
  format: 'iife',
  globalName: 'BugDetekter',
  outfile: path.join(outDir, 'bugdetekter.min.js')
});

await build({
  ...shared,
  format: 'esm',
  outfile: path.join(outDir, 'bugdetekter.esm.js')
});

for (const file of ['bugdetekter.min.js', 'bugdetekter.esm.js']) {
  const content = readFileSync(path.join(outDir, file));
  const gzip = gzipSync(content);
  console.log(`${file}: ${(content.length / 1024).toFixed(1)}KB min, ${(gzip.length / 1024).toFixed(1)}KB gzip`);
}
