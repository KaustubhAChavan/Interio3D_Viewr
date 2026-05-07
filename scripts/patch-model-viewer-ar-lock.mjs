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
const alreadyAnchorPattern =
  /this\.surfaceAnchor/;

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
        `${grandchildIndent}if (this.surfaceAnchor != null) {`,
        `${grandchildIndent}${ifIndent.length >= 12 ? '    ' : '  '}this.surfaceAnchor.delete?.();`,
        `${grandchildIndent}${ifIndent.length >= 12 ? '    ' : '  '}this.surfaceAnchor = null;`,
        `${grandchildIndent}}`,
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

function addAnchorSupport(source) {
  let patched = source;
  let replacements = 0;

  patched = patched.replace(
    /optionalFeatures: \['hit-test', 'dom-overlay', 'light-estimation'\]/g,
    () => {
      replacements += 1;
      return "optionalFeatures: ['hit-test', 'dom-overlay', 'light-estimation', 'anchors']";
    },
  );

  patched = patched.replace(
    /optionalFeatures: \["hit-test", "dom-overlay", "light-estimation"\]/g,
    () => {
      replacements += 1;
      return 'optionalFeatures: ["hit-test", "dom-overlay", "light-estimation", "anchors"]';
    },
  );

  patched = patched.replace(
    /([ \t]*this\.goalScale = 1;\r?\n)(?![ \t]*this\.surfaceAnchor = null;)/g,
    (_match, prefix) => {
      replacements += 1;
      const indent = prefix.match(/[ \t]*/)?.[0] ?? '';
      return `${prefix}${indent}this.surfaceAnchor = null;\n`;
    },
  );

  patched = patched.replace(
    /([ \t]*this\.overlay = null;\r?\n)(?![ \t]*if \(this\.surfaceAnchor != null\))/g,
    (_match, prefix) => {
      replacements += 1;
      const indent = prefix.match(/[ \t]*/)?.[0] ?? '';
      const inner = `${indent}${indent.length >= 4 ? '    ' : '  '}`;
      return `${prefix}${indent}if (this.surfaceAnchor != null) {\n${inner}this.surfaceAnchor.delete?.();\n${inner}this.surfaceAnchor = null;\n${indent}}\n`;
    },
  );

  patched = patched.replace(
    /([ \t]*const hitPoint = this\.getHitPoint\(hit\);\r?\n[ \t]*if \(hitPoint == null\) \{\r?\n[ \t]*return;\r?\n[ \t]*\}\r?\n)(?![ \t]*const lockPlacement = this\.presentedScene\?\.element)/g,
    (_match, prefix) => {
      replacements += 1;
      const indent = prefix.match(/[ \t]*/)?.[0] ?? '';
      const inner = `${indent}${indent.length >= 8 ? '    ' : '  '}`;
      const inner2 = `${inner}${indent.length >= 8 ? '    ' : '  '}`;
      return `${prefix}${indent}const lockPlacement = this.presentedScene?.element?.getAttribute('ar-placement-lock') !== 'move';\n${indent}if (lockPlacement && this.surfaceAnchor == null && typeof hit.createAnchor === 'function') {\n${inner}hit.createAnchor().then(anchor => {\n${inner2}if (this.isPresenting && this.surfaceAnchor == null) {\n${inner2}${indent.length >= 8 ? '    ' : '  '}this.surfaceAnchor = anchor;\n${inner2}}\n${inner}}).catch(() => {});\n${indent}}\n`;
    },
  );

  patched = patched.replace(
    /([ \t]*)else \{\r?\n([ \t]*)this\.goalPosition\.y = hitPoint\.y;\r?\n([ \t]*)\}/g,
    (_match, elseIndent, bodyIndent, closeIndent) => {
      replacements += 1;
      return `${elseIndent}else if (lockPlacement) {\n${bodyIndent}this.goalPosition.copy(hitPoint);\n${closeIndent}}\n${elseIndent}else {\n${bodyIndent}this.goalPosition.y = hitPoint.y;\n${closeIndent}}`;
    },
  );

  patched = patched.replace(
    /([ \t]*)this\.moveToFloor\(frame\);\r?\n([ \t]*)this\.processInput\(frame\);/g,
    (_match, moveIndent, processIndent) => {
      replacements += 1;
      const inner = `${moveIndent}${moveIndent.length >= 8 ? '    ' : '  '}`;
      return `${moveIndent}this.moveToFloor(frame);\n${moveIndent}if (this.surfaceAnchor != null && scene.element.getAttribute('ar-placement-lock') !== 'move') {\n${inner}const anchorPose = frame.getPose(this.surfaceAnchor.anchorSpace, refSpace);\n${inner}if (anchorPose != null) {\n${inner}${moveIndent.length >= 8 ? '    ' : '  '}matrix4.fromArray(anchorPose.transform.matrix);\n${inner}${moveIndent.length >= 8 ? '    ' : '  '}this.goalPosition.setFromMatrixPosition(matrix4);\n${inner}}\n${moveIndent}}\n${processIndent}this.processInput(frame);`;
    },
  );

  return { patched, replacements };
}

for (const file of files) {
  if (!existsSync(file)) continue;

  let source = readFileSync(file, 'utf8');
  let totalReplacements = 0;

  if (alreadyDynamicPattern.test(source)) {
    console.log(`Dynamic AR placement lock already applied in ${file}`);
  } else {
    const { patched, replacements } = dynamicPlacementLock(source);
    source = patched;
    totalReplacements += replacements;
  }

  if (alreadyAnchorPattern.test(source)) {
    console.log(`Surface anchor support already applied in ${file}`);
  } else {
    const { patched, replacements } = addAnchorSupport(source);
    source = patched;
    totalReplacements += replacements;
  }

  const original = readFileSync(file, 'utf8');
  if (source !== original) {
    writeFileSync(file, source);
    console.log(`Patched AR placement lock/anchor support in ${file} (${totalReplacements} replacement${totalReplacements === 1 ? '' : 's'})`);
  } else {
    console.log(`No AR placement patch changes needed in ${file}`);
  }
}