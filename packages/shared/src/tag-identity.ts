/** Tags belong to a Group; names are display text, never identity. */
export interface IdentityTag {
  _id: unknown;
  name: string;
  isArchived: boolean;
  /** Retained after deletion so an admitted concurrent write cannot dangle. */
  isDeleted?: boolean;
}

export interface TagReference {
  tagId?: unknown;
  tag?: string;
}

export function findReferencedTag(
  tags: IdentityTag[],
  reference: TagReference,
): IdentityTag | undefined {
  if (reference.tagId) return tags.find((tag) => String(tag._id) === String(reference.tagId));
  const matches = tags.filter((tag) => tag.name === reference.tag);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Decorate a response without rewriting the historical display fallback. */
export function displayTagReference(tags: IdentityTag[], reference: TagReference) {
  const tag = findReferencedTag(tags, reference);
  return {
    tag: tag?.name ?? reference.tag ?? '',
    ...(tag
      ? { tagId: String(tag._id) }
      : reference.tagId
        ? { tagId: String(reference.tagId) }
        : {}),
  };
}

/** Resolve compatible name requests only when they identify exactly one Tag. */
export function resolveTagReference(
  tags: IdentityTag[],
  incoming: TagReference,
  existing?: TagReference,
): { tag: string; tagId?: string } {
  const hasSelection = incoming.tagId !== undefined || incoming.tag !== undefined;
  const keepsLegacyDisplay = existing?.tagId && !incoming.tagId && incoming.tag === existing.tag;
  const selection = !hasSelection || keepsLegacyDisplay ? existing : incoming;
  if (!selection) throw new Error('INVALID_TAG');
  const tag = findReferencedTag(tags, selection);
  const oldTag = existing && findReferencedTag(tags, existing);
  const unchanged =
    !!existing &&
    (!hasSelection ||
      (tag && oldTag && String(tag._id) === String(oldTag._id)) ||
      (!incoming.tagId && incoming.tag === existing.tag));

  // Unknown legacy names remain readable/editable, but are never reassigned.
  if (!tag) {
    if (unchanged && !selection.tagId && existing?.tag) return { tag: existing.tag };
    throw new Error('INVALID_TAG');
  }
  if ((tag.isArchived || tag.isDeleted) && !unchanged) throw new Error('INVALID_TAG');
  return { tagId: String(tag._id), tag: tag.name };
}
