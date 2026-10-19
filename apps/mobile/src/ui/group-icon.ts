import type { GroupCategory } from '@splitbook/shared/types';
import type { IconName } from './primitives';

/** Each Group Theme's line icon, as Home's Group rows show it. */
export const groupThemeIcons: Record<GroupCategory, IconName> = {
  home: 'home-outline',
  trip: 'airplane-outline',
  work: 'briefcase-outline',
  couple: 'heart-outline',
  other: 'people-outline',
};

/** A Group's icon, or the general one while its Theme isn't known. */
export const groupIcon = (category?: GroupCategory): IconName =>
  category ? groupThemeIcons[category] : groupThemeIcons.other;
