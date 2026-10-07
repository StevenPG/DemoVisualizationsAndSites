# @airspace/shell — Team Platform Experience

The application shell: header, navigation, global filters, session, routing,
notifications, and the slot every micro frontend mounts into.

**This repo owns no business features.** The moment a shell grows a feature, it
grows a reason for a feature team to need a shell release, and the console's
teams stop being independent. If something here looks like domain logic, it
belongs in a remote.

What it does own:

- `src/registry.ts` — what exists, fetched at runtime. The only source of truth
  about remotes; nothing about them is compiled into this bundle.
- `src/federation.ts` — the only file that knows Module Federation exists.
- `src/RemoteSlot.tsx` — load, contract-check, mount, update, unmount, and every
  failure path.
- `src/console-store.tsx` — shell-owned state, and the services handed to each
  remote (minted per remote, so calls are attributable and relative navigation
  resolves correctly).
- `src/styles/tokens.css` — the design tokens every team styles against.
- `src/devtools/` — the federation inspector. Demo instrumentation, but the
  X-ray tab is worth shipping behind a flag in a real console.

```bash
npm run dev        # needs the remotes; use the repo's `npm run dev <slug>`
npm run typecheck
```
