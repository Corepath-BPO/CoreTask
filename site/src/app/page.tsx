import { Footer } from '@/components/footer';
import { JsonLd } from '@/components/json-ld';
import { Nav } from '@/components/nav';
import { automate, capture, track } from '@/content/site';
import { ClipSection } from '@/sections/clip-section';
import { Collaborate } from '@/sections/collaborate';
import { Connect } from '@/sections/connect';
import { Faq } from '@/sections/faq';
import { FinalCta } from '@/sections/final-cta';
import { Hero } from '@/sections/hero';
import { Plan } from '@/sections/plan';
import { Problem } from '@/sections/problem';
import { Security } from '@/sections/security';

/*
 * The story, top to bottom: the scattered state of things, then one chapter
 * per thing CoreTask does with a request — capture it, plan it, automate it,
 * talk about it, track it, connect it — then why it is safe, then the ask.
 */
export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <ClipSection
          id="capture"
          copy={capture}
          clip="request-to-ticket"
          clipLabel="An email, a Slack message and a form submission each become a ticket in CoreTask's ticket queue, keyed, prioritised and assigned."
          steps={['Email', 'Slack', 'Form', 'Queue']}
        />
        <Plan />
        <ClipSection
          id="automate"
          copy={automate}
          clip="rule-run"
          clipLabel="A CoreTask rule runs on a new ticket: an AI check decides it is urgent, so the rule sets the priority to High, assigns the on-call person and posts to Slack."
          steps={['Trigger', 'AI check', 'Actions', 'Notify']}
          flip
        />
        <Collaborate />
        <ClipSection
          id="track"
          copy={track}
          clip="progress-rollup"
          clipLabel="A CoreTask goal at 68% rolled up from three projects, a burn-up chart, and a workload view where a task moves from someone over capacity to a teammate with room."
          steps={['Goal', 'Projects', 'Burn-up', 'Workload']}
        />
        <Connect />
        <Security />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <JsonLd />
    </>
  );
}
