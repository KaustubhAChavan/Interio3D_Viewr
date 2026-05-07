import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  join('node_modules', '@google', 'model-viewer', 'lib', 'three-components', 'ARRenderer.js'),
  join('node_modules', '@google', 'model-viewer', 'src', 'three-components', 'ARRenderer.ts'),
  join('node_modules', '.vite', 'deps', '@google_model-viewer.js'),
];

const translationStartPattern =
  /(?<ifIndent>[ \t]*)if \((?<hitVar>hitPosition\w*) != null\) \{\r?\n[ \t]*this\.isTranslating = true;\r?\n[ \t]*this\.lastDragPosition\.copy\(\k<hitVar>\);\r?\n(?<closeIndent>[ \t]*)\}\r?\n(?<elseIndent>[ \t]*)else if \(this\.placeOnWall === false\) \{/g;

const dynamicPlacementPattern =
  /(?<ifIndent>[ \t]*)const lockPlacement = this\.presentedScene\?\.element\?\.getAttribute\('ar-placement-lock'\) !== 'move';\r?\n[ \t]*if \((?<hitVar>hitPosition\w*) != null\) \{\r?\n[ \t]*if \(lockPlacement\) \{\r?\n[ \t]*box\.show = false;\r?\n[ \t]*this\.isTranslating = false;\r?\n[ \t]*\} else \{\r?\n(?:[ \t]*if \(this\.surfaceAnchor != null\) \{\r?\n[ \t]*this\.surfaceAnchor\.delete\?\.\(\);\r?\n[ \t]*this\.surfaceAnchor = null;\r?\n[ \t]*\}\r?\n)?[ \t]*this\.isTranslating = true;\r?\n[ \t]*this\.lastDragPosition\.copy\(\k<hitVar>\);\r?\n[ \t]*\}\r?\n(?<closeIndent>[ \t]*)\}\r?\n(?<elseIndent>[ \t]*)else if \(this\.placeOnWall === false\) \{/g;

const alreadyLockedPattern =
  /if \(hitPosition\w* != null\) \{\r?\n[ \t]*box\.show = false;\r?\n[ \t]*this\.isTranslating = false;/;

const lockedElseFormattingPattern =
  /(?<ifIndent>[ \t]*)if \((?<hitVar>hitPosition\w*) != null\) \{\r?\n(?<bodyIndent>[ \t]*)box\.show = false;\r?\n[ \t]*this\.isTranslating = false;\r?\n[ \t]*\}\r?\nelse if \(this\.placeOnWall === false\) \{/g;

function removeExperimentalAnchorPatch(source) {
  let replacements = 0;
  let patched = source;

  const replace = (pattern, replacement = '') => {
    patched = patched.replace(pattern, (...args) => {
      replacements += 1;
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
  };

  replace(
    /optionalFeatures: \['hit-test', 'dom-overlay', 'light-estimation', 'anchors'\]/g,
    "optionalFeatures: ['hit-test', 'dom-overlay', 'light-estimation']",
  );

  replace(
    /optionalFeatures: \["hit-test", "dom-overlay", "light-estimation", "anchors"\]/g,
    'optionalFeatures: ["hit-test", "dom-overlay", "light-estimation"]',
  );

  replace(
    /\r?\n[ \t]*if \(this\.surfaceAnchor != null\) \{\r?\n[ \t]*this\.surfaceAnchor\.delete\?\.\(\);\r?\n[ \t]*this\.surfaceAnchor = null;\r?\n[ \t]*\}/g,
  );

  replace(/\r?\n[ \t]*this\.surfaceAnchor = null;/g);

  replace(
    /\r?\n[ \t]*const lockPlacement = this\.presentedScene\?\.element\?\.getAttribute\('ar-placement-lock'\) !== 'move';\r?\n[ \t]*if \(lockPlacement && this\.surfaceAnchor == null && typeof hit\.createAnchor === 'function'\) \{\r?\n[ \t]*hit\.createAnchor\(\)\.then\(anchor => \{\r?\n[ \t]*if \(this\.isPresenting && this\.surfaceAnchor == null\) \{\r?\n[ \t]*this\.surfaceAnchor = anchor;\r?\n[ \t]*\}\r?\n[ \t]*\}\)\.catch\(\(\) => \{\}\);\r?\n[ \t]*\}/g,
  );

  replace(
    /(?<indent>[ \t]*)if \(this\.placeOnWall\) \{\r?\n(?<copyIndent>[ \t]*)this\.goalPosition\.copy\(hitPoint\);\r?\n[ \t]*\}\s*else if \(lockPlacement\) \{\r?\n[ \t]*this\.goalPosition\.copy\(hitPoint\);\r?\n(?<closeIndent>[ \t]*)\}\s*else \{\r?\n(?<yIndent>[ \t]*)this\.goalPosition\.y = hitPoint\.y;\r?\n[ \t]*\}/g,
    (_match, ...args) => {
      const groups = args.at(-1);
      return `${groups.indent}if (this.placeOnWall) {\n${groups.copyIndent}this.goalPosition.copy(hitPoint);\n${groups.closeIndent}} else {\n${groups.yIndent}this.goalPosition.y = hitPoint.y;\n${groups.closeIndent}}`;
    },
  );

  replace(
    /\r?\n[ \t]*if \(this\.surfaceAnchor != null && scene\.element\.getAttribute\('ar-placement-lock'\) !== 'move'\) \{\r?\n[ \t]*const anchorPose = frame\.getPose\(this\.surfaceAnchor\.anchorSpace, refSpace\);\r?\n[ \t]*if \(anchorPose != null\) \{\r?\n[ \t]*matrix4\.fromArray\(anchorPose\.transform\.matrix\);\r?\n[ \t]*this\.goalPosition\.setFromMatrixPosition\(matrix4\);\r?\n[ \t]*\}\r?\n[ \t]*\}/g,
  );

  return { patched, replacements };
}

function lockOneFingerTranslation(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let replacements = 0;

  const replaceBlock = (_match, ...args) => {
    replacements += 1;
    const groups = args.at(-1);
    const { ifIndent, hitVar, elseIndent } = groups;
    const bodyIndent = `${ifIndent}${ifIndent.length >= 12 ? '    ' : '  '}`;

    return [
      `${ifIndent}if (${hitVar} != null) {`,
      `${bodyIndent}box.show = false;`,
      `${bodyIndent}this.isTranslating = false;`,
      `${ifIndent}}`,
      `${elseIndent}else if (this.placeOnWall === false) {`,
    ].join(newline);
  };

  let patched = source.replace(dynamicPlacementPattern, replaceBlock);
  patched = patched.replace(translationStartPattern, replaceBlock);
  patched = patched.replace(lockedElseFormattingPattern, (...args) => {
    replacements += 1;
    const groups = args.at(-1);
    return [
      `${groups.ifIndent}if (${groups.hitVar} != null) {`,
      `${groups.bodyIndent}box.show = false;`,
      `${groups.bodyIndent}this.isTranslating = false;`,
      `${groups.ifIndent}}`,
      `${groups.ifIndent}else if (this.placeOnWall === false) {`,
    ].join(newline);
  });

  return { patched, replacements };
}

for (const file of files) {
  if (!existsSync(file)) continue;

  const source = readFileSync(file, 'utf8');
  const anchorResult = removeExperimentalAnchorPatch(source);
  const lockResult = lockOneFingerTranslation(anchorResult.patched);
  const replacements = anchorResult.replacements + lockResult.replacements;
  const patched = lockResult.patched;

  if (patched !== source) {
    writeFileSync(file, patched);
    console.log(`Patched AR object translation lock in ${file} (${replacements} replacement${replacements === 1 ? '' : 's'})`);
  } else if (alreadyLockedPattern.test(source)) {
    console.log(`AR object translation lock already applied in ${file}`);
  } else {
    console.warn(`AR object translation lock pattern was not found in ${file}`);
  }
}