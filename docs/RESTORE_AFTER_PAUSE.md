# Restore Folio after the development pause

Paused on **2026-11-06** on `ui/concepts-redesign` in
[ritikpandey1981/digital-notes](https://github.com/ritikpandey1981/digital-notes).
The exact product commit is `cca2d1866c08e4693125e055dec3e12452c1607e`.
The archive commit is its direct child adding only this guide. To find that
commit even after the branch advances, run `git log --diff-filter=A --format=%H -- docs/RESTORE_AFTER_PAUSE.md`.

## Restore on Windows

Install Git, Node.js **22.12.0 or newer**, and **pnpm 11.9.0** (the version
pinned in `package.json`). Dependency installation needs access to the package
registry and Electron downloads, or a populated local cache. From a parent
directory where you want the checkout:

```powershell
git clone --branch ui/concepts-redesign https://github.com/ritikpandey1981/digital-notes.git
cd digital-notes
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

Launch the Electron editor with `pnpm dev`. To run the focused launch check
after building, use `pnpm exec playwright test tests/e2e/electron-launch.spec.ts`.
To create the unpacked Windows desktop application, use `pnpm package`.
Dependencies, generated builds, installers, and local test output are regenerated;
they do not need to be copied from the old checkout.

## Where to resume

Technical Pen, Pressure Pen, Pencil, and Marker have frozen output. Recovery
R1/R2/R3 and E6A catalogue classification are complete. No E6B preset migrations
had been performed. Next: make the **five E6 visual migration prototypes** and
review the sheets before changing any production presets. See the
[catalogue audit](design/brush-catalogue-e6.md) and [roadmap](ROADMAP.md).
