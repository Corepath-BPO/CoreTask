import { Mark } from '@/components/brand';
import { Reveal } from '@/components/motion';
import { ButtonLink, Container } from '@/components/ui';
import { finalCta, site } from '@/content/site';

export function FinalCta() {
  return (
    <section
      id="early-access"
      aria-labelledby="early-access-title"
      className="relative overflow-hidden py-32 lg:py-44"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(133_200_84/0.16),transparent_60%)]"
      />
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 opacity-50" />
      <Container className="relative text-center">
        <Reveal>
          <Mark
            id="cta"
            className="mx-auto h-20 w-auto text-fg drop-shadow-[0_0_40px_rgb(113_205_44/0.35)]"
          />
        </Reveal>
        <Reveal delay={0.05}>
          <h2 id="early-access-title" className="display mx-auto mt-10 max-w-4xl">
            {finalCta.title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="lede mx-auto mt-6 max-w-xl">{finalCta.lede}</p>
        </Reveal>
        <Reveal delay={0.15}>
          <div className="mt-10 flex justify-center">
            <ButtonLink href={site.earlyAccessHref}>{finalCta.primary}</ButtonLink>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
