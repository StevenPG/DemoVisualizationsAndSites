# @airspace/ops-board — Team Airspace Ops

The live operations board. React 19 + TypeScript.

Everything it knows about the rest of the console arrives through
`@airspace/contract`. It imports nothing from the shell and nothing from another
remote — and it cannot, because neither is in its `package.json`.

```bash
npm run dev        # runs standalone against the contract's mock shell
npm run build
npm run typecheck
```

`npm run dev` needs no shell, no registry and no other team's code. If that ever
stops being true, the boundary has leaked.

- `src/mfe.tsx` — the one module this app exposes. The only file whose shape is
  a cross-team commitment.
- `src/OpsBoard.tsx` — the app itself.
- `src/data.ts` — this team's own data layer. No other team imports it.
- `module-federation.config.ts` — the published surface, and the shared-dependency
  declaration.
