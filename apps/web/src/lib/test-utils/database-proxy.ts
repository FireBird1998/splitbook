/**
 * A TCP proxy to the test replica set that a test can interrupt (#826, #862), so the app's one
 * client meets a database it can't reach: point MONGODB_URI at `port`, then
 *
 * - `cut()`: drop every open connection, the driver's monitor's included, and refuse each new
 *   one, as a database that went away;
 * - `refuse()`: refuse each new connection, keeping those open, as a database that turns
 *   connections away while the monitor's stays up (#862's blip);
 * - `silence()`: accept each new connection and never answer it, keeping those open;
 * - `restore()`: pass everything through again.
 *
 * A refused connection is accepted and dropped at once, so the driver reads a reset.
 */

import net from 'node:net';

export type DatabaseProxyMode = 'open' | 'cut' | 'refuse' | 'silent';

export function databaseProxy(target: URL, mode: DatabaseProxyMode = 'open') {
  let attempts = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    attempts += 1;
    if (mode === 'cut' || mode === 'refuse') return socket.destroy();
    if (mode === 'silent') {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      return;
    }
    const upstream = net.connect(Number(target.port), target.hostname);
    for (const end of [socket, upstream]) {
      sockets.add(end);
      end.on('close', () => sockets.delete(end));
      end.on('error', () => {});
    }
    socket.pipe(upstream).pipe(socket);
  });
  return {
    server,
    /** How many connections have been opened to it. */
    attempts: () => attempts,
    /** Starts listening on a free loopback port, and resolves to it. */
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)),
      ),
    restore: () => {
      mode = 'open';
    },
    refuse: () => {
      mode = 'refuse';
    },
    silence: () => {
      mode = 'silent';
    },
    cut: () => {
      mode = 'cut';
      for (const socket of sockets) socket.destroy();
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** How long `run` takes, in milliseconds, with what it settled to. */
export async function timed<T>(
  run: () => Promise<T>,
): Promise<{ value?: T; error?: Error; took: number }> {
  const started = Date.now();
  const settled = await run().then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  return { ...settled, took: Date.now() - started };
}
