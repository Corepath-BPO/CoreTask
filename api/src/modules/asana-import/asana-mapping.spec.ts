import {
  ApprovalStatus,
  CustomFieldType,
  ProjectMemberRole,
  ProjectStatusValue,
  ProjectVisibility,
  TaskKind,
  WorkspaceRole,
} from '@coretask/contracts';

import {
  approvalStatus,
  inlineImageGids,
  calendarDate,
  clip,
  colorToken,
  commentBody,
  description,
  fieldDefinition,
  linkedFilesHtml,
  projectColor,
  projectRole,
  projectVisibility,
  schedule,
  statusValue,
  taskKind,
  uniqueKey,
  uniqueName,
  workspaceRole,
  type PersonLookup,
} from './asana-mapping';

const BOB_ID = '019a0000-0000-7000-8000-00000000b0b0';
const people: PersonLookup = (gid) =>
  gid === '42' ? { id: BOB_ID, name: 'Bob Builder' } : undefined;

describe('Asana rich text', () => {
  it('turns bare newlines into paragraphs and drops the body wrapper', () => {
    expect(description('<body>First line\nSecond <strong>bold</strong></body>', people)).toBe(
      '<p>First line</p><p>Second <strong>bold</strong></p>',
    );
  });

  it('keeps lists whole, without stray paragraphs around them', () => {
    expect(
      description('<body>Steps:\n<ul><li>One</li><li>Two</li></ul>\nDone.</body>', people),
    ).toBe('<p>Steps:</p><ul><li>One</li><li>Two</li></ul><p>Done.</p>');
  });

  it('makes a mention chip for someone who came across, and text for anyone else', () => {
    const html =
      '<body>Ask <a href="https://app.asana.com/0/42/list" data-asana-gid="42" data-asana-type="user">@Bob Builder</a> and <a data-asana-gid="77" data-asana-type="user">@Carol</a></body>';
    expect(description(html, people)).toBe(
      `<p>Ask <span data-mention="${BOB_ID}">@Bob Builder</span> and @Carol</p>`,
    );
  });

  it('keeps links to tasks, drops embedded images, and sanitises the rest', () => {
    const html =
      '<body><a href="https://app.asana.com/0/1/2">Task</a><img src="https://asana/x.png" data-asana-gid="9"><script>alert(1)</script></body>';
    expect(description(html, people)).toBe(
      '<p><a href="https://app.asana.com/0/1/2" target="_blank" rel="noopener noreferrer">Task</a></p>',
    );
  });

  it('puts an embedded image back as the task’s own copy of the file, once it is here', () => {
    const attachmentId = '0190a8c2-6b3e-7c11-9a2b-1c2d3e4f5a6b';
    const html =
      '<body>See this\n<img src="https://asanausercontent.com/x.png" data-asana-gid="A1" data-asana-type="attachment"></body>';

    expect(description(html, people, (gid) => (gid === 'A1' ? attachmentId : undefined))).toContain(
      `data-attachment="${attachmentId}"`,
    );
    // Not copied yet: left out, as before, until the run writes it again.
    expect(description(html, people)).not.toContain('<img');
    expect(description(html, people)).toContain('See this');
    expect(inlineImageGids(html)).toEqual(['A1']);
    expect(inlineImageGids('<body><img src="https://asana/x.png"></body>')).toEqual([]);
  });

  it('treats empty notes as no description', () => {
    expect(description('<body>\n</body>', people)).toBeNull();
    expect(description(undefined, people)).toBeNull();
  });

  it('writes comments from their rich text, or their plain text when that is all there is', () => {
    expect(commentBody({ gid: '1', html_text: '<body>Looks good</body>' }, people)).toBe(
      '<p>Looks good</p>',
    );
    expect(commentBody({ gid: '2', text: 'a < b\nnext' }, people)).toBe(
      '<p>a &lt; b</p><p>next</p>',
    );
    expect(commentBody({ gid: '3', text: '  ' }, people)).toBeNull();
  });

  it('lists linked files as links', () => {
    expect(linkedFilesHtml([{ name: 'Lease.pdf', url: 'https://drive.test/x?a=1&b=2' }])).toBe(
      '<p><strong>Linked files</strong></p><ul><li><a href="https://drive.test/x?a=1&amp;b=2">Lease.pdf</a></li></ul>',
    );
    expect(linkedFilesHtml([])).toBe('');
  });
});

describe('Asana custom fields', () => {
  it('maps each type to its CoreTask counterpart', () => {
    expect(fieldDefinition({ gid: '1', resource_subtype: 'enum' })?.type).toBe(
      CustomFieldType.SINGLE_SELECT,
    );
    expect(fieldDefinition({ gid: '1', resource_subtype: 'multi_enum' })?.type).toBe(
      CustomFieldType.MULTI_SELECT,
    );
    expect(fieldDefinition({ gid: '1', resource_subtype: 'date' })?.type).toBe(
      CustomFieldType.DATE,
    );
    expect(fieldDefinition({ gid: '1', resource_subtype: 'people' })?.settings).toEqual({
      peopleMode: 'MULTIPLE',
    });
  });

  it('keeps reference, formula and ID fields as text rather than dropping them', () => {
    for (const subtype of ['reference', 'formula', 'custom_id']) {
      expect(fieldDefinition({ gid: '1', resource_subtype: subtype })?.type).toBe(
        CustomFieldType.TEXT,
      );
    }
    expect(fieldDefinition({ gid: '1', resource_subtype: 'something_new' })).toBeNull();
  });

  it('carries number formats across', () => {
    expect(
      fieldDefinition({ gid: '1', resource_subtype: 'number', format: 'currency', precision: 2 })
        ?.settings,
    ).toEqual(
      expect.objectContaining({ numberFormat: 'CURRENCY', currencyCode: 'USD', decimalPlaces: 2 }),
    );
    expect(
      fieldDefinition({ gid: '1', resource_subtype: 'number', format: 'percentage' })?.settings,
    ).toEqual(expect.objectContaining({ numberFormat: 'PERCENTAGE' }));
    expect(
      fieldDefinition({ gid: '1', resource_subtype: 'number', format: 'duration' })?.settings,
    ).toEqual(expect.objectContaining({ numberFormat: 'CUSTOM_UNIT', unitLabel: 'min' }));
    expect(
      fieldDefinition({ gid: '1', resource_subtype: 'number', format: 'custom' })?.settings,
    ).toEqual(expect.objectContaining({ numberFormat: 'PLAIN' }));
  });
});

describe('Asana values', () => {
  it('maps roles, privacy, statuses and task kinds', () => {
    expect(workspaceRole({ gid: '1', is_admin: true })).toBe(WorkspaceRole.ADMIN);
    expect(workspaceRole({ gid: '1', is_guest: true })).toBe(WorkspaceRole.GUEST);
    expect(workspaceRole({ gid: '1' })).toBe(WorkspaceRole.MEMBER);
    expect(projectRole('commenter')).toBe(ProjectMemberRole.COMMENTER);
    expect(projectRole(undefined)).toBe(ProjectMemberRole.EDITOR);
    expect(projectVisibility('public_to_workspace')).toBe(ProjectVisibility.PUBLIC);
    expect(projectVisibility('private_to_team')).toBe(ProjectVisibility.PRIVATE);
    expect(statusValue('at_risk')).toBe(ProjectStatusValue.AT_RISK);
    expect(statusValue('achieved')).toBe(ProjectStatusValue.COMPLETE);
    expect(taskKind('milestone')).toBe(TaskKind.MILESTONE);
    expect(approvalStatus(TaskKind.APPROVAL, 'changes_requested')).toBe(
      ApprovalStatus.CHANGES_REQUESTED,
    );
    expect(approvalStatus(TaskKind.TASK, 'approved')).toBeNull();
  });

  it('maps colours to tokens and hex', () => {
    expect(colorToken('dark-green')).toBe('green');
    expect(colorToken('yellow-green')).toBe('lime');
    expect(colorToken(null)).toBe('gray');
    expect(projectColor('dark-blue')).toBe('#3B82F6');
    expect(projectColor('none')).toBe('#6366F1');
  });

  it('keeps dates as calendar days and a time only when one was chosen', () => {
    expect(calendarDate('2026-10-27')?.toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect(calendarDate('soon')).toBeNull();
    expect(schedule('2026-10-27', null)).toEqual({
      date: new Date('2026-10-27T00:00:00.000Z'),
      at: null,
    });
    expect(schedule('2026-10-27', '2026-10-27T15:30:00.000Z').at?.toISOString()).toBe(
      '2026-10-27T15:30:00.000Z',
    );
    expect(schedule(null, '2026-10-28T09:00:00.000Z').date?.toISOString()).toBe(
      '2026-10-28T00:00:00.000Z',
    );
  });

  it('finds free keys and names', () => {
    const keys = new Set(['LPC']);
    expect(uniqueKey('LPC', keys)).toBe('LPC2');
    expect(uniqueKey('ABCDEFGH', new Set(['ABCDEFGH']))).toBe('ABCDEFG2');

    const names = new Set(['leads']);
    expect(uniqueName('Leads', names, 80)).toBe('Leads (2)');
    expect(uniqueName('  ', names, 80)).toBe('Untitled');
  });

  it('clips long text with an ellipsis', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip(null, 4, 'x')).toBe('x');
  });
});
