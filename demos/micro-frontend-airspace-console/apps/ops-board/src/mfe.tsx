import { defineReactRemote } from '@airspace/contract/react';
import OpsBoard from './OpsBoard';
import { RELEASE } from './data';

/**
 * The one module this app exposes. Keeping it to a handful of lines is
 * deliberate: it is the only file the shell can reach, so it is the only file
 * whose shape is a cross-team commitment.
 */
export default defineReactRemote(
  {
    name: 'ops-board',
    title: 'Operations Board',
    team: 'Airspace Ops',
    version: RELEASE,
    runtime: 'react',
  },
  OpsBoard,
);
