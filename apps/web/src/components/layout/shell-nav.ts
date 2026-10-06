/**
 * Where the shell's links lead, and which one is current for a path. The sidebar and the
 * phone drawer share these, so both always mark the same item.
 */

/** Home is the existing `/dashboard` route; only its label changed (#303). */
export const HOME_HREF = '/dashboard';
export const GROUPS_HREF = '/groups';
export const NEW_GROUP_HREF = '/groups/new';
export const SETTINGS_HREF = '/settings';

/**
 * The main navigation, in order. #317 adds Export after Home. The design's Receipts item is
 * left out until receipt reading exists (#300, Out of Scope).
 */
export const MAIN_NAV = [{ href: HOME_HREF, label: 'Home' }] as const;

const GROUP_PATH = /^\/groups\/([a-f\d]{24})(\/.*)?$/i;

/** `aria-current` for a top-level link: its own page or any page below it. */
export function navCurrent(pathname: string, href: string): 'page' | undefined {
  return pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined;
}

/** `aria-current` for the Groups list link: the list page itself, not the Groups under it. */
export function groupsListCurrent(pathname: string): 'page' | undefined {
  return pathname === GROUPS_HREF ? 'page' : undefined;
}

/**
 * `aria-current` for a Group in the sidebar: "page" on the Group's own page, and "true" on a
 * page inside it (its settings), where the Group is still the current one but not the page.
 */
export function groupCurrent(pathname: string, groupId: string): 'page' | 'true' | undefined {
  const match = GROUP_PATH.exec(pathname);
  if (!match || match[1].toLowerCase() !== groupId.toLowerCase()) return undefined;
  return match[2] ? 'true' : 'page';
}
