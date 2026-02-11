export interface ExpenseCategory {
  id: string;
  label: string;
  icon: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "food", label: "Food & Drink", icon: "🍕" },
  { id: "transport", label: "Transport", icon: "🚗" },
  { id: "accommodation", label: "Accommodation", icon: "🏨" },
  { id: "travel", label: "Travel", icon: "✈️" },
  { id: "entertainment", label: "Entertainment", icon: "🎬" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "housing", label: "Housing", icon: "🏠" },
  { id: "health", label: "Health", icon: "🏥" },
  { id: "education", label: "Education", icon: "📚" },
  { id: "other", label: "Other", icon: "📋" },
];

export const CATEGORY_IDS = EXPENSE_CATEGORIES.map((c) => c.id);

export function getCategory(id: string): ExpenseCategory | undefined {
  return EXPENSE_CATEGORIES.find((c) => c.id === id);
}

