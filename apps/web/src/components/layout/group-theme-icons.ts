import type SvgIcon from '@mui/material/SvgIcon';
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import LuggageOutlinedIcon from '@mui/icons-material/LuggageOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import type { GroupCategory } from '@splitbook/shared/types';

/**
 * The line icon each Theme shows in the web shell's Group list (design canvas "Web portal").
 * The shared Theme registry keeps its emoji for the other surfaces; this is web-only.
 */
export const GROUP_THEME_ICONS: Record<GroupCategory, typeof SvgIcon> = {
  home: HomeOutlinedIcon,
  trip: LuggageOutlinedIcon,
  work: WorkOutlineOutlinedIcon,
  couple: FavoriteBorderOutlinedIcon,
  other: PeopleOutlinedIcon,
};

/** The icon for a stored category; an unknown one (old documents) gets General's. */
export function groupThemeIcon(category: GroupCategory): typeof SvgIcon {
  return GROUP_THEME_ICONS[category] ?? GROUP_THEME_ICONS.other;
}
