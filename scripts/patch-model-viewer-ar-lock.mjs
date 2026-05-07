import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  join('node_modules', '@google', 'model-viewer', 'lib', 'three-components', 'ARRenderer.js'),
  join('node_modules', '@google', 'model-viewer', 'src', 'three-components', 'ARRenderer.ts'),
  join('node_modules', '.vite', 'deps', '@google_model-viewer.js'),
];

const placementBlockPattern =
  /(?<prefix>[ \t]*const (?<hitVar>hitPosition\w*) = box\.getHit\(this\.presentedScene!?, axes\[0\], axes\[1\]\);\r?\n[ \t]*box\.show = true;\r?\n(?:\r?\n)?)(?<ifIndent>[ \t]*)if \(\k<hitVar> != null\) \{\r?\n(?:[ \t]*box\.show = false;\r?\n[ \t]*this\.isTranslating = false;|[ \t]*this\.isTranslating = true;\r?\n[ \t]*this\.lastDragPosition\.copy\(\k<hitVar>\);)\r?\n[ \t]*\}\s*(?<elseIndent>[ \t]*)else if \(this\.placeOnWall === false\) \{/g;

const alreadyDynamicPattern =
  /const lockPlacement = this\.presentedScene\?\.element\?\.getAttribute\('ar-placement-lock'\) !== 'move';/;

function dynamicPlacementLock(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let replacements = 0;

  const patched = source.replace(
    placementBlockPattern,
    (...args) => {
      replacements += 1;
      const groups = args.at(-1);
      const { prefix, hitVar, ifIndent, elseIndent } = groups;
      const childIndent = `${ifIndent}${ifIndent.length >= 12 ? '    ' : '  '}`;
      const grandchildIndent = `${childIndent}${ifIndent.length >= 12 ? '    ' : '  '}`;

      return [
        prefix.trimEnd(),
        `${ifIndent}const lockPlacement = this.presentedScene?.element?.getAttribute('ar-placement-lock') !== 'move';`,
        `${ifIndent}if (${hitVar} != null) {`,
        `${childIndent}if (lockPlacement) {`,
        `${grandchildIndent}box.show = false;`,
        `${grandchildIndent}this.isTranslating = false;`,
        `${childIndent}} else {`,
        `${grandchildIndent}this.isTranslating = true;`,
        `${grandchildIndent}this.lastDragPosition.copy(${hitVar});`,
        `${childIndent}}`,
        `${ifIndent}}`,
        `${elseIndent}else if (this.placeOnWall === false) {`,
      ].join(newline);
    },
  );

  return { patched, replacements };
}

for (const file of files) {
  if (!existsSync(file)) continue;

  const source = readFileSync(file, 'utf8');

  if (alreadyDynamicPattern.test(source)) {
    console.log(`Dynamic AR placement lock already applied in ${file}`);
    continue;
  }

  const { patched, replacements } = dynamicPlacementLock(source);

  if (patched !== source) {
    writeFileSync(file, patched);
    console.log(`Patched dynamic AR placement lock in ${file} (${replacements} replacement${replacements === 1 ? '' : 's'})`);
  } else {
    console.warn(`Dynamic AR placement lock pattern was not found in ${file}`);
  }
}