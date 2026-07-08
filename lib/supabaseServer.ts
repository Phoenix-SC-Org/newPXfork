
import { createClient } from '@supabase/supabase-js';
<<<<<<< HEAD
=======
import { Agent, fetch as undiciFetch } from 'undici';
>>>>>>> c27b797e69756b60e14543971cdb6457f2620efe
import { log as baseLog } from './log.js';

const log = baseLog.child({ module: 'lib.supabaseServer' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
}

<<<<<<< HEAD
// Use the runtime's global fetch (Node's built-in undici) directly — no custom
// dispatcher/Agent. A dispatcher built from the project's own `undici` package
// version is not guaranteed to be compatible with the Node runtime's internal
// undici (mismatched internals throw "invalid onRequestStart method" /
// UND_ERR_INVALID_ARG on some Node versions), which broke all Supabase calls.
export const supabase = createClient(supabaseUrl, supabaseKey);
=======
// Custom HTTP agent with connection pooling to prevent connection exhaustion
// under concurrent Supabase queries (default undici limits are too low).
const fetchAgent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 50,
    pipelining: 1,
    // undici 8 defaults allowH2 to true; pin this pool to HTTP/1.1 so the tuned
    // keep-alive / connection-pool behavior stays identical to the undici 7 setup.
    allowH2: false,
});

// Dispatch through undici's OWN fetch, not Node's global fetch. The `dispatcher`
// Agent above is from the node_modules undici (v8); Node's built-in fetch is
// backed by a DIFFERENT internal undici, and handing one's Agent to the other's
// fetch throws `invalid onRequestStart method` (mismatched request-handler
// interface). Keep fetch + Agent in the same undici copy.
const customFetch: typeof globalThis.fetch = (input, init) =>
    undiciFetch(input as any, { ...init, dispatcher: fetchAgent } as any) as any;

export const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { fetch: customFetch },
});
>>>>>>> c27b797e69756b60e14543971cdb6457f2620efe

export const handleSupabaseError = ({ error, message }: { error: any, message: string }) => {
    if (error) {
        // Detail (PGRST codes, column names, constraint names) goes to logs
        // only — the rethrown Error carries just the high-level caller-provided
        // message so the dispatcher's 500 handler doesn't surface schema info
        // to clients. See lib/errors.ts / api/services.ts for the full path.
        log.error(message, { err: error });
        throw new Error(message);
    }
}
