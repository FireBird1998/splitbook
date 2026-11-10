import { describe } from 'vitest';
import { recordingFixture, type Writer } from './fixture';
import { recordCommonPaths } from './common-paths';
import { recordChangesPaths } from './changes-paths';
import { recordCreationPaths } from './creation-paths';

export function recordWriter(writer: Writer) {
  describe(`${writer} record of recordings`, () => {
    const recording = recordingFixture(writer);
    recordCommonPaths(recording);
    recordChangesPaths(recording);
    recordCreationPaths(recording);
  });
}
