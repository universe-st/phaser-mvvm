/**
 * `#/a11y` — the acceptance page for the hidden DOM mirror (`A11yBridge`, PLAN §1.2 / §4.3).
 *
 * The mirror exists for screen readers, so the checks read the **real DOM**: every assertion in
 * `docs/ACCEPTANCE-a11y.md` goes through `querySelectorAll('[data-mvvm-a11y]')` and the attributes on
 * those nodes, never through the widget tree. That is the only way to catch "the role is right in the
 * object but wrong in the DOM".
 *
 * The page keeps one of each interesting case: a plain button, a toggle (checkbox), a disabled button,
 * a slider, a field that is *invalid* until you type something, a multi-line field, a clickable panel,
 * a scroll region, and a `Label` that must **not** be mirrored (it is not interactive; it is read
 * through whatever owns it).
 *
 * `window.a11y`: `nodes()` / `live()` / `announce(text)` / `sync()` / `enabled(on)` / `focus(name)` /
 * `focusName()` / `focusables()` / `state()` / `counts()`.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { A11Y_ATTRIBUTE, A11Y_LIVE_ATTRIBUTE, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Divider,
  Panel,
  Scroll,
  Slider,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/** One mirrored node, read straight out of the DOM. */
interface MirrorNode {
  name: string;
  role: string;
  label: string;
  value: string;
  checked: string;
  disabled: string;
  invalid: string;
  text: string;
}

export class A11yScene extends Phaser.Scene {
  private readonly volume = ref(40);
  private readonly notify = ref(true);
  private readonly name = ref('');

  private page: Widget | null = null;
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('a11y');
  }

  create(): void {
    this.buildPage();
    this.exposeApi();

    setDemoState('scene', 'a11y');
    appendStatus('--- a11y ---');
    reportCanvas(this.game);
    this.reportGeometry();
    // The mirror is built when the page is mounted (the plugin refreshes on the structural change),
    // but a check should never have to guess that timing.
    this.mvvm.a11y.refresh();
  }

  private buildPage(): void {
    // The DSL needs an open scope (`ui()`), exactly like every other scene: the widgets are built
    // inside the lambda, never at the top level.
    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 12,
          padding: 20,
          variant: 'surface',
          radius: 12,
          width: 620,
          name: 'a11y.page',
        },
        () => {
          this.track('title', Text('无障碍镜像 · A11yBridge', { size: 'lg', name: 'a11y.title' }));
          this.track(
            'hint',
            Text('屏幕阅读器看不到画布：每个可交互控件在这里有一个隐藏的 DOM 镜像节点。', {
              tone: 'muted',
              name: 'a11y.hint',
              maxLines: 2,
            }),
          );
          Divider({});

          this.track(
            'plain',
            Button('普通按钮', {
              variant: 'primary',
              name: 'a11y.plain',
              onClick: () => this.announce('已点击'),
            }),
          );
          this.track(
            'toggle',
            Button('接收通知', {
              name: 'a11y.toggle',
              label: '接收通知',
              toggle: true,
              value: this.notify,
              variant: 'secondary',
            }),
          );
          this.track(
            'disabled',
            Button('不可用按钮', { name: 'a11y.disabled', variant: 'ghost', disabled: true }),
          );

          this.track(
            'slider',
            Slider({
              name: 'a11y.volume',
              label: '音量',
              value: this.volume,
              min: 0,
              max: 100,
              step: 5,
              width: 240,
            }),
          );

          this.track(
            'field',
            TextField({
              name: 'a11y.field',
              label: '名字',
              value: this.name,
              placeholder: '名字（必填）',
              validate: (value: string) => (value.trim().length === 0 ? '名字不能为空' : null),
            }),
          );
          this.track(
            'notes',
            TextArea({
              name: 'a11y.notes',
              label: '备注',
              placeholder: '备注',
              height: 56,
              maxLength: 80,
            }),
          );

          this.track(
            'card',
            Panel(
              {
                direction: 'vertical',
                gap: 6,
                padding: 10,
                variant: 'surfaceAlt',
                radius: 8,
                interactive: true,
                name: 'a11y.card',
                label: '可点击的卡片',
              },
              () => {
                this.track('cardText', Text('可点击的卡片', { tone: 'muted' }));
              },
            ),
          );

          this.track(
            'region',
            Scroll(
              { height: 72, name: 'a11y.region', label: '按钮区域', scrollbar: 'auto' },
              () => {
                Panel({ direction: 'vertical', gap: 6, width: 'fill' }, () => {
                  for (let index = 1; index <= 6; index++) {
                    this.track(
                      `region.${index}`,
                      Button(`区域内的按钮 ${index}`, {
                        name: `a11y.region.button${index}`,
                        variant: 'ghost',
                        size: 'sm',
                      }),
                    );
                  }
                });
              },
            ),
          );

          this.track(
            'tail',
            Text('这段文字不是控件，因此没有镜像节点。', { tone: 'muted', name: 'a11y.tail' }),
          );
        },
      );
    });

    this.page = page;
    this.mvvm.mount(page);
  }

  /** Announces through the live region — what an app does for "saved", "3 of 12", an error, … */
  private announce(message: string): void {
    this.mvvm.a11y.announce(message);
  }

  /** Per-frame probes: counts and focus, so a check can wait for a settled state. */
  override update(): void {
    this.publish('a11y.nodes', this.mirrorNodes().length);
    this.publish('a11y.root', this.mvvm.a11y.container ? 'yes' : 'no');
    this.publish('focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('volume', this.volume.value);
    this.publish('notify', this.notify.value);
    this.publish('name.length', this.name.value.length);
    this.publish('focusables', this.mvvm.focus.focusables.length);
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    return widget;
  }

  /** Every mirrored node, as a screen reader (and a check) would see it. */
  private mirrorNodes(): MirrorNode[] {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[${A11Y_ATTRIBUTE}]`));
    return nodes.map((node) => ({
      name: node.getAttribute('data-mvvm-a11y-name') ?? '',
      role: node.getAttribute('role') ?? '',
      label: node.getAttribute('aria-label') ?? '',
      value: node.getAttribute('aria-valuenow') ?? '',
      checked: node.getAttribute('aria-checked') ?? '',
      disabled: node.getAttribute('aria-disabled') ?? '',
      invalid: node.getAttribute('aria-invalid') ?? '',
      text: node.textContent ?? '',
    }));
  }

  private reportGeometry(): void {
    if (this.page) {
      reportWidget('a11y.page', this.page);
    }
    const title = this.tracked.get('title');
    if (title) {
      reportWidget('a11y.title', title);
    }
    const root = this.mvvm.a11y.container;
    appendStatus(`a11y.root=${root ? 'mounted' : 'missing'} nodes=${this.mirrorNodes().length}`);
  }

  private exposeApi(): void {
    const api = {
      /** The DOM mirror, attribute by attribute. */
      nodes: (): MirrorNode[] => this.mirrorNodes(),
      names: (): string[] => this.mirrorNodes().map((node) => node.name),
      node: (name: string): MirrorNode | null =>
        this.mirrorNodes().find((node) => node.name === name) ?? null,
      /** Text currently in the `aria-live` region. */
      live: (): string =>
        document.querySelector<HTMLElement>(`[${A11Y_LIVE_ATTRIBUTE}]`)?.textContent ?? '',
      liveAttributes: (): { role: string; live: string; atomic: string } | null => {
        const region = document.querySelector<HTMLElement>(`[${A11Y_LIVE_ATTRIBUTE}]`);
        return region
          ? {
              role: region.getAttribute('role') ?? '',
              live: region.getAttribute('aria-live') ?? '',
              atomic: region.getAttribute('aria-atomic') ?? '',
            }
          : null;
      },
      announce: (message: string): void => this.announce(message),
      sync: (): void => this.mvvm.a11y.sync(),
      refresh: (): void => this.mvvm.a11y.refresh(),
      enabled: (on: boolean): boolean => {
        this.mvvm.a11y.enabled = on;
        if (on) {
          this.mvvm.a11y.refresh();
        }
        return this.mvvm.a11y.enabled;
      },
      roots: (): number => document.querySelectorAll('[data-mvvm-a11y-root]').length,
      /** Focus a mirrored widget by name, the way the arrow keys would. */
      focus: (name: string): string => {
        const widget = this.mvvm.focus.focusables.find((candidate) => candidate.name === name);
        if (!widget) {
          return 'not-focusable';
        }
        this.mvvm.focus.focus(widget);
        return this.mvvm.focus.focusedWidget?.name ?? 'none';
      },
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      /** Value helpers, so a check can drive a control without hunting for its coordinates. */
      setVolume: (value: number): number => {
        const slider = this.tracked.get('slider') as unknown as
          { setValue(value: number): unknown } | undefined;
        slider?.setValue(value);
        this.mvvm.a11y.sync(this.tracked.get('slider'));
        return this.volume.value;
      },
      validate: (): string => {
        const field = this.tracked.get('field') as unknown as
          { validateNow?(): unknown } | undefined;
        field?.validateNow?.();
        this.mvvm.a11y.sync(this.tracked.get('field'));
        return String(this.tracked.get('field')?.error ?? 'none');
      },
      counts: (): Record<string, number> => ({
        nodes: this.mirrorNodes().length,
        roots: document.querySelectorAll('[data-mvvm-a11y-root]').length,
        focusables: this.mvvm.focus.focusables.length,
        pointerTargets: this.mvvm.input.widgets.length,
      }),
      state: (): Record<string, unknown> => ({
        nodes: this.mirrorNodes().length,
        root: this.mvvm.a11y.container ? 'mounted' : 'missing',
        enabled: this.mvvm.a11y.enabled,
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
        volume: this.volume.value,
        name: this.name.value,
        live: document.querySelector<HTMLElement>(`[${A11Y_LIVE_ATTRIBUTE}]`)?.textContent ?? '',
      }),
    };
    (window as unknown as { a11y?: unknown }).a11y = api;
  }
}
