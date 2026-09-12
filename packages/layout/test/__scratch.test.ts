import { describe, expect, it } from 'vitest';
import { loose } from '../src/constraint';
import { expectRect, leaf, layout, rectOf, stack } from './harness';

describe('scratch', () => {
  it('probes stack with auto children', () => {
    const a = leaf(undefined, { width: 40, height: 20 });
    const b = leaf(undefined, { width: 80, height: 10 });
    const root = stack({}, [a, b], { height: 100, width: 200 });
    const { size } = layout(root, loose(200, 100));
    console.log('root size', size, 'a', rectOf(a), 'b', rectOf(b), 'measureCounts', a.measureCount);
    expect(size).toEqual({ width: 200, height: 100 });
  });

  it('probes stack with fixed children', () => {
    const a = leaf({ width: 40, height: 20 });
    const root = stack({}, [a], { height: 100, width: 200 });
    layout(root, loose(200, 100));
    console.log('fixed a', rectOf(a));
    expectRect(a, 80, 40, 40, 20);
  });

  it('probes root auto size', () => {
    const a = leaf(undefined, { width: 40, height: 20 });
    const root = stack({}, [a]);
    const { size } = layout(root, loose(200, 100));
    console.log('auto root size', size, 'a', rectOf(a));
    expect(size.width).toBe(40);
  });
});
