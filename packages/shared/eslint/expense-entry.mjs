export const entryExceptions = [];
export const entryTranslationPlugin = {
  rules: {
    'no-local-reading': {
      meta: { type: 'problem', schema: [], messages: {
        useReading: 'Read typed Expense figures through readExpenseEntry or the Draft conversion pair.',
      } },
      create() { return {}; },
    },
  },
};
