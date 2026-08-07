/** Team Weather Services' dev entry: the same mock shell the React teams use. */
import mfe from './mfe';
import { mountInMockShell } from '@airspace/contract/harness';

mountInMockShell(mfe);
