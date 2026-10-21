import { describe, expect, it } from 'vitest';
import { assistantDisplay } from './assistant-name';

/* How the approval page names an assistant (#614): by the name its metadata document publishes,
 * else by its address's host, with the address (host and path) in small text beside it. A
 * registered client has no metadata document, so it has no address to show. */
describe('an assistant as the approval page names it', () => {
  it('uses the published name, with the address beside it', () => {
    expect(assistantDisplay('https://chatgpt.com/oauth/client.json', 'ChatGPT')).toEqual({
      name: 'ChatGPT',
      address: 'chatgpt.com/oauth/client.json',
    });
  });

  it('shows the address with its path, so publishers on one host can be told apart', () => {
    expect(
      assistantDisplay('https://raw.githubusercontent.com/fictional/x/main/client.json', 'Helper')
        .address,
    ).toBe('raw.githubusercontent.com/fictional/x/main/client.json');
  });

  it('falls back to the address host when no name is published', () => {
    for (const name of ['', null])
      expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', name)).toEqual({
        name: 'claude.ai',
        address: 'claude.ai/oauth/mcp-client.json',
      });
  });

  it('treats a name with no letter or number as no name', () => {
    for (const name of ['ㅤㅤ', '⠀', 'ᅟᅠﾠ', ' ★ · ★ '])
      expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', name).name).toBe(
        'claude.ai',
      );
  });

  it('cleans a published name as Draft attribution does', () => {
    expect(
      assistantDisplay('https://assistant.example.test/client.json', '  Fictional\u0007   Helper ')
        .name,
    ).toBe('Fictional Helper');
  });

  it('never lets a published name pose as another address', () => {
    for (const name of [
      'claude.ai',
      'Claude by claude.ai',
      'https://chatgpt.com',
      'ChatGPT (chatgpt.com)',
      'chatgpt.соm',
    ])
      expect(assistantDisplay('https://fictional.example.test/client.json', name).name, name).toBe(
        'fictional.example.test',
      );
    expect(assistantDisplay('https://chatgpt.com/oauth/client.json', 'chatgpt.com').name).toBe(
      'chatgpt.com',
    );
    expect(assistantDisplay('a1b2c3d4e5', 'claude.ai').name).toBe('Assistant');
  });

  it('reads every dot look-alike as a dot when a name poses as another address', () => {
    const dots = [
      ...['\u2024', '\uff0e', '\ufe52', '\u3002', '\uff61', '\u0701', '\u0702', '\u2e33'],
      ...['[.]', '(.)', '[ . ]'],
    ];
    for (const dot of dots)
      for (const name of [`claude${dot}ai`, `Claude by claude${dot}ai`])
        expect(
          assistantDisplay('https://evil.example.test/client.json', name).name,
          JSON.stringify(name),
        ).toBe('evil.example.test');
  });

  it('keeps an honest name that names its own address or one it sits under', () => {
    expect(
      assistantDisplay('https://chat.claude.ai/oauth/client.json', 'Claude by claude.ai').name,
    ).toBe('Claude by claude.ai');
    expect(assistantDisplay('https://claude.ai/oauth/client.json', 'Claude.ai').name).toBe(
      'Claude.ai',
    );
  });

  it('gives way when a name carries a scheme, even with no domain in it', () => {
    expect(assistantDisplay('https://helper.example.test/client.json', 'app://helper').name).toBe(
      'helper.example.test',
    );
  });

  it('never shows a query in the address', () => {
    expect(
      assistantDisplay('https://helper.example.test/client.json?ref=claude.ai', 'Helper').address,
    ).toBe('helper.example.test/client.json');
  });

  it('marks a name cut at 40 characters with an ellipsis', () => {
    expect(
      assistantDisplay('https://helper.example.test/client.json', `Helper ${'x'.repeat(50)}`).name,
    ).toBe(`Helper ${'x'.repeat(32)}…`);
  });

  it('gives an address only to an https metadata document', () => {
    expect(assistantDisplay('http://assistant.example.test/client.json', 'Helper')).toEqual({
      name: 'Helper',
      address: null,
    });
  });

  it('names a registered client by its name, never by its client id', () => {
    expect(assistantDisplay('a1b2c3d4e5', 'Synthetic MCP Client')).toEqual({
      name: 'Synthetic MCP Client',
      address: null,
    });
    expect(assistantDisplay('a1b2c3d4e5', '')).toEqual({ name: 'Assistant', address: null });
  });
});
