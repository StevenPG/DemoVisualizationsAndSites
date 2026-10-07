import { defineReactRemote } from '@airspace/contract/react';
import Analytics from './Analytics';
import { RELEASE } from './data';

export default defineReactRemote(
  {
    name: 'analytics',
    title: 'Airspace Analytics',
    team: 'Airspace Ops',
    version: RELEASE,
    runtime: 'react',
  },
  Analytics,
);
