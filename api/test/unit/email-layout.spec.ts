import { renderEmailHtml } from '../../src/integrations/email/email.layout';

/**
 * The header logo is an image the app serves, so its address must be built
 * from the app's own origin — a relative path means nothing inside an inbox.
 */
describe('renderEmailHtml header', () => {
  const html = renderEmailHtml({
    webUrl: 'https://app.coretask.org/',
    preheader: 'Confirm your e-mail address.',
    heading: 'Confirm your e-mail address',
    bodyHtml: '<p>Hi Ada,</p>',
  });

  it('shows the logo from the app, with the product name for clients that hold images back', () => {
    expect(html).toContain('src="https://app.coretask.org/email/coretask-logo.png"');
    expect(html).toContain('alt="CoreTask"');
    expect(html).toMatch(/width="78" height="30"/);
  });
});
