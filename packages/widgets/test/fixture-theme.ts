/**
 * A `Theme` fixture for the pure-module tests.
 *
 * The tests import `type Theme` only, so no Phaser module is loaded: the fixture is a plain object
 * literal with recognisable values that make assertions readable (`colors.text` is `0x112233`, every
 * font size is `16`, …).
 */

import type { Theme } from '@phaser-mvvm/phaser';

export const TEST_THEME: Theme = {
  name: 'test',
  colors: {
    background: 0x000001,
    surface: 0x101010,
    surfaceAlt: 0x202020,
    surfaceHover: 0x303030,
    overlay: 0x010203,
    primary: 0x2f6feb,
    primaryHover: 0x3b7cf5,
    primaryPressed: 0x2559c9,
    onPrimary: 0xfefefe,
    text: 0x112233,
    textMuted: 0x445566,
    textDisabled: 0x778899,
    border: 0xaabbcc,
    borderStrong: 0xccddee,
    danger: 0xf85149,
    success: 0x3fb950,
    warning: 0xd29922,
    focusRing: 0x58a6ff,
  },
  fontFamily: 'Test Sans',
  fontSize: { xs: 10, sm: 12, md: 16, lg: 20, xl: 26 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  controlHeight: { sm: 28, md: 36, lg: 44 },
  borderWidth: 1,
  focusRingWidth: 2,
  motion: { enter: 160, exit: 120 },
};
