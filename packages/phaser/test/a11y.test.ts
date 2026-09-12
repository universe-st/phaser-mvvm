/**
 * Accessibility-mapping tests: which ARIA attribute a descriptor maps to, and what a mirrored node's
 * text content becomes.
 *
 * Both are pure (`a11y.ts` touches the DOM only inside `A11yBridge`), so the mapping is pinned in Node
 * instead of being inferred from whatever a browser run happened to expose. That matters twice over:
 * `aria-valuenow` on a `textbox` is invalid ARIA (a validator complains, a screen reader ignores it),
 * and the node's *text* is what Chrome reports as the AX value of a `div role="textbox"` — writing the
 * readable description line there made every field announce its own label as its value (found on
 * `#/a11y` by reading the browser's computed tree, round 76).
 */

import { describe, expect, it } from 'vitest';
import {
  VALUE_RANGE_ROLES,
  a11yAttributes,
  a11yText,
  describeA11yText,
  type A11yDescriptor,
} from '../src/a11y';

const widget = { name: 'demo.button' };

describe('a11yAttributes', () => {
  it('names a control from its label, and falls back to the debug name', () => {
    expect(a11yAttributes({ role: 'button', label: '删除' }, widget)['aria-label']).toBe('删除');
    expect(a11yAttributes({ role: 'button' }, widget)['aria-label']).toBe('demo.button');
    // A widget with no name and no label gets no attribute at all rather than an empty one.
    expect(a11yAttributes({ role: 'button' }, {})['aria-label']).toBeUndefined();
  });

  it('carries the role, the hint and the states', () => {
    const attributes = a11yAttributes(
      {
        role: 'checkbox',
        label: '接收通知',
        checked: true,
        disabled: true,
        hint: '打开后每天一封',
      },
      widget,
    );
    expect(attributes['role']).toBe('checkbox');
    expect(attributes['aria-checked']).toBe('true');
    expect(attributes['aria-disabled']).toBe('true');
    expect(attributes['aria-description']).toBe('打开后每天一封');
  });

  it('omits the attributes a descriptor does not mention, so they can be removed', () => {
    const attributes = a11yAttributes({ role: 'button', label: '普通按钮' }, widget);
    expect(attributes['aria-disabled']).toBeUndefined();
    expect(attributes['aria-invalid']).toBeUndefined();
    expect(attributes['aria-checked']).toBeUndefined();
    expect(attributes['aria-checked' as string]).toBeUndefined();
  });

  it('writes `aria-checked="false"` for an unchecked toggle instead of omitting it', () => {
    // A checkbox with no `aria-checked` is announced as "not checked" by some readers and as a plain
    // button by others; the state has to be explicit.
    expect(a11yAttributes({ role: 'checkbox', checked: false }, widget)['aria-checked']).toBe(
      'false',
    );
  });

  it('only writes a value range on roles that support one', () => {
    const slider = a11yAttributes(
      { role: 'slider', label: '音量', value: 40, min: 0, max: 100 },
      widget,
    );
    expect(slider['aria-valuenow']).toBe('40');
    expect(slider['aria-valuemin']).toBe('0');
    expect(slider['aria-valuemax']).toBe('100');

    // A textbox takes its value from its content, a checkbox from `aria-checked`: `aria-valuenow` there
    // is invalid ARIA and was written for every text field before round 76.
    const textbox = a11yAttributes({ role: 'textbox', value: 'hello' }, widget);
    expect(textbox['aria-valuenow']).toBeUndefined();
    expect(textbox['aria-valuemin']).toBeUndefined();
    expect(textbox['aria-valuemax']).toBeUndefined();
    expect(
      a11yAttributes({ role: 'checkbox', checked: true }, widget)['aria-valuenow'],
    ).toBeUndefined();
  });

  it('knows the value-range roles it claims to', () => {
    for (const role of VALUE_RANGE_ROLES) {
      expect(a11yAttributes({ role, value: 1 }, widget)['aria-valuenow']).toBe('1');
    }
    for (const role of ['textbox', 'checkbox', 'button', 'region', 'radio', 'switch']) {
      expect(VALUE_RANGE_ROLES.has(role), role).toBe(false);
    }
  });

  it('passes through a role the framework never produces', () => {
    const attributes = a11yAttributes({ role: 'tab', label: '概览' }, widget);
    expect(attributes['role']).toBe('tab');
    expect(attributes['aria-label']).toBe('概览');
  });

  it('writes `aria-modal` only for a modal dialog', () => {
    // The dialog the mirror synthesizes for a modal layer's content root carries `modal: true`; every
    // other descriptor that ever passes through here must not inherit it, because `aria-modal` on a
    // node whose siblings are still in the tree tells a reader to stay inside something that is not
    // actually isolated.
    const dialog = a11yAttributes({ role: 'dialog', label: '删除确认', modal: true }, widget);
    expect(dialog['aria-modal']).toBe('true');
    expect(
      a11yAttributes({ role: 'dialog', label: '删除确认' }, widget)['aria-modal'],
    ).toBeUndefined();
    expect(a11yAttributes({ role: 'region', modal: false }, widget)['aria-modal']).toBeUndefined();
    expect(a11yAttributes({ role: 'button' }, widget)['aria-modal']).toBeUndefined();
  });

  it('leaves a name-less dialog unnamed instead of borrowing the container name', () => {
    // `descriptorFor()` passes `label: ''` for an unlabelled dialog precisely so this fallback does not
    // fire: the widget here *has* a name (`demo.button`), and the dialog must not be announced as the
    // internal container the DSL built.
    expect(a11yAttributes({ role: 'dialog', label: '' }, widget)['aria-label']).toBeUndefined();
    expect(a11yAttributes({ role: 'dialog' }, widget)['aria-label']).toBe('demo.button');
  });
});

describe('a11yText', () => {
  it('is the value alone for a role whose value comes from its text', () => {
    expect(a11yText({ role: 'textbox', label: '名字', value: 'hello' }, widget)).toBe('hello');
    expect(a11yText({ role: 'textbox', label: '名字', value: '' }, widget)).toBe('');
    expect(a11yText({ role: 'textbox', label: '名字' }, widget)).toBe('');
  });

  it('keeps the readable line for every other role', () => {
    expect(a11yText({ role: 'button', label: '普通按钮' }, widget)).toBe('普通按钮');
    expect(a11yText({ role: 'checkbox', label: '接收通知', checked: true }, widget)).toBe(
      '接收通知, checked',
    );
    expect(a11yText({ role: 'slider', label: '音量', value: 40, min: 0, max: 100 }, widget)).toBe(
      '音量, 40',
    );
  });
});

describe('describeA11yText', () => {
  it('reads label, value, state and hint in that order', () => {
    const descriptor: A11yDescriptor = {
      role: 'textbox',
      label: '名字',
      value: 'hello',
      invalid: true,
      hint: '名字不能为空',
    };
    expect(describeA11yText(descriptor, widget)).toBe('名字, hello, invalid, 名字不能为空');
  });

  it('skips an empty value (a real value for a field, but noise read aloud)', () => {
    expect(describeA11yText({ role: 'textbox', label: '名字', value: '' })).toBe('名字');
  });

  it('prefers the toggle state over the value, and never reads both', () => {
    expect(
      describeA11yText({ role: 'checkbox', label: '接收通知', value: 'on', checked: false }),
    ).toBe('接收通知, not checked');
  });

  it('uses the debug name when there is no label, and says nothing when there is neither', () => {
    expect(describeA11yText({ role: 'button' }, widget)).toBe('demo.button');
    expect(describeA11yText({ role: 'button' })).toBe('');
  });
});
