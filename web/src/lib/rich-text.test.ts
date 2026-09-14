import { describe, expect, it } from 'vitest';

import { htmlToText, isEmptyHtml, looksLikeHtml, plainTextToHtml, toEditorHtml } from './rich-text';

describe('looksLikeHtml', () => {
  it('spots the editor’s markup and leaves prose alone', () => {
    expect(looksLikeHtml('<p>Hello</p>')).toBe(true);
    expect(looksLikeHtml('a < b and b > c')).toBe(false);
  });
});

describe('plainTextToHtml', () => {
  it('makes one paragraph per line and escapes what it must', () => {
    expect(plainTextToHtml('one\ntwo & "three"')).toBe(
      '<p>one</p><p>two &amp; &quot;three&quot;</p>',
    );
  });
});

describe('toEditorHtml', () => {
  it('passes stored markup through and wraps legacy text', () => {
    expect(toEditorHtml('<p>kept</p>')).toBe('<p>kept</p>');
    expect(toEditorHtml('legacy\ntext')).toBe('<p>legacy</p><p>text</p>');
    expect(toEditorHtml(null)).toBe('');
  });
});

describe('htmlToText', () => {
  it('flattens blocks to a single line of text', () => {
    expect(htmlToText('<p>First</p><ul><li>a</li><li>b &amp; c</li></ul>')).toBe('First a b & c');
  });
});

describe('isEmptyHtml', () => {
  it('sees through empty paragraphs', () => {
    expect(isEmptyHtml('<p></p><p><br></p>')).toBe(true);
    expect(isEmptyHtml('<p>x</p>')).toBe(false);
  });
});
