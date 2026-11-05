/** Legacy recovery uses its original words when the To review rollout is off. */
export function expenseRecoveryWords(text: string) {
  return process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true'
    ? text
        .replace(/\b[Dd]raft(s?)\b/g, 'item$1')
        .replace(/\brevision\b/gi, 'version')
        .replace(/\brequest\b/gi, 'action')
        .replace(/\bcollection\b/gi, 'To review')
    : text;
}
