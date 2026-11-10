import { Types } from 'mongoose';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';

/** One name per value for the whole case, including its before/after and HTTP answers. */
export function recordingNames() {
  const names = new Map<string, string>([
    [DEMO_PERSONA_IDS.alex, '<member-a>'],
    [DEMO_PERSONA_IDS.sam, '<member-b>'],
    [DEMO_PERSONA_IDS.priya, '<member-c>'],
  ]);
  const counts = new Map<string, number>();
  const name = (value: unknown, subject: string) => {
    const key = String(value);
    if (!names.has(key)) {
      const count = (counts.get(subject) ?? 0) + 1;
      counts.set(subject, count);
      names.set(key, `<${subject}-${count}>`);
    }
    return names.get(key)!;
  };
  const normalise = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Types.ObjectId) return name(value, 'id');
    if (typeof value === 'string')
      return value
        .replace(/[a-f\d]{64}/gi, (digest) => name(digest, 'digest'))
        .replace(/[a-f\d]{24}/gi, (id) => name(id, 'id'));
    if (Array.isArray(value)) return value.map(normalise);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalise(item)]));
    return value;
  };
  return { name, normalise };
}
