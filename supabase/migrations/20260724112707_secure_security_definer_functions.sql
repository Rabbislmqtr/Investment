-- These functions are trigger entrypoints, not Data API RPCs. PostgreSQL grants
-- EXECUTE to PUBLIC by default, so explicitly remove every API-facing grant.
-- Database and event triggers continue to invoke their functions without callers
-- needing EXECUTE privileges.

alter function public.handle_new_user() set search_path = '';

revoke execute on function public.handle_new_user()
from public, anon, authenticated, service_role;

revoke execute on function public.rls_auto_enable()
from public, anon, authenticated, service_role;

-- Make future public-schema functions opt-in instead of publicly executable by
-- default. Application RPC migrations must grant EXECUTE to their intended role.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
