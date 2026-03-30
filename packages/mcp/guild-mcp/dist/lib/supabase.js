import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
/** Service-level client for operations that don't need user context */
export function createAdminClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
/** Per-request client with user's JWT (RLS enforced) */
export function createUserClient(jwt) {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${jwt}`,
                "x-oauth-client-id": process.env.OAUTH_CLIENT_ID,
            },
        },
    });
}
//# sourceMappingURL=supabase.js.map