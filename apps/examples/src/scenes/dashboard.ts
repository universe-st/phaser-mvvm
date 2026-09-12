import Phaser from 'phaser';
import type { Label, Panel } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget } from '../status';

interface Metric {
  key: string;
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'warning' | 'danger';
}

/**
 * Composed dashboard demo: header + metric cards in a grid + a footer action bar, with a working
 * theme switch and click counting. Exercises nested containers, `grow`/`fill`, grid cells and the
 * button state machine under real interaction.
 */
export class DashboardScene extends Phaser.Scene {
  private metrics: Metric[] = [
    { key: 'revenue', label: 'Revenue', value: 128_400, tone: 'primary' },
    { key: 'users', label: 'Active users', value: 8_921, tone: 'success' },
    { key: 'latency', label: 'Latency (ms)', value: 142, tone: 'warning' },
    { key: 'errors', label: 'Errors', value: 7, tone: 'danger' },
  ];

  private refreshClicks = 0;
  private themeName: 'dark' | 'light' = 'dark';
  private valueLabels = new Map<string, Label>();

  constructor() {
    super('dashboard');
  }

  create(): void {
    const themeButton = this.add.uiButton({
      text: 'Theme: dark',
      variant: 'secondary',
      size: 'sm',
      name: 'theme',
      onClick: () => {
        this.themeName = this.themeName === 'dark' ? 'light' : 'dark';
        this.mvvm.setTheme(this.themeName);
        themeButton.setText(`Theme: ${this.themeName}`);
        setDemoState('theme', this.themeName);
      },
    });

    const header = this.add.uiPanel(
      {
        direction: 'horizontal',
        gap: 12,
        padding: 16,
        variant: 'surface',
        radius: 10,
        alignItems: 'center',
      },
      [
        this.add.uiLabel({ text: 'Ops dashboard', size: 'lg' }),
        this.add.uiSpacer({ flex: true }),
        this.add.uiLabel({ text: 'theme →', tone: 'muted' }),
        themeButton,
      ],
    );

    const cards = this.metrics.map((metric) =>
      this.add.uiPanel(
        { direction: 'vertical', gap: 6, padding: 16, variant: 'surfaceAlt', radius: 10 },
        [
          this.add.uiLabel({ text: metric.label, tone: 'muted' }),
          this.rememberValueLabel(
            metric.key,
            this.add.uiLabel({
              text: this.formatMetric(metric),
              size: 'xl',
              tone: metric.tone === 'danger' ? 'danger' : 'default',
            }),
          ),
        ],
      ),
    );

    const grid = this.add.uiGrid(
      { columns: 4, columnGap: 12, rowGap: 12, alignItems: 'stretch', justifyItems: 'stretch' },
      cards,
    );

    const footer = this.add.uiPanel(
      { direction: 'horizontal', gap: 10, padding: 12, variant: 'plain', alignItems: 'center' },
      [
        this.add.uiLabel({ text: 'refreshes: 0', tone: 'muted' }),
        this.add.uiSpacer({ flex: true }),
        this.add.uiButton({
          text: 'Refresh data',
          variant: 'primary',
          name: 'refresh',
          onClick: () => {
            this.refreshClicks += 1;
            this.jitterMetrics();
            setDemoState('refreshClicks', this.refreshClicks);
          },
        }),
      ],
    );

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 14, padding: 20, variant: 'plain', alignItems: 'stretch' },
      [
        header,
        grid,
        this.add.uiLabel({
          text: 'Grid of metric cards · theme switch repaints every widget through the theme registry',
          tone: 'muted',
        }),
        this.add.uiSpacer({ flex: true }),
        this.add.uiDivider({}),
        footer,
      ],
    );

    this.mvvm.mount(page);

    reportControl(this, 'theme', themeButton);
    const refreshButton = footer.getWidgetChildren().find((child) => child.name === 'refresh');
    if (refreshButton) {
      reportControl(this, 'refresh', refreshButton as never);
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    appendStatus('--- dashboard layout ---');
    reportWidget('page', page);
    reportWidget('header', header);
    reportWidget('grid', grid);
    reportWidget('card0', cards[0] as Panel);
    reportWidget('footer', footer);
    reportCanvas(this.game);
    setDemoState('scene', 'dashboard');
    setDemoState('theme', this.themeName);
  }

  private rememberValueLabel(key: string, label: Label): Label {
    this.valueLabels.set(key, label);
    return label;
  }

  private jitterMetrics(): void {
    for (const metric of this.metrics) {
      const delta = Math.round((Math.random() - 0.4) * metric.value * 0.08);
      metric.value = Math.max(0, metric.value + delta);
      this.valueLabels.get(metric.key)?.setText(this.formatMetric(metric));
    }
    setDemoState('revenue', this.metrics[0]?.value ?? 0);
  }

  private formatMetric(metric: Metric): string {
    return metric.value >= 1000 ? metric.value.toLocaleString('en-US') : String(metric.value);
  }
}
