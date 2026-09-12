import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { bindText, bindValue, type Widget } from '@phaser-mvvm/phaser';
import { TEXT_INPUT_EVENTS, type TextField } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/** Which trigger produced a submission — the probe records it so a check can attribute the event. */
type SubmitSource = 'name' | 'email' | 'notes' | 'canvas' | 'canvasArea' | 'button';

/**
 * Form demo (M5): `TextField` / `TextArea` driven by a `ref`-based ViewModel.
 *
 * The inputs render inside the canvas but take their text from a hidden DOM `<input>`/`<textarea>`
 * placed over the widget (ADR-0004), which is what makes IME composition (Chinese, Japanese, …) and
 * the mobile soft keyboard work. The page reports the committed values into `#demo-state` so the
 * whole flow can be asserted from the outside.
 */
export class FormScene extends Phaser.Scene {
  private name = ref('');
  private email = ref('');
  private notes = ref('');
  private submitted = ref('');
  private submitCount = 0;

  /** Widgets sampled per frame into `st.*`, so the state machine is observable from `#demo-state`. */
  private fields: Partial<
    Record<'name' | 'email' | 'notes' | 'submit' | 'canvas' | 'canvasArea' | 'canvasRo', Widget>
  > = {};

  private validEmail = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.value));
  private status = computed(() =>
    this.validEmail.value ? 'ready to submit' : 'enter a valid email address',
  );

  constructor() {
    super('form');
  }

  create(): void {
    const nameField = this.add.uiTextField({
      label: 'Name',
      placeholder: 'Ada Lovelace',
      maxLength: 24,
      name: 'name',
      width: 360,
      validate: (value) => (value.trim().length >= 2 ? null : 'at least 2 characters'),
    });
    const emailField = this.add.uiTextField({
      label: 'Email',
      placeholder: 'ada@example.com',
      inputType: 'email',
      name: 'email',
      width: 360,
      validate: () => (this.validEmail.value ? null : 'invalid email'),
    });
    const notesArea = this.add.uiTextArea({
      label: 'Notes',
      placeholder: 'Type here… Enter adds a line, Ctrl/Cmd+Enter submits',
      rows: 3,
      maxLength: 200,
      name: 'notes',
      width: 360,
    });

    // Two-way slice of the binding layer: value flows down, `change` flows back up.
    bindValue(
      emailField,
      () => this.email.value,
      (value, widget) => (widget as TextField).setValue(String(value ?? '')),
    );

    // The **pure-Canvas** fallback (`dom: false`): no hidden element, so the field reads keys from its
    // own capture-phase listener and paints the caret and the selection itself. It is a documented
    // fallback (guide 04 §2) and, until round 88, the one input path with no demo at all - which is
    // where the nastiest keyboard bugs live (V17/V18 both came from exactly this listener).
    const canvasField = this.add.uiTextField({
      label: 'Canvas only',
      placeholder: '纯 Canvas：没有隐藏 input',
      dom: false,
      name: 'canvas',
      width: 360,
      maxLength: 40,
    });
    const canvasArea = this.add.uiTextArea({
      label: 'Canvas only · 多行',
      placeholder: 'Enter 换行、Ctrl/Cmd+Enter 提交',
      dom: false,
      rows: 3,
      name: 'canvasArea',
      width: 360,
    });

    // A **read-only** pure-Canvas field. The DOM path gets that for free from the element's
    // `readonly` attribute, so the canvas path has to enforce it itself — and this is where a
    // clipboard shortcut can slip past the per-key guards, because `Ctrl+X`/`Ctrl+V` are handled by
    // their own code path rather than by the key switch (round 88).
    const canvasLocked = this.add.uiTextField({
      label: 'Canvas only · readOnly',
      dom: false,
      readOnly: true,
      value: 'locked value',
      name: 'canvasRo',
      width: 360,
    });

    const hint = this.add.uiLabel({ text: '', tone: 'muted', width: 360 });
    bindText(hint, () => this.status.value);

    const submitButton = this.add.uiButton({
      text: 'Submit',
      variant: 'primary',
      name: 'submit',
      onClick: () => this.submit('button', this.fieldValue('notes')),
    });

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 20, variant: 'surface', radius: 12, width: 420 },
      [
        this.add.uiLabel({
          text: 'Form · M5 text inputs',
          size: 'lg',
        }),
        nameField,
        emailField,
        notesArea,
        canvasField,
        canvasArea,
        canvasLocked,
        hint,
        submitButton,
      ],
    );

    this.mvvm.mount(page);
    this.fields = {
      name: nameField,
      email: emailField,
      notes: notesArea,
      submit: submitButton,
      canvas: canvasField,
      canvasArea,
      canvasRo: canvasLocked,
    };

    nameField.on('change', (value: string) => {
      this.name.value = value;
      setDemoState('name', value);
    });
    notesArea.on('change', (value: string) => {
      this.notes.value = value;
      setDemoState('notes', value.replace(/\n/g, '\\n'));
    });
    // The placeholder promises "Ctrl/Cmd+Enter submits"; that is a `submit` event, so the page has to
    // subscribe to it - the demo used to advertise a gesture nothing handled.
    notesArea.on(TEXT_INPUT_EVENTS.SUBMIT, () => this.submit('notes', this.fieldValue('notes')));
    emailField.on(TEXT_INPUT_EVENTS.SUBMIT, () => this.submit('email', this.fieldValue('email')));
    nameField.on(TEXT_INPUT_EVENTS.SUBMIT, () => this.submit('name', this.fieldValue('name')));
    canvasField.on(TEXT_INPUT_EVENTS.SUBMIT, () =>
      this.submit('canvas', this.fieldValue('canvas')),
    );
    canvasArea.on(TEXT_INPUT_EVENTS.SUBMIT, () =>
      this.submit('canvasArea', this.fieldValue('canvasArea')),
    );
    // `Enter` in a canvas area inserts a newline (nothing to check there), so a *change* is what proves
    // the area's own key path ran; the caret probe reads the same edit.
    canvasArea.on('change', (value: string) =>
      setDemoState('canvasArea.breaks', (value.match(/\n/g) ?? []).length),
    );
    emailField.on('change', (value: string) => {
      this.email.value = value;
      setDemoState('email', value);
      setDemoState('emailValid', this.validEmail.value);
    });
    emailField.on('blur', () => setDemoState('emailError', emailField.getError() ?? ''));
    nameField.on('blur', () => setDemoState('nameError', nameField.getError() ?? ''));
    notesArea.on('blur', () => setDemoState('notesError', notesArea.getError() ?? ''));

    for (const [key, widget] of [
      ['name', nameField],
      ['email', emailField],
      ['notes', notesArea],
      ['submit', submitButton],
      ['canvas', canvasField],
      ['canvasArea', canvasArea],
      ['canvasRo', canvasLocked],
    ] as const) {
      reportControl(this, key, widget);
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };
    nameField.focus();

    appendStatus('--- form layout ---');
    reportWidget('page', page);
    reportWidget('name', nameField as never);
    reportWidget('email', emailField as never);
    reportWidget('notes', notesArea as never);
    reportWidget('canvas', canvasField as never);
    reportWidget('canvasArea', canvasArea as never);
    reportWidget('canvasRo', canvasLocked as never);
    reportCanvas(this.game);
    setDemoState('scene', 'form');
    setDemoState('name', '');
    setDemoState('email', '');
    setDemoState('nameError', '');
    setDemoState('emailError', '');
    this.exposeGlobals();
  }

  /**
   * Per-frame probe publish, the same shape `#/states` uses: `st.<name>` for each widget's
   * `visualState` plus the derived form facts a check needs. Without it the page's state machine
   * (validation, submit, focus, lengths) is not observable from outside.
   */
  override update(): void {
    for (const [key, widget] of Object.entries(this.fields)) {
      if (!widget || widget.isDestroyed) {
        continue;
      }
      setDemoState(`st.${key}`, widget.visualState);
    }
    const name = this.fields.name as (Widget & { getValue?: () => string }) | undefined;
    const notes = this.fields.notes as (Widget & { getValue?: () => string }) | undefined;
    setDemoState('name.length', name?.getValue?.().length ?? 0);
    setDemoState('notes.breaks', (notes?.getValue?.().match(/\n/g) ?? []).length);
    setDemoState('email.valid', this.validEmail.value);
    setDemoState('hint', this.status.value);
    for (const key of ['canvas', 'canvasArea', 'canvasRo'] as const) {
      const state = this.canvasState(key);
      setDemoState(`${key}.value`, state.value.length);
      setDemoState(`${key}.caret`, state.caret);
      setDemoState(`${key}.selection`, state.selection);
      setDemoState(`${key}.bridged`, state.bridged);
    }
  }

  /** Editing state of one of the pure-Canvas fields. */
  private canvasState(key: 'canvas' | 'canvasArea' | 'canvasRo'): {
    value: string;
    caret: number;
    selection: number;
    bridged: boolean;
  } {
    const field = this.fields[key] as unknown as
      | {
          getValue?: () => string;
          caretIndex?: number;
          selectionAnchor?: number;
          bridged?: boolean;
        }
      | undefined;
    const caret = field?.caretIndex ?? -1;
    const anchor = field?.selectionAnchor ?? caret;
    return {
      value: field?.getValue?.() ?? '',
      caret,
      selection: Math.abs(caret - anchor),
      bridged: field?.bridged === true,
    };
  }

  /**
   * One submission path for every trigger (the Submit button, `Enter` in a single-line field,
   * `Ctrl`/`Cmd`+`Enter` in an area).
   *
   * The probe records **who** submitted and **with which value**. The earlier payload was
   * `name / email` only, which cannot attribute a submit to the field that caused it — and on the
   * pure-Canvas fields that is exactly the question ("did `Ctrl+Enter` submit, or did it just insert
   * a newline?") — round 88.
   */
  private submit(source: SubmitSource, value = ''): void {
    this.submitCount += 1;
    const shown = value.replace(/\n/g, '\\n');
    this.submitted.value = `submitted#${this.submitCount} ${source}:${shown}`;
    setDemoState('submitted', this.submitted.value);
    setDemoState('submits', this.submitCount);
  }

  /** The current value of a field, or `''` when it is gone. */
  private fieldValue(key: 'name' | 'email' | 'notes' | 'canvas' | 'canvasArea'): string {
    const widget = this.fields[key] as { getValue?: () => string } | undefined;
    return widget?.getValue?.() ?? '';
  }

  private exposeGlobals(): void {
    (window as unknown as { form?: unknown }).form = {
      values: () => ({
        name: (this.fields.name as { getValue?: () => string })?.getValue?.() ?? '',
        email: (this.fields.email as { getValue?: () => string })?.getValue?.() ?? '',
        notes: (this.fields.notes as { getValue?: () => string })?.getValue?.() ?? '',
      }),
      errors: () => ({
        name: (this.fields.name as { getError?: () => string | null })?.getError?.() ?? null,
        email: (this.fields.email as { getError?: () => string | null })?.getError?.() ?? null,
        notes: (this.fields.notes as { getError?: () => string | null })?.getError?.() ?? null,
      }),
      states: () =>
        Object.fromEntries(
          Object.entries(this.fields).map(([key, widget]) => [
            key,
            widget?.visualState ?? 'missing',
          ]),
        ),
      focus: () => this.mvvm.focus.focusedWidget?.name || 'none',
      submitted: () => this.submitted.value,
      submits: () => this.submitCount,
      /**
       * The pure-Canvas fields' editing state: value, caret, selection length and whether a bridge
       * exists at all. Caret and selection are what that path has to get right by itself — there is no
       * `<input>` whose `selectionStart` could be the source of truth (round 88).
       */
      canvas: () => ({
        canvas: this.canvasState('canvas'),
        canvasArea: this.canvasState('canvasArea'),
        canvasRo: this.canvasState('canvasRo'),
      }),
    };
  }
}
