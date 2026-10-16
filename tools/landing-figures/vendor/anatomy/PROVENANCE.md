# Anatomy kit, vendored

These files are a verbatim copy of part of **Anatomy**, the isometric figure kit by Ryan, published under the MIT licence (see `LICENSE`, kept unchanged).

- **Upstream:** https://github.com/wheresryan22/anatomy
- **Version:** release 1.1.0 (2026-10-12) plus the changes its changelog lists as Unreleased, as installed on 2026-10-17. The installed copy carried no git metadata, so no upstream commit is recorded; `MANIFEST.sha256` pins the exact bytes instead.
- **Copied:** the kit modules the landing figures use (`kit/iso-kit.mjs`, `kit/lathe.mjs`, `kit/tube.mjs`, `kit/audit.mjs`), and the headless Chrome driver and line-end check the `check` command runs (`scripts/drive.mjs`, with `scripts/line-ends.mjs` and `scripts/chrome-port.mjs`). Nothing else from the project is included.

Do not edit these files. To update them, copy the new upstream files over these, regenerate `MANIFEST.sha256` (`shasum -a 256` of every file except this note and the manifest, sorted by path), update this note, and run `pnpm --filter @splitbook/landing-figures check`, which fails when these files differ from the manifest.
