/**
 * Ambient declarations for the widget factories.
 *
 * This file is a real module (it has an `export {}`) so bundlers can resolve it; the
 * `declare global` block performs the actual declaration merging with Phaser's global namespace, the
 * same way `@phaser-mvvm/phaser` declares `scene.add.vbox(...)` and `scene.mvvm`.
 *
 * `uiLabel` is declared here on purpose: the widget library owns that key from M4 on, replacing the
 * probe widget the adapter shipped while the library did not exist yet.
 */

import type { Widget } from '@phaser-mvvm/phaser';
import type { Button, ButtonOptions } from './Button';
import type { Divider, DividerOptions } from './Divider';
// Aliased: inside `Phaser.GameObjects` the identifier `Image` already means `Phaser.GameObjects.Image`.
import type { Image as UIImage, ImageOptions } from './Image';
import type { Label, LabelOptions } from './Label';
import type { Panel, PanelOptions } from './Panel';
import type { Spacer, SpacerOptions } from './Spacer';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Phaser {
    namespace GameObjects {
      interface GameObjectFactory {
        /** Creates a text label widget and adds it to the Scene. */
        uiLabel(options?: LabelOptions, children?: Widget[]): Label;
        /** Creates a panel widget (a themed box container) and adds it to the Scene. */
        uiPanel(options?: PanelOptions, children?: Widget[]): Panel;
        /** Creates a button widget and adds it to the Scene. */
        uiButton(options?: ButtonOptions, children?: Widget[]): Button;
        /** Creates a texture image widget and adds it to the Scene. */
        uiImage(options: ImageOptions, children?: Widget[]): UIImage;
        /** Creates a layout spacer widget and adds it to the Scene. */
        uiSpacer(options?: SpacerOptions, children?: Widget[]): Spacer;
        /** Creates a divider widget and adds it to the Scene. */
        uiDivider(options?: DividerOptions, children?: Widget[]): Divider;
      }
    }
  }
}

export {};
