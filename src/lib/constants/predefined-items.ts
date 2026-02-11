export interface PredefinedItem {
  id: string;
  label: string;
  category: string;
  defaultTag: string;
  icon: string;
}

export const PREDEFINED_ITEMS: PredefinedItem[] = [
  { id: "groceries", label: "Groceries", category: "food", defaultTag: "groceries", icon: "🛒" },
  { id: "restaurant", label: "Restaurant", category: "food", defaultTag: "dining", icon: "🍕" },
  { id: "taxi", label: "Taxi / Uber", category: "transport", defaultTag: "taxi", icon: "🚗" },
  { id: "fuel", label: "Gas / Fuel", category: "transport", defaultTag: "fuel", icon: "⛽" },
  { id: "hotel", label: "Hotel", category: "accommodation", defaultTag: "hotel", icon: "🏨" },
  { id: "airbnb", label: "Airbnb", category: "accommodation", defaultTag: "airbnb", icon: "🏠" },
  { id: "flight", label: "Flight", category: "travel", defaultTag: "flight", icon: "✈️" },
  { id: "train", label: "Train Ticket", category: "travel", defaultTag: "train", icon: "🚆" },
  { id: "movie", label: "Movie Tickets", category: "entertainment", defaultTag: "movie", icon: "🎬" },
  { id: "rent", label: "Rent", category: "housing", defaultTag: "rent", icon: "🏠" },
  { id: "utilities", label: "Utilities", category: "housing", defaultTag: "utilities", icon: "💡" },
  { id: "internet", label: "Internet", category: "housing", defaultTag: "internet", icon: "📡" },
  { id: "coffee", label: "Coffee", category: "food", defaultTag: "coffee", icon: "☕" },
  { id: "drinks", label: "Drinks / Bar", category: "food", defaultTag: "drinks", icon: "🍺" },
  { id: "shopping", label: "Shopping", category: "shopping", defaultTag: "shopping", icon: "🛍️" },
  { id: "medical", label: "Medical", category: "health", defaultTag: "medical", icon: "🏥" },
  { id: "parking", label: "Parking", category: "transport", defaultTag: "parking", icon: "🅿️" },
  { id: "bus", label: "Bus", category: "transport", defaultTag: "bus", icon: "🚌" },
];

export function getPredefinedItem(id: string): PredefinedItem | undefined {
  return PREDEFINED_ITEMS.find((item) => item.id === id);
}

