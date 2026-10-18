/**
 * Read server-rendered markup (renderToStaticMarkup) in unit tests, which run without a DOM.
 * Only for the plain attribute values and the list children these tests look at; it is not a
 * full HTML parser.
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

/** Every inline <svg role="img"> in document order: its accessible name (aria-label). */
export function svgImages(html: string): string[] {
  return [...html.matchAll(/<svg\b([^>]*)>/g)]
    .filter(([, attributes]) => attribute(attributes, 'role') === 'img')
    .map(([, attributes]) =>
      (attribute(attributes, 'aria-label') ?? '').replace(/&#x27;|&#39;/g, "'"),
    );
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

/** The markup without the `<style>` elements MUI writes into static markup. */
function withoutStyles(html: string): string {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ');
}

/**
 * The direct children of the `<ul>` with this aria-label, in order: each one's tag, its
 * explicit role (null when absent) and its markup. React closes void elements itself (`<img/>`).
 */
export function listItems(html: string, label: string) {
  const markup = withoutStyles(html);
  // As React writes the label in an attribute, then as a pattern.
  const written = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const pattern = written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const list = new RegExp(`<ul\\b[^>]*\\saria-label="${pattern}"[^>]*>`).exec(markup);
  if (!list) throw new Error(`No list labelled ${label}`);
  const items: Array<{ tag: string; role: string | null; html: string }> = [];
  const tags = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  tags.lastIndex = list.index + list[0].length;
  let depth = 0;
  let start = 0;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    const [opening, closing, name, attributes, selfClosing] = match;
    if (closing) {
      if (depth === 0) return items;
      depth -= 1;
      if (depth === 0) items[items.length - 1].html = markup.slice(start, tags.lastIndex);
    } else {
      if (depth === 0) {
        start = match.index;
        items.push({ tag: name, role: attribute(attributes, 'role'), html: opening });
      }
      if (!selfClosing) depth += 1;
    }
  }
  throw new Error(`The list labelled ${label} never closes`);
}

/** The few entities React writes in text and attributes, decoded. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** The markup's text, tags removed and whitespace collapsed. */
export function text(html: string): string {
  return decodeEntities(withoutStyles(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
