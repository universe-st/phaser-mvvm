/**
 * Transition tests: the easing maths, the policy resolution (config × per-layer override ×
 * `prefers-reduced-motion`) and the frame-stepped runner.
 *
 * All of it is pure — the runner talks to a structural `TransitionTarget` the test fakes in three
 * lines — so the timing model is covered in CI without a renderer. What a browser adds on top is the
 * *rendering* of those values (a dialog actually fading), and that is the `#/modal` acceptance run.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ENTER,
  DEFAULT_EXIT,
  EASINGS,
  INSTANT,
  TransitionRunner,
  easingOf,
  prefersReducedMotion,
  progressOf,
  resolveTransition,
  resolveTransitions,
  type ResolvedTransition,
  type TransitionTarget,
} from '../src/transition';

/** A target that records what the runner wrote, satisfying the structural interface. */
function fakeTarget(alpha = 1, scale = 1) {
  const target: TransitionTarget & { alpha: number; scaleX: number; scaleY: number } = {
    alpha,
    scaleX: scale,
    scaleY: scale,
    setAlpha(value: number) {
      target.alpha = value;
      return target;
    },
    setScale(x: number, y: number) {
      target.scaleX = x;
      target.scaleY = y;
      return target;
    },
  };
  return target;
}

describe('easings', () => {
  it('pins both ends and stays inside 0…1', () => {
    for (const [name, easing] of Object.entries(EASINGS)) {
      expect(easing(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(easing(1), `${name}(1)`).toBeCloseTo(1, 6);
      for (let t = 0; t <= 1; t += 0.05) {
        const value = easing(t);
        expect(value, `${name}(${t})`).toBeGreaterThanOrEqual(0);
        expect(value, `${name}(${t})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is monotonic, so a fade never runs backwards', () => {
    for (const [name, easing] of Object.entries(EASINGS)) {
      let previous = -1;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const value = easing(t);
        expect(value, `${name}(${t})`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('eases out faster than it eases in', () => {
    expect(EASINGS.outCubic(0.25)).toBeGreaterThan(0.25);
    expect(EASINGS.inCubic(0.25)).toBeLessThan(0.25);
    expect(easingOf(undefined)).toBe(EASINGS.linear);
  });
});

describe('resolveTransition', () => {
  it('fills the built-in defaults when nothing is configured', () => {
    const resolved = resolveTransition(undefined, DEFAULT_ENTER);
    expect(resolved.duration).toBe(160);
    expect(resolved.easing).toBe('outCubic');
    expect(resolved.alpha).toEqual([0, 'base']);
    expect(resolved.scale).toEqual([0.96, 'base']);
  });

  it('accepts a bare duration and keeps the rest of the default', () => {
    const resolved = resolveTransition(300, DEFAULT_ENTER);
    expect(resolved.duration).toBe(300);
    expect(resolved.alpha).toEqual([0, 'base']);
  });

  it('treats `false` as "no animation", endpoints and all', () => {
    expect(resolveTransition(false, DEFAULT_ENTER)).toEqual(INSTANT);
    expect(resolveTransition(undefined, DEFAULT_ENTER, true)).toEqual(INSTANT);
  });

  it('keeps the end state of an instant transition but schedules nothing', () => {
    const instant = resolveTransition({ duration: 0 }, DEFAULT_EXIT);
    expect(instant.duration).toBe(0);
    // An instant exit still has to land on `to`, which is what makes "close with no motion" the old
    // synchronous path rather than a dialog stuck at full opacity.
    expect(instant.alpha).toEqual(['base', 0]);
  });

  it('refuses a negative or non-finite duration instead of animating forever', () => {
    expect(resolveTransition({ duration: -40 }, DEFAULT_ENTER).duration).toBe(0);
    expect(resolveTransition({ duration: Number.POSITIVE_INFINITY }, DEFAULT_ENTER).duration).toBe(
      0,
    );
    expect(resolveTransition({ duration: 120, delay: -5 }, DEFAULT_ENTER).delay).toBe(0);
  });

  it('only animates the properties the spec or its fallback mention', () => {
    const alphaOnly = resolveTransition({ duration: 100, fromAlpha: 0 }, { duration: 100 });
    expect(alphaOnly.alpha).toEqual([0, 'base']);
    expect(alphaOnly.scale).toBeNull();

    // Over the built-in enter the unmentioned properties survive, so `{ duration: 300 }` is a slower
    // version of the same fade *and* grow rather than a bare fade.
    const slower = resolveTransition({ duration: 300 }, DEFAULT_ENTER);
    expect(slower.scale).toEqual([0.96, 'base']);
  });
});

describe('resolveTransitions', () => {
  it('defaults to the built-in enter/exit pair', () => {
    const policy = resolveTransitions(undefined, undefined, false);
    expect(policy.enabled).toBe(true);
    expect(policy.reduced).toBe(false);
    expect(policy.enter.duration).toBe(160);
    expect(policy.exit.duration).toBe(120);
    expect(policy.exit.alpha).toEqual(['base', 0]);
  });

  it('collapses both directions when the page asks for reduced motion', () => {
    const policy = resolveTransitions(undefined, undefined, true);
    expect(policy.reduced).toBe(true);
    expect(policy.enter.duration).toBe(0);
    expect(policy.exit.duration).toBe(0);
  });

  it('lets an app opt out of honouring reduced motion', () => {
    const policy = resolveTransitions({ respectReducedMotion: false }, undefined, true);
    expect(policy.reduced).toBe(false);
    expect(policy.enter.duration).toBe(160);
  });

  it('turns everything off with `enabled: false` or a policy-wide `false`', () => {
    expect(resolveTransitions({ enabled: false }, undefined, false).enter.duration).toBe(0);
    const off = resolveTransitions(false, undefined, false);
    expect(off.enabled).toBe(false);
    expect(off.exit.duration).toBe(0);
  });

  it('applies a per-layer override over the policy', () => {
    const policy = resolveTransitions({ enter: 400 }, { enter: 40, exit: false }, false);
    expect(policy.enter.duration).toBe(40);
    expect(policy.exit.duration).toBe(0);
    // The override still inherits the endpoints of the built-in defaults, so it is a fade, not a jump
    // from opacity 0 with no animation.
    expect(policy.enter.alpha).toEqual([0, 'base']);
  });

  it('reads `false` on the layer as "this one does not animate", even under reduced-motion rules', () => {
    const policy = resolveTransitions(undefined, false, true);
    expect(policy.enter.duration).toBe(0);
    expect(policy.reduced).toBe(false);
  });

  it('keeps the reduced-motion flag honest for the dev trace', () => {
    const policy = resolveTransitions(undefined, undefined, true);
    expect(policy.reduced).toBe(true);
    expect(resolveTransitions(undefined, false, true).reduced).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  it('answers false when there is no window to ask', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
  });

  it('reads the media query and survives one that throws', () => {
    const match = (matches: boolean): Window =>
      ({ matchMedia: () => ({ matches }) }) as unknown as Window;
    expect(prefersReducedMotion(match(true))).toBe(true);
    expect(prefersReducedMotion(match(false))).toBe(false);
    const broken = {
      matchMedia: () => {
        throw new Error('nope');
      },
    } as unknown as Window;
    expect(prefersReducedMotion(broken)).toBe(false);
  });
});

describe('progressOf', () => {
  const linear: ResolvedTransition = { ...INSTANT, duration: 100 };

  it('clamps before, inside and after the window', () => {
    expect(progressOf(linear, -10)).toBe(0);
    expect(progressOf(linear, 0)).toBe(0);
    expect(progressOf(linear, 50)).toBeCloseTo(0.5, 6);
    expect(progressOf(linear, 100)).toBe(1);
    expect(progressOf(linear, 500)).toBe(1);
  });

  it('holds the start frame for the whole delay', () => {
    const delayed: ResolvedTransition = { ...linear, delay: 40 };
    expect(progressOf(delayed, 0)).toBe(0);
    expect(progressOf(delayed, 39)).toBe(0);
    expect(progressOf(delayed, 90)).toBeCloseTo(0.5, 6);
    expect(progressOf(delayed, 140)).toBe(1);
  });
});

describe('TransitionRunner', () => {
  it('applies the start frame at once, so no frame shows the finished state', () => {
    const runner = new TransitionRunner();
    const target = fakeTarget();
    expect(runner.run({ target, transition: resolveTransition(undefined, DEFAULT_ENTER) })).toBe(
      true,
    );
    expect(target.alpha).toBe(0);
    expect(target.scaleX).toBeCloseTo(0.96, 6);
    expect(runner.pending).toBe(1);
  });

  it('interpolates over the duration and lands exactly on the end values', () => {
    const runner = new TransitionRunner();
    const target = fakeTarget();
    runner.run({ target, transition: resolveTransition(100, { ...DEFAULT_ENTER, duration: 100 }) });

    runner.step(25);
    expect(target.alpha).toBeGreaterThan(0);
    expect(target.alpha).toBeLessThan(1);

    runner.step(75);
    expect(target.alpha).toBe(1);
    expect(target.scaleX).toBe(1);
    expect(runner.pending).toBe(0);
  });

  it('animates nothing when the transition is instant, and says so', () => {
    const runner = new TransitionRunner();
    const target = fakeTarget();
    const onDone = vi.fn();
    expect(runner.run({ target, transition: INSTANT, onDone })).toBe(false);
    expect(runner.pending).toBe(0);
    // The caller tears down on `false`; a second teardown from `onDone` would double-free the layer.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('lets the newest run take a target over instead of fighting it', () => {
    // V40: a dialog dismissed while it was still appearing had two runs on the same widgets, and the
    // older one won every frame — the dialog faded back in on its way out.
    const runner = new TransitionRunner();
    const target = fakeTarget();
    runner.run({ target, transition: resolveTransition(200, DEFAULT_ENTER) });
    runner.step(40);
    const appearing = target.alpha;
    expect(appearing).toBeGreaterThan(0);
    expect(appearing).toBeLessThan(1);

    // The exit starts from where the entrance got to, and it is the only run left.
    runner.run({ target, transition: resolveTransition(100, DEFAULT_EXIT) });
    expect(runner.pending).toBe(1);
    const from = target.alpha;
    runner.step(50);
    expect(target.alpha).toBeLessThan(from);
    runner.step(100);
    expect(target.alpha).toBe(0);
    expect(runner.pending).toBe(0);
  });

  it('completes a group whose member was taken over by a newer run', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    const target = fakeTarget();
    runner.runGroup([{ target, transition: resolveTransition(200, DEFAULT_ENTER) }], onDone);
    // Nothing was animating the target any more, so the teardown the group deferred must not be left
    // waiting for a run that no longer exists.
    runner.run({ target, transition: resolveTransition(100, DEFAULT_EXIT) });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(runner.pending).toBe(1);
  });

  it('restores a target whose own opacity is not 1 (the scrim)', () => {
    const runner = new TransitionRunner();
    const scrim = fakeTarget(0.5);
    runner.run({
      target: scrim,
      transition: resolveTransition(undefined, DEFAULT_ENTER),
      props: ['alpha'],
    });
    expect(scrim.alpha).toBe(0);
    runner.step(200);
    expect(scrim.alpha).toBeCloseTo(0.5, 6);
    expect(scrim.scaleX).toBe(1); // `props` kept the runner off the scale
  });

  it('runs a group as one unit and reports completion once', () => {
    const runner = new TransitionRunner();
    const scrim = fakeTarget(0.5);
    const body = fakeTarget();
    const onDone = vi.fn();
    const enter = resolveTransition(100, { ...DEFAULT_ENTER, duration: 100 });
    const started = runner.runGroup(
      [
        { target: scrim, transition: enter, props: ['alpha'] },
        { target: body, transition: enter },
      ],
      onDone,
    );
    expect(started).toBe(2);
    runner.step(50);
    expect(onDone).not.toHaveBeenCalled();
    runner.step(50);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(runner.pending).toBe(0);
  });

  it('reports a fully instant group as zero, so the caller keeps the synchronous path', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    expect(runner.runGroup([{ target: fakeTarget(), transition: INSTANT }], onDone)).toBe(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not fire a group before its slowest member finishes', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    const fast = fakeTarget();
    const slow = fakeTarget();
    runner.runGroup(
      [
        { target: fast, transition: resolveTransition(40, DEFAULT_ENTER) },
        { target: slow, transition: resolveTransition(200, DEFAULT_ENTER) },
      ],
      onDone,
    );
    runner.step(50);
    expect(runner.pending).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
    runner.step(200);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('drops a run whose target died, without calling `onDone`', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    const target = Object.assign(fakeTarget(), { isDestroyed: false });
    runner.run({ target, transition: resolveTransition(100, DEFAULT_ENTER), onDone });
    target.isDestroyed = true;
    runner.step(50);
    expect(runner.pending).toBe(0);
    // The scene teardown that destroyed the widget owns the consequences; a second teardown here
    // would touch a dead root.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('refuses to start on a destroyed target', () => {
    const runner = new TransitionRunner();
    const target = Object.assign(fakeTarget(), { isDestroyed: true });
    expect(runner.run({ target, transition: resolveTransition(100, DEFAULT_ENTER) })).toBe(false);
    expect(runner.pending).toBe(0);
  });

  it('cancels one target and leaves the others alone', () => {
    const runner = new TransitionRunner();
    const first = fakeTarget();
    const second = fakeTarget();
    runner.run({ target: first, transition: resolveTransition(100, DEFAULT_ENTER) });
    runner.run({ target: second, transition: resolveTransition(100, DEFAULT_ENTER) });
    expect(runner.cancel(first)).toBe(true);
    expect(runner.pending).toBe(1);
    expect(runner.cancel(first)).toBe(false);
  });

  it('finishes a group when its last member stops, however it stopped', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    const first = fakeTarget();
    const second = fakeTarget();
    const enter = resolveTransition(100, DEFAULT_ENTER);
    runner.runGroup(
      [
        { target: first, transition: enter },
        { target: second, transition: enter },
      ],
      onDone,
    );
    // A cancelled member is a member that will never animate again: the group is only complete once
    // the *other* one is done too.
    runner.cancel(first);
    expect(onDone).not.toHaveBeenCalled();
    runner.step(200);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(runner.pending).toBe(0);
  });

  it('completes a group the moment its last member is cancelled, so no layer is orphaned', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    const first = fakeTarget();
    const second = fakeTarget();
    const enter = resolveTransition(100, DEFAULT_ENTER);
    runner.runGroup(
      [
        { target: first, transition: enter },
        { target: second, transition: enter },
      ],
      onDone,
    );
    runner.cancel(first);
    runner.cancel(second);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(runner.pending).toBe(0);
  });

  it('ignores an empty or nonsensical delta', () => {
    const runner = new TransitionRunner();
    const target = fakeTarget();
    runner.run({ target, transition: resolveTransition(100, DEFAULT_ENTER) });
    expect(runner.step(Number.NaN)).toBe(0);
    expect(runner.step(-5)).toBe(0);
    expect(target.alpha).toBe(0);
    expect(runner.step(100)).toBe(1);
  });

  it('clear() abandons everything without firing callbacks', () => {
    const runner = new TransitionRunner();
    const onDone = vi.fn();
    runner.runGroup(
      [{ target: fakeTarget(), transition: resolveTransition(100, DEFAULT_ENTER) }],
      onDone,
    );
    runner.clear();
    expect(runner.pending).toBe(0);
    expect(runner.step(500)).toBe(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});
