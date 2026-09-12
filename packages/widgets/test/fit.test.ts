/**
 * `object-fit` maths of the `Image` widget (`computeFit`).
 */

import { describe, expect, it } from 'vitest';
import { computeFit } from '../src/fit';

describe('computeFit', () => {
  it('contains a wide image by width, leaving letterbox space above and below', () => {
    expect(computeFit(200, 100, 100, 100, 'contain')).toEqual({
      scaleX: 0.5,
      scaleY: 0.5,
      width: 100,
      height: 50,
      offsetX: 0,
      offsetY: 25,
    });
  });

  it('contains a tall image by height, leaving pillarbox space left and right', () => {
    const fit = computeFit(100, 200, 100, 100, 'contain');
    expect(fit.scaleX).toBe(0.5);
    expect(fit.scaleY).toBe(0.5);
    expect(fit.width).toBe(50);
    expect(fit.height).toBe(100);
    expect(fit.offsetX).toBe(25);
    expect(fit.offsetY).toBe(0);
  });

  it('contains by upscaling a small image', () => {
    const fit = computeFit(50, 50, 200, 100, 'contain');
    expect(fit.scaleX).toBe(2);
    expect(fit.scaleY).toBe(2);
    expect(fit.width).toBe(100);
    expect(fit.height).toBe(100);
    expect(fit.offsetY).toBe(0);
  });

  it('covers the box with the larger ratio and centres the overflow', () => {
    expect(computeFit(200, 100, 100, 100, 'cover')).toEqual({
      scaleX: 1,
      scaleY: 1,
      width: 200,
      height: 100,
      offsetX: -50,
      offsetY: 0,
    });
  });

  it('covers a shallow box by overflowing vertically', () => {
    const fit = computeFit(100, 200, 200, 100, 'cover');
    expect(fit.scaleX).toBe(2);
    expect(fit.scaleY).toBe(2);
    expect(fit.width).toBe(200);
    expect(fit.height).toBe(400);
    expect(fit.offsetY).toBe(-150);
  });

  it('stretches independently on both axes for fill', () => {
    expect(computeFit(200, 100, 100, 200, 'fill')).toEqual({
      scaleX: 0.5,
      scaleY: 2,
      width: 100,
      height: 200,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('keeps the natural size and centres it for none', () => {
    expect(computeFit(200, 100, 300, 300, 'none')).toEqual({
      scaleX: 1,
      scaleY: 1,
      width: 200,
      height: 100,
      offsetX: 50,
      offsetY: 100,
    });
  });

  it('defaults to contain', () => {
    expect(computeFit(200, 100, 100, 100)).toEqual(computeFit(200, 100, 100, 100, 'contain'));
  });

  it('returns a zero-sized centred result for a degenerate source', () => {
    expect(computeFit(0, 100, 80, 40, 'cover')).toEqual({
      scaleX: 1,
      scaleY: 1,
      width: 0,
      height: 0,
      offsetX: 40,
      offsetY: 20,
    });
  });

  it('treats a non-finite source size as degenerate', () => {
    const fit = computeFit(Number.NaN, 100, 80, 40, 'fill');
    expect(fit.width).toBe(0);
    expect(fit.height).toBe(0);
    expect(Number.isFinite(fit.scaleX)).toBe(true);
  });

  it('treats a negative box size as empty instead of producing negative scales', () => {
    const fit = computeFit(100, 100, -50, 40, 'contain');
    expect(fit.scaleX).toBe(0);
    expect(fit.scaleY).toBe(0);
    expect(fit.width).toBe(0);
    expect(fit.height).toBe(0);
  });

  it('fits into a zero-height box without dividing by zero', () => {
    const fit = computeFit(100, 100, 40, 0, 'fill');
    expect(fit.scaleX).toBe(0.4);
    expect(fit.scaleY).toBe(0);
    expect(Number.isFinite(fit.offsetY)).toBe(true);
  });
});
