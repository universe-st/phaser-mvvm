import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effect,
  flushSync,
  makeObservable,
  onDevWarning,
  reactive,
  resetDevWarnings,
  setDevMode,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('makeObservable()', () => {
  it('turns own fields into tracked accessors', () => {
    class Counter {
      count = 0;
      label = 'idle';

      constructor() {
        makeObservable(this);
      }
    }

    const vm = new Counter();
    const seen: number[] = [];
    effect(() => {
      seen.push(vm.count);
    });
    vm.count = 1;
    expect(vm.count).toBe(1);
    flushSync();
    expect(seen).toEqual([0, 1]);
    // Non-observable reads still work.
    expect(vm.label).toBe('idle');
  });

  it('short-circuits writes of an equal value', () => {
    class Counter {
      count = 0;

      constructor() {
        makeObservable(this);
      }
    }
    const vm = new Counter();
    const spy = vi.fn();
    effect(() => {
      spy(vm.count);
    });
    spy.mockClear();
    vm.count = 0;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('notifies for undefined → value and value → value transitions', () => {
    class Form {
      name: string | undefined = undefined;
      count = 1;

      constructor() {
        makeObservable(this);
      }
    }
    const vm = new Form();
    const seen: Array<string | undefined> = [];
    effect(() => {
      seen.push(vm.name);
    });
    vm.name = 'a';
    flushSync();
    vm.name = 'b';
    flushSync();
    expect(seen).toEqual([undefined, 'a', 'b']);
  });

  it('makes object and array fields deeply reactive by default', () => {
    class List {
      items: number[] = [];
      meta = { total: 0 };

      constructor() {
        makeObservable(this);
      }
    }
    const vm = new List();
    const runs: number[] = [];
    effect(() => {
      runs.push(vm.items.length);
    });
    vm.items.push(1);
    flushSync();
    expect(runs).toEqual([0, 1]);

    let metaRuns = 0;
    effect(() => {
      void vm.meta.total;
      metaRuns++;
    });
    vm.meta.total = 2;
    flushSync();
    expect(metaRuns).toBe(2);
  });

  it('supports an explicit spec', () => {
    class Model {
      count = 0;
      raw = { nested: 1 };
      shallow = { nested: 1 };
      deep = { nested: 1 };

      constructor() {
        makeObservable(this, { count: 'ref', raw: 'ref', shallow: 'shallow', deep: 'reactive' });
      }
    }
    const vm = new Model();

    let countRuns = 0;
    effect(() => {
      void vm.count;
      countRuns++;
    });
    vm.count = 1;
    flushSync();
    expect(countRuns).toBe(2);

    // A 'ref'/'shallow' field only tracks reassignment.
    let rawRuns = 0;
    effect(() => {
      void vm.raw.nested;
      rawRuns++;
    });
    vm.raw.nested = 2;
    flushSync();
    expect(rawRuns).toBe(1);
    vm.raw = { nested: 3 };
    flushSync();
    expect(rawRuns).toBe(2);

    // A 'reactive' field wraps plain objects and arrays.
    let deepRuns = 0;
    effect(() => {
      void vm.deep.nested;
      deepRuns++;
    });
    vm.deep.nested = 5;
    flushSync();
    expect(deepRuns).toBe(2);

    let shallowRuns = 0;
    effect(() => {
      void vm.shallow.nested;
      shallowRuns++;
    });
    vm.shallow.nested = 9;
    flushSync();
    expect(shallowRuns).toBe(1);
  });

  it('wraps later assignments of a declared reactive field', () => {
    class Model {
      items: number[] = [];

      constructor() {
        makeObservable(this, { items: 'reactive' });
      }
    }
    const vm = new Model();
    vm.items = [1, 2];
    let runs = 0;
    effect(() => {
      void vm.items.length;
      runs++;
    });
    vm.items.push(3);
    flushSync();
    expect(runs).toBe(2);
    expect(vm.items).toEqual([1, 2, 3]);
  });

  it('leaves methods and arrow-function fields untouched', () => {
    class Model {
      count = 0;
      handler = () => this.count + 1;

      constructor() {
        makeObservable(this);
      }

      increment(): void {
        this.count++;
      }
    }
    const vm = new Model();
    const handlerBefore = vm.handler;
    makeObservable(vm);
    expect(vm.handler).toBe(handlerBefore);
    vm.increment();
    expect(vm.count).toBe(1);
    expect(vm.handler()).toBe(2);
    expect(typeof Model.prototype.increment).toBe('function');
  });

  it('works with fields defined through Object.defineProperty (useDefineForClassFields)', () => {
    class Model {
      declare count: number;
    }
    const vm = new Model();
    Object.defineProperty(vm, 'count', {
      configurable: true,
      enumerable: true,
      value: 0,
      writable: true,
    });
    makeObservable(vm);

    const descriptor = Object.getOwnPropertyDescriptor(vm, 'count')!;
    expect(typeof descriptor.get).toBe('function');
    expect(descriptor.enumerable).toBe(true);

    const seen: number[] = [];
    effect(() => {
      seen.push(vm.count);
    });
    vm.count = 7;
    flushSync();
    expect(seen).toEqual([0, 7]);
  });

  it('supports declared fields that are not defined yet', () => {
    class Model {
      constructor() {
        makeObservable(this, { late: 'ref' });
      }
      late!: number;
    }
    const vm = new Model();
    const seen: Array<number | undefined> = [];
    effect(() => {
      seen.push(vm.late);
    });
    vm.late = 3;
    flushSync();
    expect(seen).toEqual([undefined, 3]);
  });

  it('does not double-wrap an already observable instance', () => {
    class Model {
      count = 0;

      constructor() {
        makeObservable(this);
        makeObservable(this);
      }
    }
    const vm = new Model();
    let runs = 0;
    effect(() => {
      void vm.count;
      runs++;
    });
    vm.count = 1;
    flushSync();
    expect(runs).toBe(2);
    expect(vm.count).toBe(1);
  });

  it('returns the same instance and keeps typeof checks intact', () => {
    class Model {
      count = 0;
    }
    const vm = new Model();
    expect(makeObservable(vm)).toBe(vm);
    expect(typeof vm.count).toBe('number');
    expect(JSON.stringify(vm)).toBe('{"count":0}');
  });

  it('ignores frozen fields gracefully when they are already accessors', () => {
    const warnings: string[] = [];
    const off = onDevWarning((message) => warnings.push(message));
    class Model {
      value = 1;

      constructor() {
        Object.defineProperty(this, 'value', {
          configurable: true,
          enumerable: true,
          get: () => 1,
        });
        makeObservable(this);
      }
    }
    const vm = new Model();
    expect(vm.value).toBe(1);
    off();
    expect(warnings).toEqual([]);
  });

  it('keeps the field reactive after the observable unit is written from an effect', () => {
    class Model {
      count = 0;
      doubled = 0;

      constructor() {
        makeObservable(this);
      }
    }
    const vm = new Model();
    effect(() => {
      vm.doubled = vm.count * 2;
    });
    vm.count = 3;
    flushSync();
    expect(vm.doubled).toBe(6);
  });

  it('reactive() fields keep proxy identity through makeObservable', () => {
    class Model {
      nested = { count: 0 };

      constructor() {
        makeObservable(this);
      }
    }
    const vm = new Model();
    expect(reactive(vm.nested)).toBe(vm.nested);
  });
});
