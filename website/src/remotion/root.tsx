import { Composition, Still } from 'remotion';

import { CLIPS } from './clips';
import { OgImage } from './og-image';
import { ProgressRollup } from './progress-rollup';
import { RequestToTicket } from './request-to-ticket';
import { RuleRun } from './rule-run';

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="request-to-ticket"
        component={RequestToTicket}
        durationInFrames={CLIPS['request-to-ticket'].durationInFrames}
        fps={CLIPS['request-to-ticket'].fps}
        width={CLIPS['request-to-ticket'].width}
        height={CLIPS['request-to-ticket'].height}
      />
      <Composition
        id="rule-run"
        component={RuleRun}
        durationInFrames={CLIPS['rule-run'].durationInFrames}
        fps={CLIPS['rule-run'].fps}
        width={CLIPS['rule-run'].width}
        height={CLIPS['rule-run'].height}
      />
      <Composition
        id="progress-rollup"
        component={ProgressRollup}
        durationInFrames={CLIPS['progress-rollup'].durationInFrames}
        fps={CLIPS['progress-rollup'].fps}
        width={CLIPS['progress-rollup'].width}
        height={CLIPS['progress-rollup'].height}
      />
      <Still id="og-image" component={OgImage} width={1200} height={630} />
    </>
  );
}
