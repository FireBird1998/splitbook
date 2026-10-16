/** Runs `run` with the process in another time zone, as a member there would see it. */
export async function inTimeZone<T>(zone: string, run: () => T | Promise<T>): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}
