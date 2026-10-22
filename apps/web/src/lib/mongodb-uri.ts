// Whether a MongoDB client connects directly to its server, and which database a URI names,
// decided once for the app's client and the scripts (#850). No `server-only` here: the scripts
// run under plain Node.

import ConnectionString from 'mongodb-connection-string-url';

/**
 * The `directConnection` option for `uri`. A `mongodb://` URI naming a single host connects to
 * it directly, as a local Docker Mongo and CI's one-node replica sets need: they announce another
 * address than the one the URI names. A URI naming several hosts connects as their replica set,
 * a `mongodb+srv://` one never connects directly (the driver refuses it there), and a URI that
 * sets `directConnection` itself is taken at its word. The hosts come from the driver's own
 * parser, IPv6 ones included.
 */
export function directConnectionFor(uri: string): { directConnection?: true } {
  const parsed = new ConnectionString(uri);
  // The driver reads URI options case-insensitively.
  const saysItself = [...parsed.searchParams.keys()].some(
    (key) => key.toLowerCase() === 'directconnection',
  );
  return !parsed.isSRV && parsed.hosts.length === 1 && !saysItself
    ? { directConnection: true }
    : {};
}

/**
 * The database `uri`'s path names, or null when it names none or isn't a MongoDB URI. The
 * driver's parser reads a URI naming several hosts, which WHATWG `new URL()` refuses.
 */
export function databaseNameFor(uri: string): string | null {
  try {
    return decodeURIComponent(new ConnectionString(uri).pathname.slice(1)) || null;
  } catch {
    return null;
  }
}
