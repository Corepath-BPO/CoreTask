import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted with the mock: `vi.mock` runs before this file's own declarations.
const { fakeSocket, io } = vi.hoisted(() => {
  const fakeSocket = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return { fakeSocket, io: vi.fn(() => fakeSocket) };
});

vi.mock('socket.io-client', () => ({ io }));

import { connectSocket, disconnectSocket, disconnectSocketSoon, getSocket } from './socket-client';

const token = () => 'token';

describe('socket client teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    disconnectSocket();
    vi.useRealTimers();
  });

  it('survives a StrictMode remount: one handshake, never closed mid-way', () => {
    connectSocket(token);
    // The rehearsal unmount, then the remount, both before the next tick.
    disconnectSocketSoon();
    connectSocket(token);
    vi.runAllTimers();

    expect(io).toHaveBeenCalledTimes(1);
    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
    expect(getSocket()).toBe(fakeSocket);
  });

  it('still disconnects on a real unmount, one tick later', () => {
    connectSocket(token);
    disconnectSocketSoon();

    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(getSocket()).toBeNull();
  });

  it('disconnects at once on logout, cancelling a queued teardown', () => {
    connectSocket(token);
    disconnectSocketSoon();
    disconnectSocket();
    vi.runAllTimers();

    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(getSocket()).toBeNull();
  });
});
