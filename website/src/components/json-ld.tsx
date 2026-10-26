import { faq, site } from '@/content/site';

/**
 * Structured data for search engines: what CoreTask is, who publishes it, and
 * the FAQ — built from the same entries the page shows, as Google requires.
 */
export function JsonLd() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${site.url}/#organization`,
        name: site.name,
        url: site.url,
        logo: `${site.url}/apple-touch-icon.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${site.url}/#website`,
        name: site.name,
        url: site.url,
        publisher: { '@id': `${site.url}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        name: site.name,
        url: site.url,
        description: site.description,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Project management and ticketing',
        operatingSystem: 'Web',
        image: `${site.url}/og.png`,
        publisher: { '@id': `${site.url}/#organization` },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // `<` is escaped so no string in the copy can close the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  );
}
