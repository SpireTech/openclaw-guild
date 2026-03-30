import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-level client for operations that don't need user context */
export function createAdminClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Per-request client with user's JWT (RLS enforced) */
export function createUserClient(jwt: string): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "x-oauth-client-id": process.env.OAUTH_CLIENT_ID!,
        },
      },
    },
  );
}

export type { SupabaseClient };
