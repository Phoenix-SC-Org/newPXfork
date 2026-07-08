
import { createClient } from '@supabase/supabase-js';
import { log as baseLog } from './log.js';

const log = baseLog.child({ module: 'lib.supabaseServer' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
}

// Use the runtime's global fetch (Node's built-in undici) directly — no custom
// dispatcher/Agent. A dispatcher built from the project's own `undici` package
// version is not guaranteed to be compatible with the Node runtime's internal
// undici (mismatched internals throw "invalid onRequestStart method" /
// UND_ERR_INVALID_ARG on some Node versions), which broke all Supabase calls.
// NOTE (upstream c27b797 merge): upstream reintroduced a custom undici Agent with
// connection pooling here; we intentionally keep our global-fetch version because
// the custom dispatcher broke Supabase calls on our runtime. See handoff.
export const supabase = createClient(supabaseUrl, supabaseKey);

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
