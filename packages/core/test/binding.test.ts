/**
 * The binding layer (PLAN §4.4): path compiler, scope chain, converters and interpolated templates.
 *
 * Everything here is a pure function of its inputs, so the whole file runs in plain Node — no
 * Phaser, no DOM, no renderer.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  BindingContext,
  PathSyntaxError,
  TemplateSyntaxError,
  applyConverter,
  compilePath,
  compileTemplate,
  converterNames,
  createBinding,
  effectScope,
  formatTemplate,
  hasConverter,
  interpolate,
  isBindingContext,
  parseInterpolation,
  parsePath,
  ref,
  registerConverter,
  resetConverters,
  scopeOfPathScope,
  unregisterConverter,
  type PathScope,
} from '../src/index';

beforeEach(() => {
  resetConverters();
});

describe('compilePath · syntax', () => {
  it('compiles a single property', () => {
    const path = compilePath('title');
    expect(path.segments).toEqual(['title']);
    expect(path.source).toBe('title');
  });

  it('compiles a nested path', () => {
    expect(compilePath('user.address.city').segments).toEqual(['user', 'address', 'city']);
  });

  it('compiles bracket indices and mixes them with properties', () => {
    expect(compilePath('a.b[0].c').segments).toEqual(['a', 'b', '0', 'c']);
    expect(compilePath('items[1].name').segments).toEqual(['items', '1', 'name']);
    expect(compilePath('matrix[0][1]').segments).toEqual(['matrix', '0', '1']);
  });

  it('accepts quoted keys inside brackets', () => {
    const path = compilePath("row['first name']");
    expect(path.segments).toEqual(['row', 'first name']);
    expect(path.get({ row: { 'first name': 'Ada' } })).toBe('Ada');
  });

  it('keeps the scope variables as plain segments', () => {
    expect(compilePath('$item.name').segments).toEqual(['$item', 'name']);
    expect(compilePath('$root.items[0].id').segments).toEqual(['$root', 'items', '0', 'id']);
  });

  it('trims surrounding whitespace', () => {
    expect(compilePath('  user.name  ').segments).toEqual(['user', 'name']);
  });

  it('rejects an empty expression with a positioned error', () => {
    expect(() => compilePath('   ')).toThrow(PathSyntaxError);
    try {
      compilePath('   ');
      expect.unreachable('compilePath should have thrown');
    } catch (error) {
      const failure = error as PathSyntaxError;
      expect(failure.position).toBe(0);
      expect(failure.message).toContain('position');
    }
  });

  it('rejects a doubled dot and reports its offset', () => {
    try {
      compilePath('a..b');
      expect.unreachable('compilePath should have thrown');
    } catch (error) {
      const failure = error as PathSyntaxError;
      expect(failure).toBeInstanceOf(PathSyntaxError);
      expect(failure.position).toBe(2);
      expect(failure.source).toBe('a..b');
    }
  });

  it('rejects a trailing dot', () => {
    expect(() => compilePath('a.')).toThrow(/position 2/);
  });

  it('rejects an unterminated bracket', () => {
    expect(() => compilePath('a[0')).toThrow(/expected "\]"/);
  });

  it('rejects an empty bracket', () => {
    expect(() => compilePath('a[]')).toThrow(/numeric index or a quoted key/);
  });

  it('rejects a bare-word bracket key', () => {
    expect(() => compilePath('a[b]')).toThrow(/numeric index or a quoted key/);
  });

  it('rejects an expression starting with a digit', () => {
    expect(() => compilePath('0abc')).toThrow(PathSyntaxError);
  });

  it('rejects an expression starting with a bracket', () => {
    expect(() => compilePath('[0]')).toThrow(/must start with a property name/);
  });

  it('rejects a space between two segments', () => {
    expect(() => compilePath('a b')).toThrow(/expected "\." or "\["/);
  });

  it('rejects an unterminated quoted key', () => {
    expect(() => compilePath("a['b]")).toThrow(/unterminated string key/);
  });

  it('parses segments through parsePath as well', () => {
    expect(parsePath('a[2].b')).toEqual(['a', '2', 'b']);
  });
});

describe('compilePath · reading', () => {
  it('reads a nested value', () => {
    const path = compilePath('user.address.city');
    expect(path.get({ user: { address: { city: 'Paris' } } })).toBe('Paris');
  });

  it('reads an array index', () => {
    expect(compilePath('items[1].name').get({ items: [{ name: 'a' }, { name: 'b' }] })).toBe('b');
  });

  it('reads a nested array index', () => {
    expect(
      compilePath('matrix[1][0]').get({
        matrix: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toBe(3);
  });

  it('returns undefined instead of throwing on a missing link', () => {
    expect(compilePath('missing.deep.value').get({})).toBeUndefined();
    expect(compilePath('items[9].name').get({ items: [{ name: 'a' }] })).toBeUndefined();
    expect(compilePath('a.b').get({ a: null })).toBeUndefined();
  });

  it('resolves un-prefixed paths against $vm when the scope carries one', () => {
    const scope: PathScope = { $vm: { title: 'page' }, title: 'shadowed' };
    expect(compilePath('title').get(scope)).toBe('page');
  });

  it('resolves un-prefixed paths against the scope object itself without $vm', () => {
    expect(compilePath('title').get({ title: 'page' })).toBe('page');
  });

  it('resolves $root to the scope itself when no $root is declared', () => {
    expect(compilePath('$root.title').get({ title: 'page' })).toBe('page');
  });

  it('resolves $root and $item from the scope variables', () => {
    const scope: PathScope = {
      $vm: { total: 3 },
      $root: { $vm: { total: 42 } },
      $item: { name: 'row' },
    };
    expect(compilePath('$root.total').get(scope)).toBe(42);
    expect(compilePath('$item.name').get(scope)).toBe('row');
  });

  it('resolves $index and defaults it to 0', () => {
    expect(compilePath('$index').get({ $vm: {}, $index: 7 })).toBe(7);
    expect(compilePath('$index').get({ $vm: {} })).toBe(0);
  });

  it('resolves $parent to null when there is none', () => {
    expect(compilePath('$parent.title').get({ $vm: {} })).toBeUndefined();
  });

  it('resolves chained scope variables', () => {
    const grandParent: PathScope = { $vm: { name: 'grand' }, $root: null };
    grandParent.$root = grandParent;
    const parent: PathScope = { $vm: { name: 'parent' }, $parent: grandParent, $root: grandParent };
    const scope: PathScope = { $vm: { name: 'leaf' }, $parent: parent, $root: grandParent };

    expect(compilePath('$parent.name').get(scope)).toBe('parent');
    expect(compilePath('$parent.$parent.name').get(scope)).toBe('grand');
    expect(compilePath('$parent.$index').get(scope)).toBe(0);
  });

  it('reads a character from a string value', () => {
    expect(compilePath('name[1]').get({ name: 'abc' })).toBe('b');
  });

  it('compiles the same source independently each time', () => {
    const first = compilePath('a.b');
    const second = compilePath('a.b');
    expect(first).not.toBe(second);
    expect(first.get({ a: { b: 1 } })).toBe(second.get({ a: { b: 1 } }));
  });
});

describe('compilePath · writing', () => {
  it('writes a top-level property', () => {
    const target: Record<string, unknown> = {};
    expect(compilePath('title').set(target, 'hello')).toBe(true);
    expect(target.title).toBe('hello');
  });

  it('writes a nested property', () => {
    const target = { user: { address: { city: 'Paris' } } };
    expect(compilePath('user.address.city').set(target, 'Rome')).toBe(true);
    expect(target.user.address.city).toBe('Rome');
  });

  it('writes through an array index', () => {
    const target = { items: [{ name: 'a' }, { name: 'b' }] };
    expect(compilePath('items[1].name').set(target, 'c')).toBe(true);
    expect(target.items[1]?.name).toBe('c');
  });

  it('writes through a quoted key', () => {
    const target: Record<string, unknown> = { row: {} };
    expect(compilePath("row['first name']").set(target, 'Ada')).toBe(true);
    expect((target.row as Record<string, unknown>)['first name']).toBe('Ada');
  });

  it('returns false when the target container does not exist', () => {
    expect(compilePath('missing.deep').set({}, 1)).toBe(false);
    expect(compilePath('items[3].name').set({ items: [] }, 'x')).toBe(false);
  });

  it('refuses to write a scope variable itself', () => {
    expect(compilePath('$index').set({ $vm: {} }, 3)).toBe(false);
    expect(compilePath('$item').set({ $vm: {} }, 3)).toBe(false);
    expect(compilePath('$root').set({ $vm: {} }, 3)).toBe(false);
  });

  it('writes through $root into the root data object', () => {
    const root = { title: 'old' };
    const scope: PathScope = { $vm: { title: 'leaf' }, $root: { $vm: root } };
    expect(compilePath('$root.title').set(scope, 'new')).toBe(true);
    expect(root.title).toBe('new');
    expect((scope.$vm as { title: string }).title).toBe('leaf');
  });

  it('writes into the $vm of a scope object', () => {
    const vm = { title: 'old' };
    expect(compilePath('title').set({ $vm: vm }, 'new')).toBe(true);
    expect(vm.title).toBe('new');
  });
});

describe('BindingContext', () => {
  it('resolves un-prefixed paths against the view model', () => {
    const context = new BindingContext({ title: 'page', items: [{ name: 'a' }] });
    expect(context.resolve('title')).toBe('page');
    expect(context.resolve('items[0].name')).toBe('a');
    expect(context.vm).toEqual({ title: 'page', items: [{ name: 'a' }] });
  });

  it('resolves missing paths to undefined', () => {
    expect(new BindingContext({}).resolve('a.b.c')).toBeUndefined();
  });

  it('exposes the scope variables of the root level', () => {
    const context = new BindingContext({ title: 'page' });
    expect(context.$parent).toBeNull();
    expect(context.$root).toBe(context);
    expect(context.$index).toBe(0);
    expect(context.$item).toBeUndefined();
    expect(context.resolve('$index')).toBe(0);
  });

  it('derives a child scope that inherits the vm and adds $item/$index', () => {
    const root = new BindingContext({ title: 'page' });
    const row = root.child({ item: { name: 'row' }, index: 3 });

    expect(row.vm).toBe(root.vm);
    expect(row.resolve('title')).toBe('page');
    expect(row.resolve('$item.name')).toBe('row');
    expect(row.resolve('$index')).toBe(3);
    expect(row.$parent).toBe(root);
  });

  it('lets a child scope override the vm (a list row binding its own item)', () => {
    const root = new BindingContext({ title: 'page' });
    const item = { name: 'row' };
    const row = root.child({ item, index: 1, vm: item });

    expect(row.resolve('name')).toBe('row');
    expect(row.resolve('$root.title')).toBe('page');
    expect(row.resolve('$parent.title')).toBe('page');
    expect(row.resolve('$item.name')).toBe('row');
  });

  it('walks a multi-level scope chain', () => {
    const root = new BindingContext({ title: 'root' });
    const middle = root.child({ item: { name: 'middle' }, index: 1, vm: { name: 'middle' } });
    const leaf = middle.child({ item: { name: 'leaf' }, index: 2, vm: { name: 'leaf' } });

    expect(leaf.resolve('name')).toBe('leaf');
    expect(leaf.resolve('$parent.name')).toBe('middle');
    expect(leaf.resolve('$parent.$parent.title')).toBe('root');
    expect(leaf.resolve('$parent.$index')).toBe(1);
    expect(leaf.$root).toBe(root);
  });

  it('compiles each path once and caches it', () => {
    const context = new BindingContext({ a: 1 });
    expect(context.compile('a')).toBe(context.compile('a'));
    expect(context.compile('a')).not.toBe(context.compile('b'));
  });

  it('accepts a pre-compiled path in resolve()', () => {
    const context = new BindingContext({ a: { b: 2 } });
    expect(context.resolve(compilePath('a.b'))).toBe(2);
  });

  it('writes through the context', () => {
    const vm = { user: { name: 'old' } };
    const context = new BindingContext(vm);
    expect(context.set('user.name', 'new')).toBe(true);
    expect(vm.user.name).toBe('new');
    expect(context.set('$index', 5)).toBe(false);
  });

  it('builds a scope object shared with the expression compiler', () => {
    const context = new BindingContext({ a: 1 });
    const node = context.scopeNode;
    expect(node).toBe(context.scopeNode);
    expect(node.$root).toBe(node);
    expect(compilePath('a').get(node)).toBe(1);
    expect(scopeOfPathScope(node).resolve('a')).toBe(1);
  });

  it('is recognised by isBindingContext', () => {
    expect(isBindingContext(new BindingContext({}))).toBe(true);
    expect(isBindingContext({})).toBe(false);
    expect(isBindingContext(null)).toBe(false);
  });
});

describe('applyConverter · built-ins', () => {
  it('upper/lower/trim operate on the text form', () => {
    expect(applyConverter('upper', 'ab')).toBe('AB');
    expect(applyConverter('lower', 'AB')).toBe('ab');
    expect(applyConverter('trim', '  ab  ')).toBe('ab');
    expect(applyConverter('upper', null)).toBe('');
    expect(applyConverter('lower', 42)).toBe('42');
  });

  it('number parses text and keeps the numeric type', () => {
    expect(applyConverter('number', '12.5')).toBe(12.5);
    expect(applyConverter('number', 3)).toBe(3);
    expect(applyConverter('number', 'nope')).toBe('');
  });

  it('number(decimals) rounds to a fixed precision', () => {
    expect(applyConverter('number', '12.345', 2)).toBe('12.35');
    expect(applyConverter('number', 2, 0)).toBe('2');
  });

  it('money formats with a default symbol and two decimals', () => {
    expect(applyConverter('money', 12)).toBe('$12.00');
    expect(applyConverter('money', '7.5', '€', 1)).toBe('€7.5');
    expect(applyConverter('money', 'nope')).toBe('$0.00');
  });

  it('join concatenates arrays', () => {
    expect(applyConverter('join', ['a', 'b'])).toBe('a, b');
    expect(applyConverter('join', [1, 2, 3], '-')).toBe('1-2-3');
    expect(applyConverter('join', 'solo')).toBe('solo');
  });

  it('default replaces empty values', () => {
    expect(applyConverter('default', null, 'n/a')).toBe('n/a');
    expect(applyConverter('default', undefined, 'n/a')).toBe('n/a');
    expect(applyConverter('default', '', 'n/a')).toBe('n/a');
    expect(applyConverter('default', 0, 'n/a')).toBe(0);
    expect(applyConverter('default', 'x', 'n/a')).toBe('x');
  });

  it('date formats with a default and a custom pattern', () => {
    const date = new Date(2026, 0, 9, 8, 7, 6);
    expect(applyConverter('date', date)).toBe('2026-01-09');
    expect(applyConverter('date', date, 'DD/MM/YYYY HH:mm:ss')).toBe('09/01/2026 08:07:06');
    expect(applyConverter('date', 'not a date')).toBe('');
  });

  it('throws for an unknown converter', () => {
    expect(() => applyConverter('nope', 1)).toThrow(/Unknown converter "nope"/);
  });

  it('registers, replaces and removes converters', () => {
    expect(hasConverter('kebab')).toBe(false);
    registerConverter('kebab', (value) => String(value).replace(/\s+/g, '-'));
    expect(hasConverter('kebab')).toBe(true);
    expect(applyConverter('kebab', 'a b')).toBe('a-b');

    registerConverter('kebab', () => 'replaced');
    expect(applyConverter('kebab', 'a b')).toBe('replaced');
    expect(unregisterConverter('kebab')).toBe(true);
    expect(hasConverter('kebab')).toBe(false);
    expect(unregisterConverter('kebab')).toBe(false);
  });

  it('rejects invalid registrations', () => {
    expect(() => registerConverter('', () => 1)).toThrow(TypeError);
    expect(() => registerConverter('x', null as never)).toThrow(TypeError);
  });

  it('exposes the built-in names and restores them after reset', () => {
    expect(converterNames()).toEqual([
      'upper',
      'lower',
      'trim',
      'number',
      'money',
      'join',
      'default',
      'date',
    ]);
    registerConverter('temp', (value) => value);
    resetConverters();
    expect(converterNames()).not.toContain('temp');
    expect(hasConverter('upper')).toBe(true);
  });
});

describe('parseInterpolation / formatTemplate', () => {
  it('parses a single expression between two text chunks', () => {
    expect(parseInterpolation('共 {{ items.length }} 项')).toEqual([
      { type: 'text', value: '共 ' },
      {
        type: 'expression',
        path: 'items.length',
        source: 'items.length',
        converters: [],
      },
      { type: 'text', value: ' 项' },
    ]);
  });

  it('returns a single text segment for a template without holes', () => {
    expect(parseInterpolation('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
  });

  it('returns nothing for the empty template', () => {
    expect(parseInterpolation('')).toEqual([]);
  });

  it('drops empty text chunks between adjacent expressions', () => {
    const segments = parseInterpolation('{{ a }}{{ b }}');
    expect(segments.map((segment) => segment.type)).toEqual(['expression', 'expression']);
    expect(formatTemplate({ resolve: (path) => path.toUpperCase() }, segments)).toBe('AB');
  });

  it('keeps the text after the last expression', () => {
    const segments = parseInterpolation('{{ a }} tail');
    expect(segments).toHaveLength(2);
    expect(formatTemplate({ resolve: () => 1 }, segments)).toBe('1 tail');
  });

  it('parses converter calls with literal arguments', () => {
    const segments = parseInterpolation("{{ price | money('€', 1) }}");
    const expression = segments[0];
    expect(expression?.type).toBe('expression');
    if (expression?.type !== 'expression') return;
    expect(expression.path).toBe('price');
    expect(expression.converters).toEqual([{ name: 'money', args: ['€', 1] }]);
  });

  it('parses a converter chain and a bare converter', () => {
    const segments = parseInterpolation('{{ name | trim | upper }}');
    const expression = segments[0];
    if (expression?.type !== 'expression') throw new Error('expected an expression segment');
    expect(expression.converters).toEqual([
      { name: 'trim', args: [] },
      { name: 'upper', args: [] },
    ]);
  });

  it('formats text and values together', () => {
    const scope = { resolve: (path: string) => ({ 'items.length': 3 })[path] };
    expect(formatTemplate(scope, parseInterpolation('共 {{ items.length }} 项'))).toBe('共 3 项');
  });

  it('renders a missing path as empty text', () => {
    expect(interpolate({ resolve: () => undefined }, 'a{{ missing.value }}b')).toBe('ab');
    expect(interpolate({ resolve: () => null }, 'a{{ x }}b')).toBe('ab');
  });

  it('renders numbers, booleans and arrays', () => {
    expect(interpolate({ resolve: () => 0 }, '{{ x }}')).toBe('0');
    expect(interpolate({ resolve: () => false }, '{{ x }}')).toBe('false');
    expect(interpolate({ resolve: () => [1, 2] }, '{{ x }}')).toBe('1, 2');
  });

  it('accepts a bare resolver function', () => {
    expect(formatTemplate(() => 'direct', parseInterpolation('{{ x }}'))).toBe('direct');
  });

  it('applies converters while formatting', () => {
    const scope = { resolve: () => '  ada  ' };
    expect(interpolate(scope, '{{ name | trim | upper }}')).toBe('ADA');
    expect(interpolate({ resolve: () => 3 }, '{{ n | money("$", 1) }}')).toBe('$3.0');
  });

  it('rejects an unknown converter used in a template', () => {
    expect(() => interpolate({ resolve: () => 1 }, '{{ n | nope }}')).toThrow(/Unknown converter/);
  });

  it('escapes "{{" so it renders literally', () => {
    expect(parseInterpolation(String.raw`\{{ raw }}`)).toEqual([
      { type: 'text', value: '{{ raw }}' },
    ]);
  });

  it('escapes "}}" and a backslash', () => {
    expect(parseInterpolation(String.raw`a \}} b`)).toEqual([{ type: 'text', value: 'a }} b' }]);
    expect(parseInterpolation(String.raw`a \\ b`)).toEqual([{ type: 'text', value: 'a \\ b' }]);
  });

  it('mixes an escaped hole with a real one', () => {
    const segments = parseInterpolation(String.raw`\{{ lit }} {{ real }}`);
    expect(segments[0]).toEqual({ type: 'text', value: '{{ lit }} ' });
    expect(segments[1]?.type).toBe('expression');
  });

  it('throws for an unterminated hole', () => {
    expect(() => parseInterpolation('a {{ b')).toThrow(TemplateSyntaxError);
  });

  it('throws for an empty hole', () => {
    expect(() => parseInterpolation('a {{ }} b')).toThrow(/expression is empty/);
  });

  it('throws for an invalid path inside a hole and reports the template offset', () => {
    try {
      parseInterpolation('ab {{ a..b }}');
      expect.unreachable('parseInterpolation should have thrown');
    } catch (error) {
      const failure = error as TemplateSyntaxError;
      expect(failure).toBeInstanceOf(TemplateSyntaxError);
      expect(failure.position).toBe(7);
    }
  });

  it('throws for an unterminated converter call', () => {
    expect(() => parseInterpolation('{{ n | money(2 }}')).toThrow(/unterminated converter/);
  });

  it('compiles a template once and reuses it', () => {
    const template = compileTemplate('{{ a }}-{{ b }}');
    expect(template.segments).toHaveLength(3);
    expect(template.format({ resolve: (path) => path })).toBe('a-b');
    expect(template.format({ resolve: () => 'x' })).toBe('x-x');
    expect(template.source).toBe('{{ a }}-{{ b }}');
  });

  it('reads a template against a BindingContext', () => {
    const context = new BindingContext({ title: 'page', items: [1, 2] });
    expect(interpolate(context, '{{ title }} ({{ items.length }})')).toBe('page (2)');
  });
});

describe('createBinding', () => {
  it('applies the current value immediately and again on change', () => {
    const host = { scope: effectScope(true) };
    const value = ref(1);
    const seen: number[] = [];
    const stop = createBinding({
      host,
      read: () => value.value,
      apply: (next) => seen.push(next),
      flush: 'sync',
    });

    value.value = 2;
    expect(seen).toEqual([1, 2]);
    stop();
  });

  it('skips apply when the value did not change', () => {
    const host = { scope: effectScope(true) };
    const value = ref(1);
    const trigger = ref(0);
    const seen: number[] = [];
    createBinding({
      host,
      read: () => {
        trigger.value;
        return value.value;
      },
      apply: (next) => seen.push(next),
      flush: 'sync',
    });

    trigger.value = 1;
    trigger.value = 2;
    expect(seen).toEqual([1]);
  });

  it('stops applying once the binding is stopped', () => {
    const host = { scope: effectScope(true) };
    const value = ref(0);
    const seen: number[] = [];
    const stop = createBinding({
      host,
      read: () => value.value,
      apply: (next) => seen.push(next),
      flush: 'sync',
    });

    value.value = 1;
    stop();
    value.value = 2;
    expect(seen).toEqual([0, 1]);
  });

  it('stops when the host scope stops', () => {
    const scope = effectScope(true);
    const value = ref(0);
    const seen: number[] = [];
    createBinding({
      host: { scope },
      read: () => value.value,
      apply: (next) => seen.push(next),
      flush: 'sync',
    });

    scope.stop();
    value.value = 9;
    expect(seen).toEqual([0]);
  });

  it('honours a custom equality function', () => {
    const host = { scope: effectScope(true) };
    const value = ref({ id: 1 });
    const seen: Array<{ id: number }> = [];
    createBinding({
      host,
      read: () => value.value,
      apply: (next) => seen.push(next),
      equals: (a, b) => a.id === b.id,
      flush: 'sync',
    });

    value.value = { id: 1 };
    value.value = { id: 2 };
    expect(seen.map((entry) => entry.id)).toEqual([1, 2]);
  });
});
