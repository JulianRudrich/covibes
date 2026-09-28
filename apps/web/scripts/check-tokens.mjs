// Fails when a raw color value appears in apps/web/src outside the token file.
// Colors must come from src/styles/theme.css (see context/ui-context.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const allowed = new Set([join('styles', 'theme.css')]);
const extensions = /\.(ts|tsx|css)$/;
const rawColor = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const violations = [];
for (const file of walk(srcDir)) {
  const rel = relative(srcDir, file);
  if (!extensions.test(file) || allowed.has(rel)) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (rawColor.test(line) && !line.includes('tokens-ignore')) {
        violations.push(`src${sep}${rel}:${String(index + 1)}: ${line.trim()}`);
      }
    });
}

if (violations.length > 0) {
  console.error('Raw color values found outside src/styles/theme.css:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log('check:tokens ok');
