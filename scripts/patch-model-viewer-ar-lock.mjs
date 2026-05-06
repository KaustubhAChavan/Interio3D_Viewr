import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  join('node_modules', '@google', 'model-viewer', 'lib', 'three-components', 'ARRenderer.js'),
  join('node_modules', '@google', 'model-viewer', 'src', 'three-components', 'ARRenderer.ts'),
];

const replacements = [
  {
    from: `            if (hitPosition != null) {
                this.isTranslating = true;
                this.lastDragPosition.copy(hitPosition);
            }
            else if (this.placeOnWall === false) {`,
    to: `            if (hitPosition != null) {
                box.show = false;
                this.isTranslating = false;
            }
            else if (this.placeOnWall === false) {`,
  },
  {
    from: `      if (hitPosition != null) {
        this.isTranslating = true;
        this.lastDragPosition.copy(hitPosition);
      } else if (this.placeOnWall === false) {`,
    to: `      if (hitPosition != null) {
        box.show = false;
        this.isTranslating = false;
      } else if (this.placeOnWall === false) {`,
  },
];

for (const file of files) {
  if (!existsSync(file)) continue;

  let source = readFileSync(file, 'utf8');
  let patched = source;

  for (const { from, to } of replacements) {
    patched = patched.replace(from, to);
  }

  if (patched !== source) {
    writeFileSync(file, patched);
    console.log(`Patched AR object translation lock in ${file}`);
  }
}
