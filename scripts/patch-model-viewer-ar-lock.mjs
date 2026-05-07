import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  join('node_modules', '@google', 'model-viewer', 'lib', 'three-components', 'ARRenderer.js'),
  join('node_modules', '@google', 'model-viewer', 'src', 'three-components', 'ARRenderer.ts'),
  join('node_modules', '.vite', 'deps', '@google_model-viewer.js'),
];

const translationStartPattern =
  /([ \t]*)if \(hitPosition != null\) \{\r?\n([ \t]*)this\.isTranslating = true;\r?\n[ \t]*this\.lastDragPosition\.copy\(hitPosition\);\r?\n([ \t]*)\}\r?\n([ \t]*)else if \(this\.placeOnWall === false\) \{/g;
const alreadyLockedPattern =
  /if \(hitPosition != null\) \{\r?\n[ \t]*box\.show = false;\r?\n[ \t]*this\.isTranslating = false;/;

function lockOneFingerTranslation(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let replacements = 0;

  const patched = source.replace(
    translationStartPattern,
    (_match, ifIndent, bodyIndent, closeIndent, elseIndent) => {
      replacements += 1;
      return [
        `${ifIndent}if (hitPosition != null) {`,
        `${bodyIndent}box.show = false;`,
        `${bodyIndent}this.isTranslating = false;`,
        `${closeIndent}}`,
        `${elseIndent}else if (this.placeOnWall === false) {`,
      ].join(newline);
    },
  );

  return { patched, replacements };
}

for (const file of files) {
  if (!existsSync(file)) continue;

  const source = readFileSync(file, 'utf8');
  const { patched, replacements } = lockOneFingerTranslation(source);

  if (patched !== source) {
    writeFileSync(file, patched);
    console.log(`Patched AR object translation lock in ${file} (${replacements} replacement${replacements === 1 ? '' : 's'})`);
  } else if (alreadyLockedPattern.test(source)) {
    console.log(`AR object translation lock already applied in ${file}`);
  } else {
    console.warn(`AR object translation lock pattern was not found in ${file}`);
  }
}