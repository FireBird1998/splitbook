import { describe, expect, it } from 'vitest';
import { upRequest } from './cli.ts';

describe('what up is asked for', () => {
  const env = {
    SPLITBOOK_NATIVE_ORIGIN_PORT: '4500',
    SPLITBOOK_NATIVE_DATABASE: 'splitbook_mobile_swarm_from_env',
    SPLITBOOK_NATIVE_SERVER: 'production',
  };

  it('takes each flag over its variable', () => {
    expect(
      upRequest(
        {
          origin: 'http://127.0.0.1:4600',
          database: 'splitbook_mobile_swarm_from_flag',
          server: 'dev',
        },
        env,
      ),
    ).toEqual({
      origin: 'http://127.0.0.1:4600',
      database: 'splitbook_mobile_swarm_from_flag',
      server: 'dev',
    });
  });

  it('falls back to the variables, as requests', () => {
    expect(upRequest({}, env)).toEqual({
      origin: 'http://127.0.0.1:4500',
      database: 'splitbook_mobile_swarm_from_env',
      server: 'production',
    });
  });

  it('asks for nothing in particular without either', () => {
    expect(upRequest({}, {})).toEqual({
      origin: undefined,
      database: undefined,
      server: undefined,
    });
  });
});
