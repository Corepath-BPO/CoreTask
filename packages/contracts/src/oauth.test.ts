import { describe, expect, it } from 'vitest';

import { redirectUriProblem } from './oauth.js';

describe('redirect URIs an OAuth app may register', () => {
  it('takes https anywhere, and http only on the loopback address', () => {
    expect(redirectUriProblem('https://tool.example/oauth/callback?x=1')).toBeNull();
    expect(redirectUriProblem('http://localhost:5678/callback')).toBeNull();
    expect(redirectUriProblem('http://127.0.0.1/cb')).toBeNull();
    expect(redirectUriProblem('http://[::1]:8080/cb')).toBeNull();
    expect(redirectUriProblem('http://tool.example/cb')).toMatch(/https/);
    expect(redirectUriProblem('myapp://callback')).toMatch(/https/);
  });

  it('refuses fragments, credentials and what is not a URL', () => {
    expect(redirectUriProblem('https://tool.example/cb#done')).toMatch(/fragment/);
    expect(redirectUriProblem('https://user:pass@tool.example/cb')).toMatch(/password/);
    expect(redirectUriProblem('tool.example/cb')).toMatch(/full URL/);
    expect(redirectUriProblem('https://')).toMatch(/full URL/);
  });

  it('takes an app scheme from a public client only, and only a reverse-domain one', () => {
    const uri = 'com.example.leasing:/oauth/callback';
    expect(redirectUriProblem(uri, { publicClient: true })).toBeNull();
    expect(redirectUriProblem('com.example.leasing://callback', { publicClient: true })).toBeNull();
    expect(redirectUriProblem(uri)).toMatch(/mobile and desktop/);
    // A bare scheme is anybody's to claim on a phone; a dotted one is the app's.
    expect(redirectUriProblem('myapp://callback', { publicClient: true })).toMatch(/https/);
    expect(redirectUriProblem(`${uri}#x`, { publicClient: true })).toMatch(/fragment/);
    // A public client still uses https or loopback the same way.
    expect(redirectUriProblem('http://127.0.0.1:7777/cb', { publicClient: true })).toBeNull();
  });
});
