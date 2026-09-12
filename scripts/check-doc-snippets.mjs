/**
 * Documentation snippet check: every function a guide chapter *calls* in a `ts` code fence must exist.
 *
 * The guide is the framework's front door, and a renamed export is exactly the kind of rot nobody
 * notices: the prose stays plausible while the snippet throws. This script extracts the called
 * identifiers from every fenced TypeScript block and compares them against the public exports of the
 * four packages plus the Compose DSL subpath.
 *
 * It is deliberately syntactic (no TypeScript API): it strips string literals and `{{ … }}` template
 * placeholders first, ignores locally declared names (including arrow parameters), and treats
 * JavaScript keywords and a few Phaser/browser globals as known. That is enough to catch typos,
 * renamed APIs and invented helpers, which is what actually goes wrong in docs - it is not a compiler.
 *
 * Usage: `pnpm docs:check [files…]` (defaults to `docs/guide/*.md`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPORT_SOURCES = [
  'packages/core/src/index.ts',
  'packages/layout/src/index.ts',
  'packages/phaser/src/index.ts',
  'packages/widgets/src/index.ts',
  'packages/widgets/src/compose.ts',
];

/** Keywords, globals and TypeScript/class syntax that legitimately appear as `name(` in a snippet. */
const ALWAYS_KNOWN = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'new',
  'function',
  'typeof',
  'await',
  'catch',
  'constructor',
  'super',
  'this',
  'void',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'console',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Object',
  'Array',
  'JSON',
  'Date',
  'Promise',
  'Map',
  'Set',
  'Error',
  'Symbol',
  'RegExp',
  'parseInt',
  'parseFloat',
  'isNaN',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'requestAnimationFrame',
  'performance',
  // Phaser scene lifecycle methods a snippet may implement.
  'init',
  'preload',
  'create',
  'update',
  'Phaser',
  'window',
  'document',
  'localStorage',
  'navigator',
]);

/** `export { a, b as c }` / `export function f` / `export const x` / `export class C`. */
function exportsOf(source) {
  const text = readFileSync(source, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^\w+$/.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** Everything the docs are allowed to call. */
function knownNames() {
  const known = new Set(ALWAYS_KNOWN);
  for (const source of EXPORT_SOURCES) {
    for (const name of exportsOf(source)) {
      known.add(name);
    }
  }
  // Widget classes are also reachable through the `this.add.uiXxx` factories, spelled lowercase in
  // prose tables; those are not calls, so nothing further is needed here.
  return known;
}

/** Removes comments, string literals and `{{ … }}` placeholders so only real code identifiers remain. */
function stripText(text) {
  return text
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function checkFile(file, known) {
  const text = readFileSync(file, 'utf8');
  const fences = [...text.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].map((m) => m[1]);
  const called = new Set();
  const locals = new Set();

  for (const fence of fences) {
    const code = stripText(fence);
    for (const m of code.matchAll(/(?:const|let|var|function|class)\s+(\w+)/g)) {
      locals.add(m[1]);
    }
    // Methods declared in the snippet itself (`private close() {}`, `get hasItems() {}`). The leading
    // modifier is required: without it every call that happens to start a line would look local, and
    // the check would miss exactly the typos it exists to catch.
    for (const m of code.matchAll(
      /^\s*(?:override\s+|private\s+|protected\s+|public\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)+(\w+)\s*\(/gm,
    )) {
      locals.add(m[1]);
    }
    // Arrow parameters are locals too: `const row = (label, control) => control()`.
    for (const m of code.matchAll(/\(([\s\S]*?)\)\s*=>/g)) {
      for (const param of m[1].split(',')) {
        locals.add(param.trim().split(/[:=]/)[0].trim());
      }
    }
    for (const m of code.matchAll(/(?<![\w.$])([A-Za-z_]\w*)\s*\(/g)) {
      called.add(m[1]);
    }
  }

  const unknown = [...called].filter((n) => !known.has(n) && !locals.has(n));
  return { fences: fences.length, called: called.size, unknown };
}

const root = new URL('..', import.meta.url).pathname;
const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync(join(root, 'docs/guide'))
        .filter((name) => name.endsWith('.md'))
        .map((name) => join('docs/guide', name))
        .sort();

const known = knownNames();
let failures = 0;

for (const file of files) {
  const { fences, called, unknown } = checkFile(join(root, file), known);
  if (unknown.length === 0) {
    console.log(`ok   ${file}  (${fences} fences, ${called} called identifiers)`);
    continue;
  }
  failures += unknown.length;
  console.log(`FAIL ${file}  (${fences} fences, ${called} called identifiers)`);
  console.log(`     unknown: ${unknown.join(', ')}`);
}

if (failures > 0) {
  console.error(
    `\n${failures} identifier(s) in the guide do not exist in the packages. Either the snippet is wrong or the API was renamed.`,
  );
  process.exit(1);
}
console.log('\nAll guide snippets call existing APIs.');
