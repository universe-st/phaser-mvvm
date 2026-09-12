/**
 * `planBack`: who owns a `back` action (Escape / gamepad B).
 *
 * The rule used to be implicit in `MVVMPlugin.handleBack()`, which meant it could only be checked
 * through a browser: a modal gets first refusal (a non-dismissible one *swallows* the action), then
 * the page stack, and only an app with nowhere left to go runs its own `onBack`. The interesting
 * cases are the boundaries — an empty page stack, the base page, and a dialog on top of a page.
 */

import { describe, expect, it } from 'vitest';
import { planBack } from '../src/back-plan';

describe('planBack', () => {
  it('gives the action to a modal whenever one is open', () => {
    expect(planBack({ modalDepth: 1, pageDepth: 1 })).toBe('modal');
    expect(planBack({ modalDepth: 2, pageDepth: 3 })).toBe('modal');
  });

  it('falls through to the page stack once the modal stack is empty', () => {
    expect(planBack({ modalDepth: 0, pageDepth: 2 })).toBe('page');
    expect(planBack({ modalDepth: 0, pageDepth: 5 })).toBe('page');
  });

  it('never asks the page stack to pop its base page', () => {
    // Popping the last page would leave an empty screen, so a single-page app owns its own `back`.
    expect(planBack({ modalDepth: 0, pageDepth: 1 })).toBe('app');
    expect(planBack({ modalDepth: 0, pageDepth: 0 })).toBe('app');
  });

  it('hands the action to the app when there is nothing at all', () => {
    expect(planBack({ modalDepth: 0, pageDepth: 0 })).toBe('app');
  });
});
