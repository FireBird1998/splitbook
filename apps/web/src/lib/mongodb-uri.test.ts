import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { directConnectionFor } from './mongodb-uri';

/*
 * #850: whether a client connects directly to its server, decided once for the app's client and
 * the migration scripts. Only a URI naming a single `mongodb://` host does, as a local Docker
 * Mongo and CI's one-node replica sets need (they announce another address). Fictional hosts.
 */

describe('directConnectionFor (#850)', () => {
  it.each([
    'mongodb://127.0.0.1:27017/splitbook',
    'mongodb://localhost/splitbook-demo',
    'mongodb://splitbook_app:secret@db.example.net:27017/splitbook?authSource=admin',
    'mongodb://[::1]:27017/splitbook',
    'mongodb://127.0.0.1:27017/splitbook-unconfigured',
  ])('connects directly to the one host of %s', (uri) => {
    expect(directConnectionFor(uri)).toEqual({ directConnection: true });
  });

  it.each([
    ['several hosts', 'mongodb://db-00.example.net,db-01.example.net/splitbook?replicaSet=rs0'],
    ['several IPv6 hosts', 'mongodb://[::1]:27017,[::1]:27018/splitbook?replicaSet=rs0'],
    ['an srv URI', 'mongodb+srv://cluster0.example.mongodb.net/splitbook'],
    ['a URI that says false', 'mongodb://127.0.0.1:27017/splitbook?directConnection=false'],
    ['a URI that says true', 'mongodb://127.0.0.1:27017/splitbook?directConnection=true'],
    ['one that says it in any case', 'mongodb://127.0.0.1:27017/splitbook?DirectConnection=false'],
  ])('adds nothing for %s', (_, uri) => {
    expect(directConnectionFor(uri)).toEqual({});
  });
});

describe('every client decides it the same way', () => {
  const web = path.resolve(__dirname, '../..');
  const sources = ['src', 'scripts'].flatMap((folder) =>
    readdirSync(path.join(web, folder), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(?:ts|tsx|mts|mjs)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => path.join(folder, file)),
  );

  it.each(['migrate-auth.ts', 'migrate-expense-dates.ts', 'migrate-ledger.ts'])(
    'scripts/%s connects through the shared rule',
    (script) => {
      const source = readFileSync(path.join(web, 'scripts', script), 'utf8');
      expect(source).toMatch(
        /import \{ directConnectionFor \} from '\.\.\/src\/lib\/mongodb-uri';/,
      );
      expect(source).toMatch(/\.\.\.directConnectionFor\(uri\)/);
    },
  );

  it('no other source sets directConnection itself', () => {
    const own = sources.filter(
      (file) =>
        file !== path.join('src', 'lib', 'mongodb-uri.ts') &&
        /directConnection:\s*true/.test(readFileSync(path.join(web, file), 'utf8')),
    );
    expect(own).toEqual([]);
  });
});
