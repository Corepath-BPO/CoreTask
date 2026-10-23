import { Plus } from 'lucide-react';

import { Reveal } from '@/components/motion';
import { Container, SectionHeading } from '@/components/ui';
import { faq } from '@/content/site';

/**
 * Native <details>: every answer is in the HTML and opens without JavaScript,
 * which is what both crawlers and the FAQ's structured data expect.
 */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-28 lg:py-36">
      <Container className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHeading
          id="faq-title"
          eyebrow={faq.eyebrow}
          title={faq.title}
          className="self-start lg:sticky lg:top-28"
        />
        <Reveal>
          <div className="border-t border-line-2">
            {faq.items.map((item, i) => (
              <details key={item.q} open={i === 0} className="group border-b border-line-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[1.05rem] font-medium transition-colors hover:text-brand">
                  <h3>{item.q}</h3>
                  <Plus
                    aria-hidden
                    className="size-5 shrink-0 text-faint transition-transform duration-300 group-open:rotate-45 group-open:text-brand"
                  />
                </summary>
                <p className="max-w-2xl pb-6 text-[0.98rem] leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
