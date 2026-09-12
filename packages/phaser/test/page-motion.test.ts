/**
 * Page-transition planning tests.
 *
 * The rules are two lines of intent each — "a push fades the incoming page in over the one below",
 * "a pop keeps the leaving page painted while it fades out" — so what is worth pinning is the parts a
 * browser run would make expensive to check: which side is animated per direction, that a full-page
 * layer never animates its scale, and that a disabled policy (reduced motion, `transition: false`)
 * collapses both to `null` so the caller takes the instantaneous path.
 */

import { describe, expect, it } from 'vitest';
import { planPageMotion } from '../src/page-motion';
import { resolveTransitions } from '../src/transition';

const policy = resolveTransitions(undefined, undefined, false);

describe('planPageMotion', () => {
  it('fades the incoming page in on a push, and animates nothing else', () => {
    const plan = planPageMotion('forward', policy);
    expect(plan.incoming).not.toBeNull();
    expect(plan.incoming?.duration).toBe(160);
    expect(plan.incoming?.alpha).toEqual([0, 'base']);
    expect(plan.outgoing).toBeNull();
    // The page below keeps its pixels: the incoming page fades *over* it, so hiding it first would show
    // the background through the fade.
    expect(plan.keepNeighbourPainted).toBe(true);
  });

  it('keeps the leaving page painted on a pop, and does not fade the revealed one in', () => {
    const plan = planPageMotion('back', policy);
    expect(plan.incoming).toBeNull();
    expect(plan.outgoing).not.toBeNull();
    expect(plan.outgoing?.duration).toBe(120);
    expect(plan.outgoing?.alpha).toEqual(['base', 0]);
    expect(plan.keepNeighbourPainted).toBe(true);
  });

  it('never animates scale for a page', () => {
    // A dialog grows from 0.96; a full-stage page that does the same shrinks the whole stage towards its
    // top-left corner, and the layout pass owns `x` so a slide is not available either.
    expect(planPageMotion('forward', policy).incoming?.scale).toBeNull();
    expect(planPageMotion('back', policy).outgoing?.scale).toBeNull();
  });

  it('collapses to nothing when the policy is off, so the caller stays synchronous', () => {
    const off = resolveTransitions(false, undefined, false);
    const forward = planPageMotion('forward', off);
    expect(forward.incoming).toBeNull();
    expect(forward.keepNeighbourPainted).toBe(false);
    const back = planPageMotion('back', off);
    expect(back.outgoing).toBeNull();
    expect(back.keepNeighbourPainted).toBe(false);
  });

  it('collapses to nothing while the page asks for reduced motion', () => {
    const reduced = resolveTransitions(undefined, undefined, true);
    expect(planPageMotion('forward', reduced).incoming).toBeNull();
    expect(planPageMotion('back', reduced).outgoing).toBeNull();
  });

  it('carries a custom duration and easing through', () => {
    const slow = resolveTransitions(
      { enter: { duration: 400, easing: 'linear' } },
      undefined,
      false,
    );
    const plan = planPageMotion('forward', slow);
    expect(plan.incoming?.duration).toBe(400);
    expect(plan.incoming?.easing).toBe('linear');
    // The other direction still uses its own default.
    expect(planPageMotion('back', slow).outgoing?.duration).toBe(120);
  });

  it('is usable per page: an instant enter still plans a paint-friendly pop', () => {
    const noEnter = resolveTransitions({ enter: 0 }, undefined, false);
    expect(planPageMotion('forward', noEnter).incoming).toBeNull();
    expect(planPageMotion('back', noEnter).outgoing?.duration).toBe(120);
  });
});
