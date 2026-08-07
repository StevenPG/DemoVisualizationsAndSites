# @airspace/contract

The integration surface between the shell and every micro frontend. Types, a
typed event bus, a version check, and a mock shell. No UI, no framework, no
business logic.

**This package is the whole agreement.** If something is not in here, one team is
depending on another team's implementation detail, and the independent-deploy
property is already gone.

| Entry point | What it is |
| --- | --- |
| `@airspace/contract` | The contract itself: `MicroFrontendModule`, `MountContext`, `ShellServices`, `EventBus`, `checkCompatibility` |
| `@airspace/contract/react` | A convenience adapter for the teams using React. Produces exactly the same module a team could hand-roll |
| `@airspace/contract/harness` | A mock shell, so every team can run its own app with nobody else's code |

## Versioning

`CONTRACT_VERSION` is semver and is checked at runtime, at the boundary, on every
load — because remotes deploy independently and skew is the normal state of the
world.

- **Minor bump** for additive, optional changes. Remotes that predate the field
  keep working; the shell flags a remote that is ahead of it.
- **Major bump** for anything a remote could be relying on. A major mismatch is
  refused at the boundary rather than mounted and left to fail somewhere less
  obvious.

In a real setup this is a published package pinned by version in each app's
`package.json`, and a major bump is a scheduled, coordinated migration — the one
place in the architecture where the teams genuinely have to talk to each other.
Keep it small, and that conversation stays rare.
