import { describe, expect, it } from 'vitest';

describe.sequential('test setup storage isolation', () => {
  it('can seed a persisted i18n language inside one test', () => {
    localStorage.setItem('mygitnexus.lng', 'zh-CN');

    expect(localStorage.getItem('mygitnexus.lng')).toBe('zh-CN');
  });

  it('clears the persisted i18n language before the next test', () => {
    expect(localStorage.getItem('mygitnexus.lng')).toBeNull();
  });
});
