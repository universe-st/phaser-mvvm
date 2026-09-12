import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { bindText, bindValue } from '@phaser-mvvm/phaser';
import type { TextField } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget } from '../status';

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

  private validEmail = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.value));
  private status = computed(() =>
    this.validEmail.value ? 'ready to submit' : 'enter a valid email address',
  );

  constructor() {
    super('form');
  }

  create(): void {
    const theme = this.mvvm.theme;

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

    const hint = this.add.uiLabel({ text: '', tone: 'muted', width: 360 });
    bindText(hint, () => this.status.value);

    const submitButton = this.add.uiButton({
      text: 'Submit',
      variant: 'primary',
      name: 'submit',
      onClick: () => {
        this.submitted.value = `submitted: ${this.name.value} / ${this.email.value}`;
        setDemoState('submitted', this.submitted.value);
      },
    });

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 20, variant: 'surface', radius: 12, width: 420 },
      [
        this.add.uiLabel({
          text: 'Form · M5 text inputs',
          style: { fontSize: `${theme.fontSize.lg}px` },
        }),
        nameField,
        emailField,
        notesArea,
        hint,
        submitButton,
      ],
    );

    this.mvvm.mount(page);

    nameField.on('change', (value: string) => {
      this.name.value = value;
      setDemoState('name', value);
    });
    notesArea.on('change', (value: string) => {
      this.notes.value = value;
      setDemoState('notes', value.replace(/\n/g, '\\n'));
    });
    emailField.on('change', (value: string) => {
      this.email.value = value;
      setDemoState('email', value);
      setDemoState('emailValid', this.validEmail.value);
    });
    emailField.on('blur', () => setDemoState('emailError', emailField.getError() ?? ''));

    for (const [key, widget] of [
      ['name', nameField],
      ['email', emailField],
      ['notes', notesArea],
      ['submit', submitButton],
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
    reportCanvas(this.game);
    setDemoState('scene', 'form');
    setDemoState('name', '');
    setDemoState('email', '');
  }
}
