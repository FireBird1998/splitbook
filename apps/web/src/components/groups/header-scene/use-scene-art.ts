'use client';

import { useEffect, useState } from 'react';
import type { GroupHeader } from '@splitbook/shared/group-header';
import { loadHeaderScene } from './scene-art';

type Picture = Awaited<ReturnType<typeof loadHeaderScene>>;
/** A changed id/retry masks the last result until its own asynchronous load answers. */
export function useSceneArt(id: GroupHeader['scene']) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id}:${attempt}`;
  const [answer, setAnswer] = useState<{ key: string; picture?: Picture; failed?: boolean } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    void loadHeaderScene(id)
      .then((picture) => {
        if (current) setAnswer({ key, picture });
      })
      .catch(() => {
        if (current) setAnswer({ key, failed: true });
      });
    return () => {
      current = false;
    };
  }, [id, key]);
  const visible = answer?.key === key ? answer : null;
  return {
    picture: visible?.picture ?? null,
    failed: visible?.failed ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
