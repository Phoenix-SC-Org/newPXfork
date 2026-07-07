// Comms provider factory. Swap StarCommsProvider here (or select by an env
// var) to move to a different backend later — callers depend only on the
// CommsProvider interface, never on the concrete implementation.

import { StarCommsProvider } from './starcomms.js';
import type { CommsConfigSummary, CommsProvider } from './types.js';

let provider: CommsProvider | null = null;

/** The active comms provider (stateless; reads env live on each call). */
export function getCommsProvider(): CommsProvider {
    if (!provider) provider = new StarCommsProvider();
    return provider;
}

/** Secret-free config summary for the active provider. */
export function describeCommsConfig(): CommsConfigSummary {
    return getCommsProvider().describeConfig();
}

export type {
    CommsProvider,
    CommsResult,
    CommsStatus,
    CommsConfigSummary,
    CommsErrorKind,
    CommsNet,
} from './types.js';
