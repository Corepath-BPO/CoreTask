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
});
