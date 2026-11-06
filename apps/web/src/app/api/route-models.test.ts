/**
 * Every API route registers each model its records can be populated with (#947, #186).
 *
 * A fresh server instance loads only the modules of the route it serves, and `populate()` finds
 * the model a path's `ref` names in Mongoose's registry, not by import. So a route whose chain
 * registers Activity, say, but never User answers its first request with MissingSchemaError.
 * Each route is loaded here in a fresh module registry with no model registered, and every `ref`
 * of every model it registered must name a model it registered too.
 */

import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

/** The part of a Mongoose schema this check reads. */
type Schema = { eachPath(fn: (path: string, type: unknown) => void): unknown };

const routes = import.meta.glob('./**/route.ts');

/** The model names a schema's paths, nested schemas and arrays refer to. */
function refsOf(schema: Schema, seen = new Set<Schema>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const refs: string[] = [];
  schema.eachPath((_path, type) => {
    const typed = type as {
      options?: { ref?: unknown };
      schema?: Schema;
      embeddedSchemaType?: { options?: { ref?: unknown } };
    };
    for (const ref of [typed.options?.ref, typed.embeddedSchemaType?.options?.ref])
      if (typeof ref === 'string') refs.push(ref);
    if (typed.schema) refs.push(...refsOf(typed.schema, seen));
  });
  return refs;
}

describe('a cold server instance', () => {
  it('finds every API route', () => {
    expect(Object.keys(routes).length).toBeGreaterThan(40);
  });

  it.each(Object.keys(routes).sort())(
    '%s registers every model its records refer to',
    async (route) => {
      for (const name of mongoose.modelNames()) mongoose.deleteModel(name);
      vi.resetModules();

      await routes[route]();

      const registered = mongoose.modelNames();
      const missing = registered.flatMap((name) =>
        refsOf(mongoose.model(name).schema)
          .filter((ref) => !registered.includes(ref))
          .map((ref) => `${name} → ${ref}`),
      );
      expect([...new Set(missing)]).toEqual([]);
    },
  );
});
