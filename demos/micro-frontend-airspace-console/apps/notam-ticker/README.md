# @airspace/notam-ticker — Team Weather Services

NOTAM and weather ticker. **Svelte 5**, on purpose.

This app exists to prove the boundary is not React-shaped. It exports exactly the
same `MicroFrontendModule` the React apps do — same `mount(context)`, same
handle — implemented against Svelte's `mount`/`unmount`. The shell has no branch
for it and cannot tell.

`src/mfe.ts` is the Svelte equivalent of `@airspace/contract/react`'s
`defineReactRemote`. There is no privileged framework here, only one that happens
to have a helper because two teams use it.

Its `shared` block is empty: sharing is for dependencies more than one app uses.
Svelte's runtime ships inside this bundle, which is exactly what lets this team
choose it without asking anyone.

```bash
npm run dev        # standalone, against the contract's mock shell
npm run typecheck  # .ts only — svelte-check does not support TypeScript 7 yet
```
