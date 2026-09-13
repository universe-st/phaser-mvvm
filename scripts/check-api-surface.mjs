/**
 * Public-API surface gate: the frozen contract of the four packages.
 *
 * The framework reached 1.0 in round 110, and "1.0" has to mean something a machine checks: the set of
 * names each package exports is now part of the contract, and adding, renaming or deleting one is a
 * deliberate act that has to show up in a diff. Nothing else in the repository could see that — the
 * guide gate (`check-doc-snippets.mjs`) only fails when a *documented* name disappears, and a
 * type-check cannot tell an intended export from an accidental one.
 *
 * ```bash
 * node scripts/check-api-surface.mjs                  # verify against docs/API-SURFACE.json
 * UPDATE_API=1 node scripts/check-api-surface.mjs     # re-freeze (and explain every diff)
 * ```
 *
 * What it reads is the source of truth for the runtime entry points — the `exports` map in each
 * `package.json` points `types`/`import` at `src/index.ts` in this repo, so the entry files *are* the
 * public surface. `export *` is followed transitively, including the cross-package one
 * (`@phaser-mvvm/phaser` re-exports all of `@phaser-mvvm/layout`), because a name that arrives through
 * a star re-export is just as public as one written out by hand.
 *
 * Both values and types are listed. They are one namespace to a consumer: a renamed interface breaks
 * compilation exactly like a renamed function, and TypeScript's `export { type X }` syntax makes the
 * two indistinguishable in the entry file anyway. The snapshot records *names*, not signatures —
 * signature drift is what the tests, the guide snippets and the type-checker are for.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(root, 'docs/API-SURFACE.json');

/** Public entry points: `exports` key → the source file that defines it. */
const ENTRIES = [
  { name: '@phaser-mvvm/core', file: 'packages/core/src/index.ts' },
  { name: '@phaser-mvvm/layout', file: 'packages/layout/src/index.ts' },
  { name: '@phaser-mvvm/phaser', file: 'packages/phaser/src/index.ts' },
  { name: '@phaser-mvvm/widgets', file: 'packages/widgets/src/index.ts' },
  { name: '@phaser-mvvm/widgets/compose', file: 'packages/widgets/src/compose.ts' },
];

/** Workspace package name → its entry file, so `export * from '@phaser-mvvm/layout'` resolves. */
const WORKSPACE_ENTRIES = new Map(ENTRIES.map((entry) => [entry.name, entry.file]));

/**
 * Resolves one `from` specifier to a repo-relative file.
 *
 * Only two shapes occur here: a relative path inside the package, and a workspace package name. A bare
 * external specifier (there are none in the entry files, and the rule is that `core`/`layout` have no
 * runtime dependencies) resolves to `null` and is reported rather than silently skipped.
 */
function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith('.')) {
    const base = join(dirname(fromFile), specifier);
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      try {
        readFileSync(join(root, candidate));
        return candidate;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }
  return WORKSPACE_ENTRIES.get(specifier) ?? null;
}

/** Strips comments so an `export` inside a doc block cannot be mistaken for a real one. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Normalises one clause of an `export { … }` list: `type X`, `X as Y`, `type X as Y`. */
function clauseName(clause) {
  const bare = clause.trim().replace(/^type\s+/, '');
  const name = bare
    .split(/\s+as\s+/)
    .pop()
    ?.trim();
  return name && /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
}

/**
 * Collects the exported names of one entry file, following `export *` transitively.
 *
 * `visited` guards the (currently non-existent, but cheap to guard) cycle of two modules star-exporting
 * each other — without it the recursion would not terminate.
 */
function collectExports(file, collected = new Set(), visited = new Set()) {
  if (visited.has(file)) {
    return { names: collected, unresolved: [] };
  }
  visited.add(file);

  let source;
  try {
    source = stripComments(readFileSync(join(root, file), 'utf8'));
  } catch {
    return { names: collected, unresolved: [`${file} (missing)`] };
  }
  const unresolved = [];

  // `export function f`, `export const x`, `export class C`, `export interface I`, `export type T`,
  // `export enum E`, `export declare …`, and the `async`/`abstract` variants of those.
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    collected.add(match[1]);
  }

  // `export { a, type B, C as D }` — with or without a trailing `from '…'`.
  for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g)) {
    for (const clause of match[1].split(',')) {
      const name = clauseName(clause);
      if (name) {
        collected.add(name);
      }
    }
  }

  // `export * from './x'` / `export type * from './x'` — followed, because the re-exported names are
  // part of this entry point's surface.
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?\*\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g,
  )) {
    const resolved = resolveSpecifier(file, match[1]);
    if (!resolved) {
      unresolved.push(`${file} → ${match[1]}`);
      continue;
    }
    const nested = collectExports(resolved, collected, visited);
    unresolved.push(...nested.unresolved);
  }

  return { names: collected, unresolved };
}

/** The whole frozen surface, as a sorted list of names per entry point. */
export function apiSurface() {
  const surface = {};
  const unresolved = [];
  for (const entry of ENTRIES) {
    const { names, unresolved: missing } = collectExports(entry.file);
    surface[entry.name] = [...names].sort((a, b) => a.localeCompare(b));
    unresolved.push(...missing);
  }
  return { surface, unresolved };
}

function readSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return null;
  }
}

export function snapshotDocument(surface) {
  return {
    $comment:
      'Frozen public API surface (round 110). Names only — see scripts/check-api-surface.mjs. ' +
      'Adding, renaming or removing an export must be a deliberate change to this file.',
    packages: surface,
  };
}

function main() {
  const { surface, unresolved } = apiSurface();

  if (unresolved.length > 0) {
    console.error('[api-surface] could not resolve:');
    for (const entry of unresolved) {
      console.error(`  - ${entry}`);
    }
    process.exit(1);
  }

  const total = Object.values(surface).reduce((sum, names) => sum + names.length, 0);

  if (process.env.UPDATE_API === '1') {
    writeFileSync(SNAPSHOT, `${JSON.stringify(snapshotDocument(surface), null, 2)}\n`);
    console.log(
      `[api-surface] re-frozen: ${total} export(s) across ${ENTRIES.length} entry points`,
    );
    for (const [name, names] of Object.entries(surface)) {
      console.log(`  ${name}: ${names.length}`);
    }
    return;
  }

  const previous = readSnapshot();
  if (!previous) {
    console.error(
      `[api-surface] ${SNAPSHOT} is missing. Freeze the surface with ` +
        '`UPDATE_API=1 node scripts/check-api-surface.mjs`.',
    );
    process.exit(1);
  }

  let failures = 0;
  for (const entry of ENTRIES) {
    const before = new Set(previous.packages?.[entry.name] ?? []);
    const after = new Set(surface[entry.name]);
    const added = [...after].filter((name) => !before.has(name)).sort();
    const removed = [...before].filter((name) => !after.has(name)).sort();
    if (added.length === 0 && removed.length === 0) {
      continue;
    }
    failures += added.length + removed.length;
    console.error(`[api-surface] ${entry.name} changed:`);
    for (const name of added) {
      console.error(`  + ${name}`);
    }
    for (const name of removed) {
      console.error(`  - ${name}`);
    }
  }

  const previousNames = Object.keys(previous.packages ?? {});
  const currentNames = ENTRIES.map((entry) => entry.name);
  for (const name of currentNames.filter((entry) => !previousNames.includes(entry))) {
    console.error(`[api-surface] ${name} is a new entry point`);
    failures += 1;
  }
  for (const name of previousNames.filter((entry) => !currentNames.includes(entry))) {
    console.error(`[api-surface] ${name} disappeared`);
    failures += 1;
  }

  if (failures > 0) {
    console.error(
      `\n[api-surface] ${failures} difference(s) against the frozen contract.\n` +
        '  The public API is frozen since 1.0: an addition, rename or removal is a breaking change\n' +
        '  and needs a new ADR plus a guide/HANDOVER update. Re-freeze with\n' +
        '  `UPDATE_API=1 node scripts/check-api-surface.mjs` once that is done.',
    );
    process.exit(1);
  }

  console.log(
    `[api-surface] ok: ${total} frozen export(s) across ${ENTRIES.length} entry points match ` +
      'docs/API-SURFACE.json',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
