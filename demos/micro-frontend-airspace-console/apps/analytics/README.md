# @airspace/analytics — Team Airspace Ops

Sector load and delay analytics. React 19 + TypeScript, inline SVG charts.

Same team as `ops-board`, deliberately not the same application and sharing no
module with it: two apps owned by one team is not a reason to couple them, since
the reason they were split is that they ship on different days.

The charts use the shell's `--ax-series-*` tokens rather than a palette of their
own — validated once, in the shell, for both light and dark.

```bash
npm run dev        # standalone, against the contract's mock shell
npm run typecheck
```
