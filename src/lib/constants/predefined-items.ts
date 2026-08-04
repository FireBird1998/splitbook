export interface PredefinedItem {
  id: string;
  label: string;
  category: string;
  defaultTag: string;
  icon: string;
}

/** defaultTag values align with DEFAULT_GROUP_TAGS for the common trip path. */
export const PREDEFINED_ITEMS: PredefinedItem[] = [
  {
    id: 'groceries',
    label: 'Groceries',
    category: 'food',
    defaultTag: 'Food',
    icon: '🛒',
  },
  {
    id: 'restaurant',
    label: 'Restaurant',
    category: 'food',
    defaultTag: 'Food',
    icon: '🍕',
  },
  {
    id: 'taxi',
    label: 'Taxi / Uber',
    category: 'transport',
    defaultTag: 'Transport',
    icon: '🚗',
  },
  {
    id: 'fuel',
    label: 'Gas / Fuel',
    category: 'transport',
    defaultTag: 'Transport',
    icon: '⛽',
  },
  {
    id: 'hotel',
    label: 'Hotel',
    category: 'accommodation',
    defaultTag: 'Stay',
    icon: '🏨',
  },
  {
    id: 'airbnb',
    label: 'Airbnb',
    category: 'accommodation',
    defaultTag: 'Stay',
    icon: '🏠',
  },
  {
    id: 'flight',
    label: 'Flight',
    category: 'travel',
    defaultTag: 'Transport',
    icon: '✈️',
  },
  {
    id: 'train',
    label: 'Train Ticket',
    category: 'travel',
    defaultTag: 'Transport',
    icon: '🚆',
  },
  {
    id: 'movie',
    label: 'Movie Tickets',
    category: 'entertainment',
    defaultTag: 'Activities',
    icon: '🎬',
  },
  {
    id: 'rent',
    label: 'Rent',
    category: 'housing',
    defaultTag: 'General',
    icon: '🏠',
  },
  {
    id: 'utilities',
    label: 'Utilities',
    category: 'housing',
    defaultTag: 'General',
    icon: '💡',
  },
  {
    id: 'internet',
    label: 'Internet',
    category: 'housing',
    defaultTag: 'General',
    icon: '📡',
  },
  {
    id: 'coffee',
    label: 'Coffee',
    category: 'food',
    defaultTag: 'Food',
    icon: '☕',
  },
  {
    id: 'drinks',
    label: 'Drinks / Bar',
    category: 'food',
    defaultTag: 'Food',
    icon: '🍺',
  },
  {
    id: 'shopping',
    label: 'Shopping',
    category: 'shopping',
    defaultTag: 'Activities',
    icon: '🛍️',
  },
  {
    id: 'medical',
    label: 'Medical',
    category: 'health',
    defaultTag: 'General',
    icon: '🏥',
  },
  {
    id: 'parking',
    label: 'Parking',
    category: 'transport',
    defaultTag: 'Transport',
    icon: '🅿️',
  },
  {
    id: 'bus',
    label: 'Bus',
    category: 'transport',
    defaultTag: 'Transport',
    icon: '🚌',
  },
];

export function getPredefinedItem(id: string): PredefinedItem | undefined {
  return PREDEFINED_ITEMS.find((item) => item.id === id);
}
