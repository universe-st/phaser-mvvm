/**
 * Tests for the widget scope behind the Compose-style DSL.
 *
 * The scope is deliberately free of Phaser runtime imports, so these tests drive it with three-line
 * fake widgets: what matters is the *shape* the DSL produces — sibling order, attachment on emit,
 * isolated subtrees for lazily built rows, and a stack that survives a throwing content lambda.
 */

import { describe, expect, it } from 'vitest';
import {
  buildUiSubtree,
  currentUiScene,
  currentUiScope,
  emitWidget,
  inUiScope,
  runInUiScope,
  uiScopeDepth,
  withUiParent,
} from '../src/uiscope';
import type { Widget } from '../src/Widget';

/* ------------------------------------------------------------------ fakes */

interface FakeWidget {
  name: string;
  parent: FakeWidget | null;
  children: FakeWidget[];
  addWidget(child: FakeWidget): FakeWidget;
}

function fake(name: string): FakeWidget {
  const widget: FakeWidget = {
    name,
    parent: null,
    children: [],
    addWidget(child: FakeWidget) {
      child.parent = widget;
      widget.children.push(child);
      return child;
    },
  };
  return widget;
}

const asWidget = (widget: FakeWidget): Widget => widget as unknown as Widget;
const asFake = (widget: Widget): FakeWidget => widget as unknown as FakeWidget;
const names = (widgets: readonly FakeWidget[]): string[] => widgets.map((w) => w.name);

/** The scope only touches `addWidget`/`parent`, so a fake scene object is enough. */
const scene = { id: 'scene' } as unknown as Parameters<typeof runInUiScope>[0];

/** Creates a fake widget, emits it into the open scope and returns it. */
function emit(name: string): FakeWidget {
  const widget = fake(name);
  emitWidget(asWidget(widget));
  return widget;
}

/** Opens a container in the current scope and runs `content` inside it. */
function container(name: string, content?: () => void): FakeWidget {
  return asFake(withUiParent(asWidget(fake(name)), content));
}

/* ------------------------------------------------------------------ tests */

describe('widget scope · entry and roots', () => {
  it('is closed outside a build and open inside one', () => {
    expect(inUiScope()).toBe(false);
    expect(uiScopeDepth()).toBe(0);
    expect(() => currentUiScope()).toThrow(/open UI scope/);

    runInUiScope(scene, () => {
      expect(inUiScope()).toBe(true);
      expect(uiScopeDepth()).toBe(1);
      expect(currentUiScene()).toBe(scene);
    });

    expect(inUiScope()).toBe(false);
  });

  it('throws a readable error when a composable runs outside a scope', () => {
    expect(() => emit('orphan')).toThrow(/ui\(scene, \(\) => \{ … \}\)/);
  });

  it('collects widgets emitted at the root and reports what was built', () => {
    const built = runInUiScope(scene, () => {
      emit('a');
      emit('b');
      return 'value';
    });

    expect(names(built.roots.map(asFake))).toEqual(['a', 'b']);
    expect(built.result).toBe('value');
    expect(built.widgets).toBe(2);
    expect(built.depth).toBe(1);
  });

  it('counts nested widgets and reports the nesting depth', () => {
    const built = runInUiScope(scene, () => {
      container('outer', () => {
        emit('leaf');
        container('inner', () => {
          emit('deep');
        });
      });
    });

    // outer + leaf + inner + deep
    expect(built.widgets).toBe(4);
    expect(built.depth).toBe(3);
    expect(built.roots).toHaveLength(1);
  });

  it('closes the scope even when the content throws, leaving no half-open frame', () => {
    expect(() =>
      runInUiScope(scene, () => {
        emit('a');
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(inUiScope()).toBe(false);
    const after = runInUiScope(scene, () => emit('b'));
    expect(names(after.roots.map(asFake))).toEqual(['b']);
  });
});

describe('widget scope · attachment', () => {
  it('attaches siblings in source order, each to its own container', () => {
    const { roots } = runInUiScope(scene, () => {
      container('first', () => emit('first.a'));
      container('second', () => emit('second.a'));
    });

    const [first, second] = roots.map(asFake) as [FakeWidget, FakeWidget];
    expect(names(roots.map(asFake))).toEqual(['first', 'second']);
    expect(names(first.children)).toEqual(['first.a']);
    expect(names(second.children)).toEqual(['second.a']);
    expect(first.children[0]?.parent).toBe(first);
  });

  it('nests children under the container that owns the content lambda', () => {
    const { roots } = runInUiScope(scene, () => {
      container('outer', () => {
        emit('a');
        container('inner', () => {
          emit('b');
          emit('c');
        });
      });
    });

    const outer = asFake(roots[0] as Widget);
    const inner = outer.children[1] as FakeWidget;
    expect(names(roots.map(asFake))).toEqual(['outer']);
    expect(names(outer.children)).toEqual(['a', 'inner']);
    expect(names(inner.children)).toEqual(['b', 'c']);
    expect(inner.parent).toBe(outer);
  });

  it('keeps a subtree isolated, so a lazily built row never leaks into the page', () => {
    const { roots } = runInUiScope(scene, () => {
      container('page', () => {
        emit('static');
        const row = buildUiSubtree(scene, () => emit('row'), 'List()');
        expect(asFake(row).parent).toBeNull();
      });
    });

    expect(names(asFake(roots[0] as Widget).children)).toEqual(['static']);
  });

  it('requires exactly one root when building a subtree', () => {
    expect(() => buildUiSubtree(scene, () => undefined, 'List()')).toThrow(/built no widget/);
    expect(() =>
      buildUiSubtree(
        scene,
        () => {
          emit('a');
          emit('b');
        },
        'List()',
      ),
    ).toThrow(/built 2 root widgets/);
  });

  it('restores the enclosing frame after a subtree build', () => {
    runInUiScope(scene, () => {
      emit('before');
      buildUiSubtree(scene, () => emit('row'), 'List()');
      emit('after');
      expect(uiScopeDepth()).toBe(1);
    });
  });
});
