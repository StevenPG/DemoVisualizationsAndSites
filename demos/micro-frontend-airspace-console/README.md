# Airspace Console — a micro frontend reference

One page, assembled in the browser from **four independently built bundles owned
by three teams**, integrated through a single versioned contract and a registry
the shell reads at runtime.

It is a working application, not a diagram: the teams' code is really separate,
the builds really are independent, and you can break one of them from the
inspector and watch the rest of the console carry on.

```
/#/            Overview          shell only
/#/ops         Operations Board  ops-board@2026.8.0     React 19 + TS   Team Airspace Ops
/#/analytics   Airspace Analytics analytics@2026.8.1    React 19 + TS   Team Airspace Ops
/#/notams      NOTAM & Weather   notam-ticker@2026.6.2  Svelte 5        Team Weather Services
```

**Open the "Federation inspector" in the bottom-right first.** Four tabs:

| Tab | What it shows |
| --- | --- |
| **X-ray** | What loaded, from which URL, how long it took, which contract version it speaks, and whether React is genuinely one instance across all four bundles |
| **Faults** | 404 a remote, hang it, or make it throw inside `mount()` — all injected shell-side, without the remote's cooperation |
| **Contract** | Every call and event crossing the boundary, live, in both directions |
| **Releases** | Swap a remote between two separately built versions at runtime, with no shell rebuild and no page reload |

## Running it

```bash
npm install
npm run dev micro-frontend-airspace-console   # all five dev servers, production routes
npm run preview                               # build everything, serve dist/
```

Each app can also be run entirely on its own, which is the point of the harness:

```bash
cd demos/micro-frontend-airspace-console/apps/ops-board && npm run dev
```

That gives Team Airspace Ops a working page with real filters, real toasts and a
real event bus, with **none of the other teams' code on their machine** — see
[Local development](#local-development-the-part-that-decides-whether-this-works).

## Who owns what

```
packages/contract/     @airspace/contract    the agreement, owned jointly
apps/shell/            @airspace/shell       Team Platform Experience
apps/ops-board/        @airspace/ops-board   Team Airspace Ops
apps/analytics/        @airspace/analytics   Team Airspace Ops
apps/notam-ticker/     @airspace/notam-ticker Team Weather Services
```

In a real programme these are five repositories. They are one here because a demo
has to be clonable in one command — but nothing in the code depends on that, and
[Splitting this into real repos](#splitting-this-into-real-repos) is a
half-day's work rather than a rewrite. The test to apply to your own setup:
**delete any one remote's source and the shell must still build, deploy and
run.** It does here.

## How it fits together

```
                       registry.json  ← the only thing the shell knows
                             │           (a service in production)
                             ▼
   ┌──────────────────── @airspace/shell ────────────────────┐
   │ header · nav · filters · router · toasts · auth · slot  │
   └───────────────────────────┬─────────────────────────────┘
                               │  mount(container, state, services, bus, onError)
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   ops-board              analytics              notam-ticker
   React 19               React 19               Svelte 5
   own data layer         own data layer         own data layer
        └──────────────────────┴──────────────────────┘
                    @airspace/contract (types + bus + version check)
```

Three rules produce everything else:

1. **Remotes never import each other, and never import the shell.** They cannot:
   those packages are not in their `package.json`. All coordination is the
   contract.
2. **The shell knows nothing about a remote until runtime.** No remote name, URL,
   version or navigation entry is compiled into the shell bundle — check
   `apps/shell/module-federation.config.ts`, where `remotes` is empty on purpose.
3. **The contract is versioned and checked at the boundary**, because remotes are
   deployed independently and skew is the normal state of the world, not an
   error.

## The contract

`packages/contract/src/index.ts` is the whole agreement, and it is deliberately
small enough to read in one sitting. The technical part is four lines:

```ts
interface MicroFrontendModule {
  contractVersion: string;
  meta: RemoteMeta;
  mount(context: MountContext): MicroFrontendHandle;   // ← that's it
}
```

`mount` gets a DOM node, a snapshot of shell-owned state, a set of services, an
event bus and an error callback; it returns `{ update, unmount }`. Everything
else in the package exists to describe those arguments.

**It is framework-neutral on purpose.** The shell hands over a `HTMLElement`, not
a React element. That is why `apps/notam-ticker` can be Svelte with no adapter,
no branch in the shell, and no permission required from anyone —
`@airspace/contract/react` is a *convenience for the React teams*, built on top
of the neutral contract, not a second contract.

### What belongs in it

| In the contract | Why | Not in the contract | Why not |
| --- | --- | --- | --- |
| `notify`, `navigate`, `getAccessToken`, `track` | Two teams would otherwise build them twice and get them visibly inconsistent | Data fetching, API clients | Sharing them couples every team's release train to one schema |
| Filters, theme, session, sub-route | Shell-owned state every remote reads | Domain types a remote uses internally | Every schema change would become a cross-team release |
| A typed event bus | The only channel between remotes | A shared component library | Components change weekly; a hard dependency on them removes independent deploys |
| Design **tokens** (`--ax-*`) | Change on the scale of a rebrand | Design **components** | See above |

### Events are facts, never commands

`flight:selected` can be ignored by every listener without breaking the emitter.
`openFlightPanel` could not — it would quietly make the emitter depend on a
listener existing, which is a distributed function call wearing an event's
clothes.

The bus supports opt-in `replayLast`, and it earns its place: micro frontends
mount at different times, so without it the most useful case — select a flight in
one app, open another, expect it to know — is silently dropped, because the
second app subscribed a second too late. It is opt-in rather than always-on
because replaying anything with a side effect (`alert:raised` → a toast) would
re-fire it on every remount.

### Version skew is normal

`checkCompatibility()` runs at the boundary on every load:

- **Same major, older minor** — fine, and expected. The remote ignores fields it
  does not know about.
- **Same major, newer minor** — mounted anyway, and flagged. Refusing would mean
  the contract could never be rolled out remote-first.
- **Different major** — refused, with a readable message, before mounting.

## Independent deploys: what actually makes them work

The registry. `apps/shell/src/registry.ts` is worth reading in full — it is the
piece most Module Federation tutorials leave out, and leaving it out is what
quietly undoes the whole exercise.

The usual tutorial hard-codes remote URLs in the host's build config. Do that and
adding a micro frontend, moving one to a different CDN, or rolling one back all
become *shell* releases: the teams are coupled again, through the host's build,
and nobody notices until the first incident. Here the shell registers remotes at
runtime from a document it fetches on boot, so:

| Operation | What it costs |
| --- | --- |
| Team B ships | A registry entry's `current` moves. No shell build, review or release. |
| Team B breaks production | `current` moves back. A rollback is one PATCH. |
| A new team joins the console | One new registry entry — including its nav item, which is why `nav` lives in the registry and not in the shell's source. |
| Canary a remote to 5% of users | The registry service answers differently per user. The shell is unchanged. |

Here the registry is a static JSON file written by the build (`registry.mjs`),
which is the same shape with the interesting parts removed. `?registry=<url>`
points the console at a different one without a rebuild.

**Try it:** inspector → Releases → switch `ops-board` to `2026.7.0`. The Wake
column disappears, because that is a genuinely different build from a genuinely
different source state — not a feature flag read at runtime. The shell was not
rebuilt and the page did not reload.

## Shared dependencies, and the trap in verifying them

React and react-dom are declared `singleton` by the shell and by both React
remotes. This is not an optimisation — it is correctness. Two React copies on one
page means two hook dispatchers and an "invalid hook call" the first time a
remote renders.

The trap is in *checking* it. The obvious probe compares the module namespace
objects:

```ts
remoteReact === hostReact   // false — even when sharing works perfectly
```

React ships as CommonJS, and the ESM interop hands each consuming module graph
its own namespace wrapper around the same underlying instance. That comparison
reports a false duplicate, and teams have ripped out working configurations
because of it. Compare an *export* instead:

```ts
remoteReact.useState === hostReact.useState   // true iff genuinely one instance
```

That is what the X-ray tab does — and why it compares references rather than
version strings, which would happily report `19.2.8` twice while two copies fight
over the dispatcher. This demo found its own bug that way; the panel said
DUPLICATED before the probe was fixed.

Note what the Svelte remote reports: **nothing**, and that is the answer, not a
gap. It never resolved React. Its `shared` block is empty on purpose — sharing is
for dependencies more than one app uses, and Svelte's runtime rides along inside
that one bundle, which is precisely why that team could adopt it without asking
anyone.

## Failure isolation

The property worth buying micro frontends for, and the one worth testing before
depending on it. Four failure modes, all handled in `apps/shell/src/RemoteSlot.tsx`:

| Failure | Handling |
| --- | --- |
| Bundle 404s (bad deploy, purged CDN path) | Caught at load; fallback card with a retry; nothing else affected |
| Edge hangs | Same path, after the wait; the console stays interactive throughout |
| `mount()` throws | Caught at mount; same fallback |
| The remote throws while rendering | The remote's own boundary catches it and calls `context.onError` |

That last one needs the contract, and it is the subtle one: because each remote
renders in its own framework root, **the shell's error boundary can never see
inside a remote**. Excellent for blast radius, useless for reporting — so the
remote catches its own errors (the React adapter does it automatically) and hands
them over. The alternative, a remote that renders a blank div and says nothing,
is the worst of both.

**Try it:** open `/#/ops`, then click "simulate a render crash" in the footnote,
then Retry.

## Routing

The shell owns history. All of it. Remotes receive the slice of the path below
their mount point as a plain string and change it by calling
`services.navigate()`. They never touch `history` and never install a listener.

The alternative — every remote nesting its own router under a `basename` — works
and is what most examples show, but then each team ships a router, they all race
to write the same URL, and the back button behaves differently depending on which
app is mounted. Handing down a string costs one prop and cannot fight with
itself. It also works unchanged for the Svelte remote.

`apps/shell/src/router.ts` is deliberately forty lines rather than a dependency:
the shell's job here is turning a URL into "which remote, and what is its
sub-path". Swap in react-router or TanStack Router when the shell's *own* pages
need them — the only thing that must survive is that `SharedState.route` stays a
string the shell computes.

**The hash is a deployment concession, not a recommendation.** This console is
static files under `/demos/<slug>/` with no rewrite rules, so `#/ops/flights/DAL231`
keeps deep links working with no server involved. On infrastructure you control,
drop the `#` and add a catch-all rewrite to `index.html`; nothing else changes.

## Styling and isolation

Three mechanisms, chosen per team, which is the point:

- **React remotes** use CSS Modules — class names are hashed at build time, so
  collisions are impossible rather than merely unlikely.
- **The Svelte remote** uses Svelte's compile-time scoping.
- **The shell** publishes design tokens as CSS custom properties (`--ax-*`).

No shadow DOM and no iframes: both isolate more than you want (shadow DOM breaks
the token cascade and most focus management; iframes break layout, routing and
accessibility), and neither is needed once every team's styles are scoped by
their own build.

The tokens are why the console looks like one product. A theme switch in the
shell reaches every remote — including the Svelte one — through the cascade, with
no message passing at all. The chart palette lives there too, validated once for
both light and dark, so no team spends time re-deriving chart colours.

## Local development: the part that decides whether this works

The most expensive failure mode in a micro frontend programme is a team that
cannot run its own app without running everybody else's. It starts as "just clone
the shell too", becomes "and the other three remotes", and ends with a shared dev
environment, a shared branch, and no independent deploys left.

So the contract ships a **mock shell** (`@airspace/contract/harness`). Each app's
`src/standalone.*` is three lines, and `npm run dev` in any app folder gives a
real page with working filters, toasts, navigation and bus — no federation
involved, no other team's code, instant HMR.

It deliberately does not look like the production shell. Anything that matters —
spacing, colour, chrome — belongs to the shell, and a harness that imitates it
teaches teams to build against pixels they do not own.

## Deliberate simplifications

Honest list of what a production version adds:

- **The registry is a static file.** Make it a service, and per-user rollout,
  canary percentages and instant rollback become its job rather than a deploy's.
- **Data is simulated in-process.** Each remote has its own data layer with its
  own types, which is the part that matters; the fetch is a `setTimeout`.
- **The session is a constant.** `getAccessToken` demonstrates the shape — the
  shell owns the session so refresh happens in one place and no remote ever
  renders a login screen — but there is no IdP behind it.
- **No contract tests.** The obvious next step: the harness is the natural place
  to run each remote against a *pinned* contract version in CI, so a remote that
  breaks the agreement fails its own pipeline rather than the shell's.
- **One remote per route.** Real consoles compose several remotes on one page.
  Nothing in the contract prevents it; `RemoteSlot` is already independent.
- **Two releases stand in for two commits.** `__RELEASE__` is compiled in so this
  repo can build one source twice; in real life those are two commits weeks apart.
- **The Svelte remote's `.svelte` files are not typechecked** — `svelte-check`
  does not support TypeScript 7 yet, so `npm run typecheck` there covers its
  `.ts` only. Everything else in the demo is checked under `strict` plus
  `noUncheckedIndexedAccess`.

## Splitting this into real repos

1. Copy `packages/contract/` into its own repo, publish it to a private registry,
   and pin it by version in each app (`"@airspace/contract": "1.2.0"`). It is the
   one shared dependency, and versioning it is what keeps it from becoming a
   bottleneck.
2. Copy each `apps/<name>/` to its own repo. Nothing has to change: their Vite
   configs already take `base` and `outDir` from whoever runs the build, which is
   a deploy-time decision, not a source-time one.
3. Give each repo a pipeline that builds, uploads to `https://cdn/<app>/<version>/`,
   and then PATCHes its entry in the registry service. That last step *is* the
   deploy.
4. Replace `registry.json` with the registry service. The shell's
   `fetchRegistry()` does not change.
5. Keep `layout.mjs`, `build.mjs` and `dev.mjs` in exactly one place: they are
   this demo's stand-in for four CI pipelines, and they should not survive the
   split.

## When not to do any of this

Micro frontends buy **independent deployability across team boundaries**, and
they are paid for in runtime complexity, a contract to maintain, duplicated
tooling and a harder debugging story. If you have one team, or several teams that
already ship on the same cadence, a modular monolith with good boundaries wins on
every axis — and it is a much easier thing to convert *into* this later than the
reverse.

The honest test: can you name the teams, and do they currently block each other
on releases? If not, the answer is no.

## Files worth reading, in order

| File | Why |
| --- | --- |
| `packages/contract/src/index.ts` | The entire agreement between the teams |
| `apps/shell/src/RemoteSlot.tsx` | The whole host-side integration, including every failure path |
| `apps/shell/src/registry.ts` | Why the deploys are actually independent |
| `apps/shell/src/federation.ts` | The only file that knows Module Federation exists |
| `packages/contract/src/react.tsx` | The React adapter, and the two teardown gotchas |
| `apps/notam-ticker/src/mfe.ts` | The same contract without React |
| `apps/*/module-federation.config.ts` | Each team's published surface — one module each |
