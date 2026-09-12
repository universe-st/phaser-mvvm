import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { bindCommand, bindEnabled, bindError, bindText, bindVisible } from '@phaser-mvvm/phaser';
import type { Panel } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/**
 * MVVM demo: a ViewModel made of `ref`/`computed`, a view built from widgets, and bindings that keep
 * the two in sync.
 *
 * Everything state-driven goes through bindings (`bindText` / `bindVisible` / `bindEnabled` /
 * `bindError` / `bindCommand`), and every binding lives in the widget's `EffectScope`: the "Replace
 * view" action destroys and rebuilds the tree, which proves the old subscriptions are gone (the
 * counters keep working, nothing double-fires).
 */
export class BindingsScene extends Phaser.Scene {
  private count = ref(0);
  private detailsVisible = ref(false);
  private busy = ref(false);
  private unitPrice = ref(19.5);
  private viewRevision = ref(0);

  private total = computed(() => this.count.value * this.unitPrice.value);
  private discounted = computed(() => this.total.value >= 100);
  private price = computed(() =>
    this.discounted.value ? this.total.value * 0.9 : this.total.value,
  );
  private invalid = computed(() => this.count.value > 8);
  private summary = computed(
    () =>
      `${this.count.value} item(s) · $${this.price.value.toFixed(2)}` +
      (this.discounted.value ? ' · bulk discount' : ''),
  );

  private page: Panel | null = null;

  constructor() {
    super('bindings');
  }

  create(): void {
    this.buildView();
    setDemoState('scene', 'bindings');
    this.report();
  }

  private buildView(): void {
    const theme = this.mvvm.theme;

    const summaryLabel = this.add.uiLabel({ text: this.summary.value, width: 400 });
    bindText(summaryLabel, () => this.summary.value);
    bindError(summaryLabel, () => this.invalid.value);

    const details = this.add.uiPanel(
      { direction: 'vertical', gap: 6, padding: 12, variant: 'surfaceAlt', radius: 8, width: 400 },
      [
        this.add.uiLabel({ text: 'Unit price', tone: 'muted' }),
        this.add.uiLabel({ text: `$${this.unitPrice.value.toFixed(2)}` }),
        this.add.uiLabel({
          text: 'Bulk discount applies from $100 (computed, no manual refresh).',
          tone: 'muted',
          maxLines: 2,
          ellipsis: true,
        }),
      ],
    );
    bindVisible(details, () => this.detailsVisible.value);

    const addButton = this.add.uiButton({
      text: 'Add item',
      variant: 'primary',
      name: 'add',
      onClick: () => {
        this.count.value += 1;
        this.syncDemoState();
      },
    });
    // Enabled state is derived from the ViewModel, not toggled by hand.
    bindEnabled(addButton, () => !this.busy.value && this.count.value < 9);

    const removeButton = this.add.uiButton({
      text: 'Remove',
      variant: 'secondary',
      name: 'remove',
      onClick: () => {
        this.count.value = Math.max(0, this.count.value - 1);
        this.syncDemoState();
      },
    });
    bindEnabled(removeButton, () => this.count.value > 0 && !this.busy.value);

    const detailsButton = this.add.uiButton({
      text: 'Toggle details',
      variant: 'ghost',
      onClick: () => {
        this.detailsVisible.value = !this.detailsVisible.value;
        this.syncDemoState();
      },
    });

    const busyButton = this.add.uiButton({ text: 'Simulate request', variant: 'secondary' });
    // Command binding: the button runs the command and disables itself while it is in flight.
    bindCommand(busyButton, () => () => this.runFakeRequest(), {
      canExecute: () => !this.busy.value,
    });

    const countLabel = this.add.uiLabel({ text: '', tone: 'muted' });
    bindText(countLabel, () => `count: ${this.count.value} · busy: ${this.busy.value}`);

    const revisionLabel = this.add.uiLabel({ text: '', tone: 'muted' });
    bindText(revisionLabel, () => `view revision: ${this.viewRevision.value}`);

    const replaceButton = this.add.uiButton({
      text: 'Replace view',
      variant: 'danger',
      name: 'replace',
      onClick: () => this.replaceView(),
    });

    this.page = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 20, variant: 'surface', radius: 12, width: 460 },
      [
        this.add.uiLabel({
          text: 'MVVM bindings · M6 slice',
          style: { fontSize: `${theme.fontSize.lg}px` },
        }),
        summaryLabel,
        details,
        this.add.uiDivider({}),
        this.add.uiPanel({ direction: 'horizontal', gap: 8, alignItems: 'center' }, [
          addButton,
          removeButton,
          detailsButton,
        ]),
        this.add.uiPanel({ direction: 'horizontal', gap: 8, alignItems: 'center' }, [
          busyButton,
          replaceButton,
        ]),
        countLabel,
        revisionLabel,
      ],
    );

    this.mvvm.mount(this.page);

    for (const [key, widget] of [
      ['add', addButton],
      ['remove', removeButton],
      ['details', detailsButton],
      ['busy', busyButton],
      ['replace', replaceButton],
    ] as const) {
      reportControl(this, key, widget);
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };
  }

  /** Destroys the current view and rebuilds it; the previous bindings must be gone afterwards. */
  private replaceView(): void {
    const ui = this.mvvm.root;
    if (this.page) {
      ui.removeWidget(this.page, true);
      this.page = null;
    }
    this.viewRevision.value += 1;
    this.buildView();
    this.report();
  }

  private runFakeRequest(): void {
    if (this.busy.value) {
      return;
    }
    this.busy.value = true;
    this.syncDemoState();
    this.time.delayedCall(700, () => {
      this.busy.value = false;
      this.count.value += 1;
      this.syncDemoState();
    });
  }

  private syncDemoState(): void {
    setDemoState('count', this.count.value);
    setDemoState('price', this.price.value.toFixed(2));
    setDemoState('details', this.detailsVisible.value);
    setDemoState('busy', this.busy.value);
    setDemoState('invalid', this.invalid.value);
  }

  private report(): void {
    appendStatus('--- bindings layout ---');
    if (this.page) {
      reportWidget('page', this.page);
    }
    reportCanvas(this.game);
    this.syncDemoState();
  }
}
