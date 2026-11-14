import { widgetGroupWasDropped } from './widget-membership';
import type { WidgetCopy } from './balances-widget';

export interface WidgetPerson {
  id: string;
  firstName: string;
  initials: string;
}
export interface WidgetGroupPeople {
  name: string;
  archived: boolean;
  verifiedAt: number;
  people: WidgetPerson[];
}

/** The setup catalogue uses saved membership, never the network or payment participation. */
export function widgetPeople(copy: WidgetCopy | null, accountId: string) {
  if (!copy || copy.accountId !== accountId) return [];
  const people = new Map<
    string,
    WidgetPerson & { groups: { id: string; name: string; verifiedAt: number }[] }
  >();
  for (const [id, group] of Object.entries(copy.groupPeople ?? {})) {
    if (
      !group ||
      group.archived ||
      widgetGroupWasDropped(copy, id) ||
      copy.groups?.[id]?.archived ||
      copy.lostGroupIds?.includes(id) ||
      !Array.isArray(group.people) ||
      typeof group.name !== 'string' ||
      !Number.isFinite(group.verifiedAt)
    )
      continue;
    for (const person of group.people) {
      if (
        !person ||
        typeof person.id !== 'string' ||
        !person.id ||
        person.id === accountId ||
        typeof person.firstName !== 'string' ||
        typeof person.initials !== 'string'
      )
        continue;
      const row = people.get(person.id) ?? {
        id: person.id,
        firstName: person.firstName.trim().split(/\s+/)[0],
        initials: person.initials,
        groups: [],
      };
      row.groups.push({ id, name: group.name, verifiedAt: group.verifiedAt });
      people.set(person.id, row);
    }
  }
  const rows = [...people.values()];
  return rows.map((person) => ({
    ...person,
    name:
      rows.some((other) => other.id !== person.id && other.firstName === person.firstName) &&
      person.initials.length > 1
        ? `${person.firstName} ${person.initials.slice(1, 2)}`
        : person.firstName,
  }));
}
