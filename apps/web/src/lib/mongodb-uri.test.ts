import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseNameFor, directConnectionFor } from './mongodb-uri';

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

describe('databaseNameFor (#850)', () => {
  it.each([
    ['a single host', 'mongodb://127.0.0.1:27017/splitbook?directConnection=true'],
    [
      'several hosts',
      'mongodb://u:p@db-00.example.net:27017,db-01.example.net:27017,db-02.example.net:27017/splitbook?replicaSet=atlas-x1&tls=true',
    ],
    ['an IPv6 host', 'mongodb://[::1]:27017/splitbook'],
    ['an srv URI', 'mongodb+srv://u:p@cluster0.example.mongodb.net/splitbook?retryWrites=true'],
  ])('reads the database a URI with %s names', (_, uri) => {
    expect(databaseNameFor(uri)).toBe('splitbook');
  });

  it.each([
    ['no path', 'mongodb://127.0.0.1:27017'],
    ['an empty path', 'mongodb://db-00.example.net,db-01.example.net/?replicaSet=rs0'],
    ['no MongoDB URI at all', 'not a uri'],
  ])('reads none from a URI with %s', (_, uri) => {
    expect(databaseNameFor(uri)).toBeNull();
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
        /import \{[^}]*\bdirectConnectionFor\b[^}]*\} from '\.\.\/src\/lib\/mongodb-uri';/,
      );
      expect(source).toMatch(/\.\.\.directConnectionFor\(uri\)/);
    },
  );

  it.each(['migrate-expense-dates.ts', 'migrate-ledger.ts', 'orphan-groups.ts'])(
    'scripts/%s reads its database through the shared parser',
    (script) => {
      const source = readFileSync(path.join(web, 'scripts', script), 'utf8');
      expect(source).toMatch(/databaseNameFor\(uri\)/);
      expect(source).not.toMatch(/new URL\(uri\)/);
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
