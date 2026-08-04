import { describe, expect, it } from 'vitest';

import {
  WorkspaceRole,
  canGrantRole,
  canManageMember,
  grantableRoles,
  hasAtLeastRole,
} from './enums.js';

describe('hasAtLeastRole', () => {
  it('accepts a more privileged role', () => {
    expect(hasAtLeastRole(WorkspaceRole.OWNER, WorkspaceRole.MEMBER)).toBe(true);
  });

  it('accepts the exact role', () => {
    expect(hasAtLeastRole(WorkspaceRole.MEMBER, WorkspaceRole.MEMBER)).toBe(true);
  });

  it('rejects a less privileged role', () => {
    expect(hasAtLeastRole(WorkspaceRole.GUEST, WorkspaceRole.MEMBER)).toBe(false);
  });
});

describe('canGrantRole', () => {
  /** Otherwise privilege escalation is one invitation away. */
  it('refuses to grant a role above the actor’s own', () => {
    expect(canGrantRole(WorkspaceRole.ADMIN, WorkspaceRole.OWNER)).toBe(false);
    expect(canGrantRole(WorkspaceRole.MANAGER, WorkspaceRole.ADMIN)).toBe(false);
    expect(canGrantRole(WorkspaceRole.MEMBER, WorkspaceRole.MANAGER)).toBe(false);
  });

  it('allows granting the actor’s own role', () => {
    expect(canGrantRole(WorkspaceRole.ADMIN, WorkspaceRole.ADMIN)).toBe(true);
    expect(canGrantRole(WorkspaceRole.MANAGER, WorkspaceRole.MANAGER)).toBe(true);
  });

  it('allows granting anything below the actor', () => {
    expect(canGrantRole(WorkspaceRole.ADMIN, WorkspaceRole.MEMBER)).toBe(true);
    expect(canGrantRole(WorkspaceRole.ADMIN, WorkspaceRole.GUEST)).toBe(true);
  });

  /** Ownership changes hands by transfer, never by surprise via an invite. */
  it('never grants OWNER, not even from an owner', () => {
    expect(canGrantRole(WorkspaceRole.OWNER, WorkspaceRole.OWNER)).toBe(false);
  });
});

describe('canManageMember', () => {
  it('allows acting on anyone below you', () => {
    expect(canManageMember(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)).toBe(true);
    expect(canManageMember(WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)).toBe(true);
    expect(canManageMember(WorkspaceRole.ADMIN, WorkspaceRole.GUEST)).toBe(true);
  });

  /**
   * Peers must not be able to eject one another — otherwise two admins can race
   * to remove each other and whoever clicks first keeps the workspace.
   */
  it('refuses a peer', () => {
    expect(canManageMember(WorkspaceRole.ADMIN, WorkspaceRole.ADMIN)).toBe(false);
    expect(canManageMember(WorkspaceRole.MEMBER, WorkspaceRole.MEMBER)).toBe(false);
  });

  it('refuses anyone above you', () => {
    expect(canManageMember(WorkspaceRole.ADMIN, WorkspaceRole.OWNER)).toBe(false);
    expect(canManageMember(WorkspaceRole.MEMBER, WorkspaceRole.ADMIN)).toBe(false);
  });

  /** Which also means nobody can act on themselves; leaving is its own action. */
  it('refuses acting on yourself, at every rank', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(canManageMember(role, role)).toBe(false);
    }
  });

  it('never lets anyone touch the owner', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(canManageMember(role, WorkspaceRole.OWNER)).toBe(false);
    }
  });
});

describe('grantableRoles', () => {
  it('gives an owner everything except ownership', () => {
    expect(grantableRoles(WorkspaceRole.OWNER)).toEqual([
      WorkspaceRole.ADMIN,
      WorkspaceRole.MANAGER,
      WorkspaceRole.MEMBER,
      WorkspaceRole.GUEST,
    ]);
  });

  it('stops at the actor’s own rank', () => {
    expect(grantableRoles(WorkspaceRole.MANAGER)).toEqual([
      WorkspaceRole.MANAGER,
      WorkspaceRole.MEMBER,
      WorkspaceRole.GUEST,
    ]);
  });

  it('agrees with canGrantRole for every role', () => {
    for (const actor of Object.values(WorkspaceRole)) {
      for (const target of Object.values(WorkspaceRole)) {
        expect(grantableRoles(actor).includes(target)).toBe(canGrantRole(actor, target));
      }
    }
  });
});
