#!/usr/bin/env node
/**
 * Documentation ↔ code audit for **option keys**.
 *
 * `check-doc-snippets.mjs` compares the *identifiers* a guide snippet calls with the packages' exports; it
 * cannot see the keys inside an option object, and that is where the silent failures live. The guide's
 * option tables are the contract a reader codes against, while `reportUnknownOptions()` (round 83) is what
 * a widget actually accepts: a key that is documented but not accepted warns "unknown option … it is
 * ignored" in dev mode and does nothing in release. `#/options` cannot catch that class either, because
 * that page was built by reverse-looking-up the *widget* key tables, not the guide.
 *
 * So: parse the guides' key tables, resolve each table to the option bag its heading documents, and
 * require every documented key to be one that bag accepts. Bags are declared explicitly below, and a table
 * whose heading names none of them is skipped (counted in the summary) rather than guessed at.
 *
 * Syntax level, like the snippet gate: markdown tables, `*_KEYS` arrays, interface bodies, and a
 * hand-written map.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Options every widget accepts on the base class (`option-keys.ts`), plus the two `splitOptions` owns. */
const BASE_WIDGET_KEYS = ['name', 'visible', 'focusOrder', 'label'];

/**
 * Every option bag a guide table may document.
 *
 * `widget: true` means the bag is a set of widget options: its accepted keys are the `*_KEYS` arrays of
 * `sources`, plus the base-widget options and the layout params every widget takes. Otherwise it is an
 * options *interface*, and the keys are that interface's own properties (plus `extra`, for the few keys
 * an interface inherits from somewhere the scan cannot see).
 */
const BAGS = [
  {
    names: ['Text', 'Label'],
    sources: ['packages/widgets/src/Label.ts', 'packages/widgets/src/compose.ts'],
    types: ['TextOptions'],
    widget: true,
  },
  {
    names: ['Panel'],
    sources: [
      'packages/widgets/src/Panel.ts',
      'packages/widgets/src/options.ts',
      'packages/widgets/src/compose.ts',
    ],
    types: ['PanelDslOptions'],
    widget: true,
  },
  {
    names: ['Button'],
    sources: ['packages/widgets/src/Button.ts', 'packages/widgets/src/compose.ts'],
    types: ['ButtonDslOptions'],
    widget: true,
  },
  {
    names: ['Slider'],
    sources: ['packages/widgets/src/Slider.ts', 'packages/widgets/src/compose.ts'],
    types: ['SliderDslOptions'],
    widget: true,
  },
  {
    names: ['Image'],
    sources: ['packages/widgets/src/Image.ts', 'packages/widgets/src/compose.ts'],
    types: ['ImageDslOptions'],
    widget: true,
  },
  { names: ['Spacer'], sources: ['packages/widgets/src/Spacer.ts'], widget: true },
  { names: ['Divider'], sources: ['packages/widgets/src/Divider.ts'], widget: true },
  {
    names: ['TextField'],
    sources: [
      'packages/widgets/src/TextInputBase.ts',
      'packages/widgets/src/TextField.ts',
      'packages/widgets/src/compose.ts',
    ],
    types: ['TextFieldDslOptions'],
    widget: true,
  },
  {
    names: ['TextArea'],
    sources: [
      'packages/widgets/src/TextInputBase.ts',
      'packages/widgets/src/TextArea.ts',
      'packages/widgets/src/compose.ts',
    ],
    types: ['TextAreaDslOptions'],
    widget: true,
  },
  {
    names: ['VirtualKeyboard'],
    sources: [
      'packages/widgets/src/VirtualKeyboard.ts',
      'packages/widgets/src/keyboard-plan.ts',
      'packages/widgets/src/Panel.ts',
      'packages/widgets/src/options.ts',
      'packages/widgets/src/compose.ts',
    ],
    types: ['VirtualKeyboardOptions'],
    widget: true,
  },
  {
    names: ['ScrollView', 'Scroll'],
    sources: ['packages/widgets/src/ScrollView.ts', 'packages/widgets/src/compose.ts'],
    types: ['ScrollDslOptions'],
    widget: true,
  },
  {
    // The guide's `Repeat` table covers both surfaces on purpose: the widget (`items`/`key`/…) and the
    // DSL's `List`, whose `gap`/`rowGap`/`columnGap` shorthands are merged into `container`.
    names: ['Repeat', 'List'],
    sources: [
      'packages/widgets/src/Repeat.ts',
      'packages/widgets/src/compose.ts',
      'packages/widgets/src/list-flow.ts',
    ],
    types: ['ListOptions', 'ListFlowShorthands'],
    widget: true,
  },
  {
    names: ['Column', 'Row', 'Box', 'Grid', 'Stack', 'Absolute'],
    sources: [
      'packages/phaser/src/LayoutWidget.ts',
      'packages/widgets/src/options.ts',
      'packages/widgets/src/compose.ts',
    ],
    types: ['ColumnOptions', 'RowOptions'],
    widget: true,
  },
  {
    names: ['LayoutParams'],
    hints: ['布局参数'],
    sources: ['packages/layout/src/params.ts'],
    interface: 'LayoutParams',
    // The layout chapter's own tables (`grow`/`shrink`/`basis`, `aspectRatio`/`hideMode`) are layout
    // params, and none of its headings names the type.
    file: 'docs/guide/02-layout.md',
    // The appendix table documents the *option object*, which also takes the base widget options: its own
    // `name` row says so ("调试名（不是布局字段，但可以写在同一个对象里）").
    extra: BASE_WIDGET_KEYS,
  },
  {
    names: ['ModalOptions'],
    hints: ['模态'],
    sources: ['packages/phaser/src/modal.ts'],
    interface: 'ModalOptions',
  },
  {
    names: ['PageOptions'],
    hints: ['页面栈'],
    sources: ['packages/phaser/src/pages.ts'],
    interface: 'PageOptions',
  },
  {
    // The guide's table is the transition *policy* (`enabled`/`enter`/`exit`/`respectReducedMotion`), which
    // is `TransitionOptions`; `TransitionSpec` is one animation's fields and is documented inside it.
    names: ['TransitionOptions'],
    hints: ['开闭动效', '动效'],
    sources: ['packages/phaser/src/transition.ts'],
    interface: 'TransitionOptions',
    // The table is the transition *policy*, and its `enter` row points at the per-animation spec
    // (`{ duration, easing, fromAlpha, fromScale }`), so the spec's own fields are documented here too.
    types: ['TransitionSpec'],
  },
];

/** Keys of every `const *_KEYS = [...]` array in a file (widgets declare their own options that way). */
function arrayKeys(path) {
  const keys = new Set();
  for (const match of read(path).matchAll(/const\s+[A-Z_]*KEYS\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)) {
    for (const key of match[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)) {
      keys.add(key[1]);
    }
  }
  return keys;
}

/**
 * Property names of one exported option type.
 *
 * Both shapes the widgets use are handled: `export interface X { … }` and the DSL's
 * `export type X = Omit<WidgetOptions, 'slot'> & { slot?: ReactiveSource<…> }` (the inline `{ … }` blocks
 * after `=` / `&`). Nested object types are skipped, because their keys belong to a different bag.
 */
function typeKeys(path, name) {
  const source = read(path);
  // A declaration starts its own line: `import { type ListFlowShorthands }` also contains the words
  // "type ListFlowShorthands", and matching that put an unrelated body under the name.
  const declaration = new RegExp(
    `(?:^|\\n)[ \\t]*(?:export\\s+)?(?:declare\\s+)?(?:interface|type)\\s+${name}(?:<[^>]*>)?[^{;=]*`,
  ).exec(source);
  if (!declaration) {
    return null;
  }
  // The body is the first `{` that is not inside a type argument or a parameter list: `interface X { … }`,
  // `interface X extends Omit<Y, 'k'> { … }` and `type X = Omit<Y, 'k'> & { … }` all reach it the same way.
  let angle = 0;
  let paren = 0;
  let open = -1;
  for (let index = declaration.index + declaration[0].length; index < source.length; index++) {
    const character = source[index];
    if (character === '<') {
      angle += 1;
    } else if (character === '>') {
      angle = Math.max(0, angle - 1);
    } else if (character === '(') {
      paren += 1;
    } else if (character === ')') {
      paren = Math.max(0, paren - 1);
    } else if (character === '{' && angle === 0 && paren === 0) {
      open = index;
      break;
    }
  }
  if (open === -1) {
    return null;
  }
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) {
    return null;
  }
  const keys = new Set();
  let nested = 0;
  for (const line of source.slice(open + 1, end).split('\n')) {
    const trimmed = line.trim();
    if (nested === 0) {
      const property = /^(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??\s*:/.exec(trimmed);
      if (property) {
        keys.add(property[1]);
      }
    }
    nested += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
  }
  return keys;
}

const layoutKeys = arrayKeys('packages/layout/src/params.ts');
const cache = new Map();
function acceptedKeys(bag) {
  const id = bag.names[0];
  if (!cache.has(id)) {
    const keys = new Set();
    if (bag.interface) {
      const parsed = typeKeys(bag.sources[0], bag.interface);
      if (!parsed) {
        throw new Error(
          `${bag.sources[0]}: no ${bag.interface} (the guide table cannot be checked)`,
        );
      }
      for (const key of parsed) {
        keys.add(key);
      }
    }
    if (bag.widget) {
      for (const key of BASE_WIDGET_KEYS) {
        keys.add(key);
      }
      for (const key of layoutKeys) {
        keys.add(key);
      }
    }
    for (const source of bag.sources) {
      for (const key of arrayKeys(source)) {
        keys.add(key);
      }
    }
    for (const name of bag.types ?? []) {
      const parsed = bag.sources.map((source) => typeKeys(source, name)).find(Boolean);
      if (!parsed) {
        throw new Error(
          `no ${name} in ${bag.sources.join(', ')} (the guide table cannot be checked)`,
        );
      }
      for (const key of parsed) {
        keys.add(key);
      }
    }
    for (const key of bag.extra ?? []) {
      keys.add(key);
    }
    cache.set(id, keys);
  }
  return cache.get(id);
}

/**
 * Every bag a table could document, from the heading stack around it (innermost first, then the file's
 * own default for tables no heading names).
 *
 * The stack matters, and it is how a reader resolves it too: an option table usually sits under a bare
 * "### 选项" or "## 2. 选项", so the *enclosing* heading that names the widget is what attributes it —
 * "## 2. 选项" inside "## 1. \`ScrollView\`" is the scroll view's table. Guide 08's appendix names the
 * widget directly ("### \`Label\`"), and the layout chapter's `字段` tables are named by nothing at all,
 * which is what the per-bag `file` default is for.
 *
 * A heading may name more than one bag ("`TextField` / `TextArea`"): a key counts as documented when *any*
 * of them accepts it, which is what such a combined table means.
 */
function bagsFor(headings, file) {
  const found = new Map();
  for (const heading of headings) {
    for (const bag of BAGS) {
      const named = bag.names.some((name) =>
        new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`, 'i').test(heading),
      );
      const hinted = (bag.hints ?? []).some((hint) => heading.includes(hint));
      if (named || hinted) {
        found.set(bag.names[0], bag);
      }
    }
    if (found.size > 0) {
      return [...found.values()];
    }
  }
  return BAGS.filter((bag) => bag.file === file);
}

/** `{ bag, key, file, line }` for every key-table row in `docs/guide/**`. */
function documentedKeys() {
  const found = [];
  const skipped = [];
  const dir = join(root, 'docs/guide');
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.md'))) {
    const file = join(dir, name);
    const lines = readFileSync(file, 'utf8').split('\n');
    let headings = [];
    let keyTable = false;
    lines.forEach((line, index) => {
      const title = /^(#{2,4})\s+(.*)$/.exec(line);
      if (title) {
        const level = title[1].length - 2;
        headings = [...headings.slice(0, level), title[2].trim()];
        keyTable = false;
        return;
      }
      if (!line.startsWith('|')) {
        if (line.trim().length > 0 && !line.startsWith('>')) {
          keyTable = false;
        }
        return;
      }
      const cells = line.split('|').map((cell) => cell.trim());
      const bags = bagsFor([...headings].reverse(), relative(root, file));
      // The header row decides whether this table names options at all: `| 选项 | 默认 |`, `| 字段 | … |`.
      if (!keyTable && /选项|字段/.test(cells[1] ?? '')) {
        keyTable = true;
        if (bags.length === 0) {
          skipped.push(`${relative(root, file)}:${index + 1} (${headings.at(-1) ?? ''})`);
        }
        return;
      }
      if (!keyTable || cells.length < 4) {
        return;
      }
      const key = /^`([A-Za-z][A-Za-z0-9]*)`/.exec(cells[1]);
      if (key && bags.length > 0) {
        found.push({ bags, key: key[1], file: relative(root, file), line: index + 1 });
      }
    });
  }
  return { found, skipped };
}

const { found, skipped } = documentedKeys();
const problems = [];
for (const { bags, key, file, line } of found) {
  if (!bags.some((bag) => acceptedKeys(bag).has(key))) {
    const names = bags.map((bag) => bag.names[0]).join(' / ');
    problems.push(
      `${file}:${line}: \`${names}\` documents "${key}", which it does not accept — an app ` +
        `passing it gets "unknown option" in dev mode and nothing at all in release`,
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`[docs] ${problem}`);
  }
  console.error(`[docs] ${problems.length} documented option key(s) are not accepted by their bag`);
  process.exit(1);
}

console.log(
  `ok   doc options  (${found.length} documented key(s) accepted by their bag` +
    (skipped.length > 0 ? `; ${skipped.length} table(s) skipped: ${skipped.join(', ')}` : '') +
    ')',
);
