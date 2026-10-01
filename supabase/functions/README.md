# Axessplayer edge functions

Deployed to Supabase `faeyekynudyzeotbjfsj`. Before 2026-10-01 these existed only in production; the first commit
of this folder is their verbatim deployed source, so later security changes are reviewable as diffs.

All of them run with `verify_jwt = true` at the gateway. The gateway accepts the public anon key as a valid JWT,
so each function must also check for a real signed-in user itself.

Deploy one function (production action, needs approval):
`supabase functions deploy <name> --project-ref faeyekynudyzeotbjfsj`
Roll back: redeploy the previous commit's version of the same folder.
