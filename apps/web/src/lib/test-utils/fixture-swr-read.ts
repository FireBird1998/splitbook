/** Give decoded page/record fixtures and recurring schedule maps their shared cache shape. */
export function fixtureSWRRead(data: unknown) {
  if (data === undefined) return undefined;
  return {
    status: 200,
    data: data instanceof Map ? [...data].map(([_id, value]) => ({ _id, ...value })) : data,
  };
}
