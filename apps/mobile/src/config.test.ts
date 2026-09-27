import { describe, expect, it } from 'vitest';
import { developmentConfig } from './config';

const local = {
  mode: 'development',
  apiUrl: 'http://127.0.0.1:4138',
  authOrigin: 'http://127.0.0.1:4138',
};
describe('development build configuration', () => {
  it('requires both a development binary and explicit development mode', () => {
    expect(developmentConfig(local, true)?.developmentPersonaEnabled).toBe(true);
    expect(developmentConfig(local, false)).toBeNull();
    expect(developmentConfig({ ...local, mode: 'staging' }, true)).toBeNull();
    expect(developmentConfig({}, true)).toBeNull();
  });
  it.each([
    'not a URL',
    'file:///tmp/data',
    'https://example.com/api',
    'https://user:password@example.com',
    'https://example.com/?token=private',
  ])('fails closed for invalid origin %s', (apiUrl) => {
    expect(developmentConfig({ ...local, apiUrl }, true)).toBeNull();
  });
});
