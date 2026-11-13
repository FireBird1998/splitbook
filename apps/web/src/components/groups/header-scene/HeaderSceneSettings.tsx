'use client';

import { useMemo, useState } from 'react';
import {
  HEADER_SCENES,
  groupHeaderSchema,
  readGroupHeader,
  headerCard,
  headerTimeOfDay,
  type GroupHeader,
} from '@splitbook/shared/group-header';
import type { GroupRead } from '@splitbook/shared/group-read';
import { apiFetch } from '@/lib/utils/api-fetch';
import HeaderSceneSettingsView, { sameHeader, headerTimeLabel } from './HeaderSceneSettingsView';
import ScenePreview from './ScenePreview';
import ClassicHeaderPreview from './ClassicHeaderPreview';
import { setScenePreferences, useScenePreferences } from './scene-preferences';
import { useHeaderClock } from './use-header-clock';

export default function HeaderSceneSettings({
  group,
  onSaved,
}: {
  group: GroupRead;
  onSaved: () => void;
}) {
  const incoming = useMemo(() => readGroupHeader(group.header), [group.header]);
  const [form, setForm] = useState<{
    value: GroupHeader;
    saved: GroupHeader;
    saving: boolean;
    error: string | null;
    notice: boolean;
  }>(() => ({ value: incoming, saved: incoming, saving: false, error: null, notice: false }));
  const preferences = useScenePreferences(),
    clock = useHeaderClock();
  const [observed, setObserved] = useState(incoming);
  // Adjust only when a different server choice arrives; an unsaved choice stays with its member.
  if (!sameHeader(observed, incoming)) {
    setObserved(incoming);
    if (!sameHeader(form.saved, incoming))
      setForm((previous) => ({
        ...previous,
        saved: incoming,
        value: sameHeader(previous.value, previous.saved) ? incoming : previous.value,
        error: sameHeader(previous.value, incoming) ? null : previous.error,
        notice: false,
      }));
  }
  const time = headerTimeOfDay(form.value.time, clock?.hour ?? 12);
  const save = async () => {
    if (form.saving || sameHeader(form.value, form.saved)) return;
    const sent = form.value;
    setForm((previous) => ({ ...previous, saving: true, error: null, notice: false }));
    try {
      const response = await apiFetch(`/api/groups/${group._id}/header`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sent),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(typeof body?.error === 'string' ? body.error : 'Please try again.');
      const result = groupHeaderSchema.safeParse(body?.data?.header);
      if (!result.success) throw new Error('The saved header could not be confirmed.');
      setForm({ value: result.data, saved: result.data, saving: false, error: null, notice: true });
      onSaved();
    } catch (error) {
      setForm((previous) => ({
        ...previous,
        saving: false,
        error: error instanceof Error ? error.message : 'Please try again.',
      }));
    }
  };
  return (
    <HeaderSceneSettingsView
      groupName={group.name}
      value={form.value}
      saved={form.saved}
      preferences={preferences}
      saving={form.saving}
      error={form.error}
      savedNotice={form.notice}
      preview={
        form.value.style === 'scene' ? (
          <ScenePreview
            scene={form.value.scene}
            time={time}
            motion={preferences.motion}
            followPointer={preferences.followPointer}
          />
        ) : (
          <ClassicHeaderPreview card={headerCard(group, clock?.today ?? '')} />
        )
      }
      previewCaption={
        form.value.style === 'classic'
          ? 'Classic header'
          : `${HEADER_SCENES.find((scene) => scene.id === form.value.scene)?.name}, ${form.value.time === 'auto' ? `now, ${time}` : headerTimeLabel(form.value.time)}`
      }
      thumbnails={Object.fromEntries(
        HEADER_SCENES.map((scene) => [
          scene.id,
          <ScenePreview
            key={scene.id}
            scene={scene.id}
            time="day"
            motion={false}
            followPointer={false}
            thumbnail
          />,
        ]),
      )}
      onChange={(value) =>
        setForm((previous) => ({ ...previous, value, error: null, notice: false }))
      }
      onPreferences={setScenePreferences}
      onSave={() => void save()}
      onDiscard={() =>
        setForm((previous) => ({ ...previous, value: previous.saved, error: null, notice: false }))
      }
    />
  );
}
