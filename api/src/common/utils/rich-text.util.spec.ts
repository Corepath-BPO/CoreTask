import { htmlToText, looksLikeHtml, normalizeRichText, plainTextToHtml } from './rich-text.util';

describe('normalizeRichText', () => {
  it('passes undefined through untouched, so "not in this update" survives', () => {
    expect(normalizeRichText(undefined)).toBeUndefined();
  });

  it('treats null, whitespace and empty markup as cleared', () => {
    expect(normalizeRichText(null)).toBeNull();
    expect(normalizeRichText('   ')).toBeNull();
    expect(normalizeRichText('<p></p>')).toBeNull();
    expect(normalizeRichText('<p><br></p><ul><li></li></ul>')).toBeNull();
  });

  it('wraps plain text in paragraphs, one per line, escaping what it must', () => {
    expect(normalizeRichText('Check a < b\n\nThen ship "it"')).toBe(
      '<p>Check a &lt; b</p><p></p><p>Then ship &quot;it&quot;</p>',
    );
  });

  it('keeps the editor’s own markup', () => {
    const html =
      '<p>Read <strong>this</strong> and <em>that</em></p><ul><li>one</li><li>two</li></ul><pre><code>x</code></pre>';
    expect(normalizeRichText(html)).toBe(html);
  });

  it('strips scripts, event handlers and styles while keeping the text', () => {
    expect(
      normalizeRichText(
        '<p onclick="steal()">Hi<script>alert(1)</script></p><style>p{}</style><img src=x onerror=alert(1)>',
      ),
    ).toBe('<p>Hi</p>');
  });

  it('refuses javascript: links and forces every link to open safely elsewhere', () => {
    expect(normalizeRichText('<p><a href="javascript:alert(1)">x</a></p>')).toBe(
      '<p><a target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(normalizeRichText('<p><a href="https://example.com" target="_self">x</a></p>')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
  });

  it('drops attributes the editor never writes', () => {
    expect(normalizeRichText('<p class="x" id="y" style="color:red">text</p>')).toBe('<p>text</p>');
  });
});

describe('normalizeRichText — mentions and images', () => {
  const ada = '019fc880-0000-7000-8000-000000000001';
  const shot = '019fc880-0000-7000-8000-000000000002';

  it('keeps a mention chip with a uuid, lower-cased, and unwraps every other span', () => {
    expect(
      normalizeRichText(`<p>Ask <span data-mention="${ada.toUpperCase()}">@Ada</span></p>`),
    ).toBe(`<p>Ask <span data-mention="${ada}">@Ada</span></p>`);
    expect(
      normalizeRichText(
        '<p><span style="color:red">loud</span> <span data-mention="nope">@Ghost</span></p>',
      ),
    ).toBe('<p>loud @Ghost</p>');
  });

  it('keeps an attachment image by id and alt only, and drops one that names no attachment', () => {
    expect(
      normalizeRichText(
        `<p>See</p><img data-attachment="${shot}" alt="shot.png" src="https://evil.example/x.png">`,
      ),
    ).toBe(`<p>See</p><img data-attachment="${shot}" alt="shot.png" />`);
    expect(normalizeRichText('<p>See</p><img src="https://evil.example/x.png">')).toBe(
      '<p>See</p>',
    );
  });

  it('does not treat a description that is only an image as empty', () => {
    expect(normalizeRichText(`<img data-attachment="${shot}">`)).toBe(
      `<img data-attachment="${shot}" />`,
    );
  });
});

describe('htmlToText', () => {
  it('reads the words out, with a space where a block ended', () => {
    expect(htmlToText('<p>One <strong>two</strong></p><p>three &amp; four</p>')).toBe(
      'One two three & four',
    );
  });
});

describe('looksLikeHtml', () => {
  it('recognises the editor’s tags and nothing else', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeHtml('when a < b and c > d')).toBe(false);
    expect(looksLikeHtml('<unknown>tag</unknown>')).toBe(false);
  });
});

describe('plainTextToHtml', () => {
  it('handles Windows line endings', () => {
    expect(plainTextToHtml('a\r\nb')).toBe('<p>a</p><p>b</p>');
  });
});
