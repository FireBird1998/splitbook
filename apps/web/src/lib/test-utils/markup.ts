/**
 * Read server-rendered markup (renderToStaticMarkup) in unit tests, which run without a DOM.
 * Only for the plain attribute values these tests look at; it is not an HTML parser.
 */

function attribute(attributes: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;
}

/** Every <img> in document order: its src, alt (null when absent) and inline style. */
export function images(html: string) {
  return [...html.matchAll(/<img\b([^>]*)>/g)].map(([, attributes]) => ({
    src: attribute(attributes, 'src'),
    alt: attribute(attributes, 'alt'),
    style: Object.fromEntries(
      (attribute(attributes, 'style') ?? '')
        .split(';')
        .filter((declaration) => declaration.includes(':'))
        .map((declaration) => {
          const colon = declaration.indexOf(':');
          return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
        }),
    ) as Record<string, string>,
  }));
}

/** The <img>s showing brand artwork from public/brand. */
export function brandImages(html: string) {
  return images(html).filter((image) => image.src?.startsWith('/brand/'));
}

/** Every link's href, in document order. */
export function links(html: string): string[] {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(
    ([, attributes]) => attribute(attributes, 'href') ?? '',
  );
}

/** Every link in document order: its href, aria-current (null when absent) and text. */
export function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: attribute(attributes, 'href') ?? '',
    current: attribute(attributes, 'aria-current'),
    text: text(inner),
  }));
}

/** The markup's text, tags removed and whitespace collapsed. */
export function text(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
