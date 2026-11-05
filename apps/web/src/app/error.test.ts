import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageError from './error';

/*
 * #826: a server page that couldn't reach the database says so in the owner's words, with Try
 * again, where a 30 s hang once ended in Next.js's "This page couldn't load". Next.js hands the
 * browser only a server error's digest, never its message.
 */

/** What the browser's error boundary gets from a server page's error: the digest alone. */
function serverError(digest: string) {
  return Object.assign(new Error('An error occurred in the Server Components render.'), {
    digest,
  });
}

describe('a server page’s error', () => {
  it('when the database couldn’t be reached, says so with Try again', () => {
    const html = renderToStaticMarkup(
      createElement(PageError, { error: serverError('DATABASE_UNAVAILABLE') }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<h1[^>]*>Couldn’t reach Splitbook\. Try again\.<\/h1>/);
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it('any other error goes on to Next.js’s own page, as before', () => {
    const other = serverError('2187034857');
    expect(() => renderToStaticMarkup(createElement(PageError, { error: other }))).toThrow(other);
  });
});
