/**
 * Team Airspace Ops' development entry point.
 *
 * `npm run dev` in this folder gives a working page with no shell, no other
 * remotes and no Module Federation involved at all — the component is imported
 * directly, so HMR is instant and the debugger is not looking at a federated
 * chunk. The mock shell comes from the contract package, which means the thing
 * this app is developed against and the thing it is deployed against are
 * described by the same types.
 */
import mfe from './mfe';
import { mountInMockShell } from '@airspace/contract/harness';

mountInMockShell(mfe);
