/** Versioned, framework-free backup contract. See docs/export-backup.md. */
import { z } from 'zod';
import type { ExportExpense, ExportPayment, ExportPerson } from './export-csv';
import type { ExportInclude } from './export-request';

const ADDRESS = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Contact fields are omitted; addresses typed into text are redacted as well. */
function contactFree(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.replace(ADDRESS, '[redacted]');
  if (Array.isArray(value)) return value.map(contactFree);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/email|image|avatar|token|secret/i.test(key))
        .map(([key, item]) => [
          key,
          key === 'user' && item && typeof item === 'object' && '_id' in item
            ? String(item._id)
            : contactFree(item),
        ]),
    );
  return value;
}
const minor = z.number().int().refine(Number.isSafeInteger);
const instant = z.iso.datetime();
const allocation = z.strictObject({
  userId: z.string(),
  amountMinor: minor,
  percentage: z.number().optional(),
  shares: z.number().optional(),
});
const edit = z.strictObject({
  at: instant,
  byId: z.string(),
  // Changes are JSON values, sanitized by the builder; the surrounding contract is strict.
  changes: z.record(
    z.string(),
    z.strictObject({ old: z.json().optional(), new: z.json().optional() }),
  ),
});
export const backupSchema = z.strictObject({
  format: z.literal('splitbook-backup/1'),
  exportedAt: instant,
  groups: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      theme: z.enum(['trip', 'home', 'couple', 'work', 'other']),
      currency: z.string(),
      startDate: instant.nullable(),
      endDate: instant.nullable(),
      members: z.array(z.strictObject({ id: z.string(), name: z.string(), former: z.boolean() })),
      tags: z.array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          retired: z.boolean(),
          deleted: z.boolean(),
          createdAt: instant,
        }),
      ),
      expenses: z.array(
        z.strictObject({
          id: z.string(),
          date: instant,
          description: z.string(),
          category: z.string(),
          tag: z.string(),
          tagId: z.string().nullable(),
          currency: z.string(),
          amountMinor: minor,
          splitMethod: z.enum(['equal', 'unequal', 'exact', 'percentage', 'shares']),
          notes: z.string(),
          paidBy: z.array(allocation),
          splitBetween: z.array(allocation),
          createdBy: z.string().nullable(),
          createdAt: instant.nullable(),
          updatedAt: instant.nullable(),
          deleted: z
            .strictObject({ at: instant.nullable(), byId: z.string().nullable() })
            .nullable(),
          edits: z.array(edit).optional(),
        }),
      ),
      settlements: z.array(
        z.strictObject({
          id: z.string(),
          from: z.string(),
          to: z.string(),
          amountMinor: minor,
          currency: z.string(),
          date: instant,
          note: z.string(),
          createdBy: z.string(),
        }),
      ),
    }),
  ),
});
export type Backup = z.infer<typeof backupSchema>;
export type BackupExpenseInput = ExportExpense & {
  tagId?: string | null;
  createdBy?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  paidBy: Array<ExportExpense['paidBy'][number] & { percentage?: number; shares?: number }>;
  splitBetween: Array<
    ExportExpense['splitBetween'][number] & { percentage?: number; shares?: number }
  >;
};
export interface BackupGroupInput {
  id: string;
  name: string;
  theme: Backup['groups'][number]['theme'];
  currency: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  members: readonly ExportPerson[];
  names: Readonly<Record<string, string>>;
  tags: Backup['groups'][number]['tags'];
  expenses: readonly BackupExpenseInput[];
  settlements: readonly ExportPayment[];
}
const iso = (at: Date | string) => new Date(at).toISOString();
const optionalDate = (at?: Date | string | null) => (at ? iso(at) : null);
/** Former participants can appear only in a historical payer/share value. */
function historyPeople(edits: ExportExpense['edits']): string[] {
  return (edits ?? []).flatMap((edit) =>
    ['paidBy', 'splitBetween'].flatMap((field) =>
      [edit.changes[field]?.old, edit.changes[field]?.new].flatMap((value) =>
        Array.isArray(value)
          ? value.flatMap((row) => {
              const user = row?.user;
              const id = user && typeof user === 'object' ? user._id : user;
              return typeof id === 'string' ? [id] : [];
            })
          : [],
      ),
    ),
  );
}
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** Explicit projection prevents populated account/contact fields entering any backup. */
export function buildBackup(
  groups: readonly BackupGroupInput[],
  options: {
    exportedAt: Date | string;
    include: readonly ExportInclude[];
  },
): Backup {
  return backupSchema.parse(
    contactFree({
      format: 'splitbook-backup/1',
      exportedAt: iso(options.exportedAt),
      groups: [...groups].sort(byId).map((group) => {
        const expenses = group.expenses.filter(
          (row) => options.include.includes('deleted') || !row.deleted,
        );
        const settlements = options.include.includes('payments') ? [...group.settlements] : [];
        const current = new Set(group.members.map((member) => member.id));
        const ids = new Set([
          ...current,
          ...expenses.flatMap((row) => [
            ...row.paidBy.map((person) => person.userId),
            ...row.splitBetween.map((person) => person.userId),
            ...(row.createdBy ? [row.createdBy] : []),
            ...(row.deleted?.byId ? [row.deleted.byId] : []),
            ...(options.include.includes('history')
              ? [...(row.edits ?? []).map((edit) => edit.byId), ...historyPeople(row.edits)]
              : []),
          ]),
          ...settlements.flatMap((row) => [row.fromId, row.toId, row.recordedById]),
        ]);
        const projectAllocation = (row: BackupExpenseInput['paidBy'][number]) => ({
          userId: row.userId,
          amountMinor: row.amountMinor,
          ...(row.percentage !== undefined ? { percentage: row.percentage } : {}),
          ...(row.shares !== undefined ? { shares: row.shares } : {}),
        });
        return {
          id: group.id,
          name: group.name,
          theme: group.theme,
          currency: group.currency,
          startDate: optionalDate(group.startDate),
          endDate: optionalDate(group.endDate),
          members: [...ids].sort().map((id) => ({
            id,
            name:
              group.names[id] ||
              group.members.find((member) => member.id === id)?.name ||
              'Former member',
            former: !current.has(id),
          })),
          tags: [...group.tags].sort(byId).map((tag) => ({
            id: tag.id,
            name: tag.name,
            retired: tag.retired,
            deleted: tag.deleted,
            createdAt: tag.createdAt,
          })),
          expenses: [...expenses].sort(byId).map((row) => ({
            id: row.id,
            date: iso(row.date),
            description: row.description,
            category: row.category,
            tag: row.tag,
            tagId: row.tagId ?? null,
            currency: row.currency,
            amountMinor: row.amountMinor,
            splitMethod: row.splitMethod,
            notes: row.notes ?? '',
            paidBy: row.paidBy.map(projectAllocation),
            splitBetween: row.splitBetween.map(projectAllocation),
            createdBy: row.createdBy ?? null,
            createdAt: optionalDate(row.createdAt),
            updatedAt: optionalDate(row.updatedAt),
            deleted: row.deleted
              ? { at: optionalDate(row.deleted.at), byId: row.deleted.byId }
              : null,
            ...(options.include.includes('history')
              ? {
                  edits: (row.edits ?? [])
                    .map((edit) => ({
                      at: iso(edit.at),
                      byId: edit.byId,
                      changes: edit.changes,
                    }))
                    .sort((a, b) => a.at.localeCompare(b.at) || a.byId.localeCompare(b.byId)),
                }
              : {}),
          })),
          settlements: settlements.sort(byId).map((row) => ({
            id: row.id,
            from: row.fromId,
            to: row.toId,
            amountMinor: row.amountMinor,
            currency: row.currency,
            date: iso(row.at),
            note: row.note ?? '',
            createdBy: row.recordedById,
          })),
        };
      }),
    }),
  );
}
