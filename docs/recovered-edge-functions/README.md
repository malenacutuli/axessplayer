# Recovered edge functions (archive, NOT deployable from here)

Source of production edge functions that were live on Supabase `faeyekynudyzeotbjfsj` but existed in no repo.
Downloaded verbatim with `supabase functions download --use-api` on 2026-10-01. See DEPLOYMENT_STATE.md section 2.

These functions belong to the Lovable accessibility app (mvpsigndemo-20, Zone 1). They are archived here only so
the deployed code is versioned and reviewable. Do not deploy them from this repo. Their proper home is
`mvpsigndemo-20/supabase/functions/`, via a branch on that repo.

The axessplayer-owned functions (`axessplayer-*`, `axess-signapse-probe`) live in `supabase/functions/` instead,
because they are owned and changed by this repo.

Known issues found during recovery (not fixed here, Zone 1):
- `complete-multipart`, `generate-upload-url`: no user auth, CORS `*`. `generate-upload-url` trusts `userId` from
  the request body.
- `upload-direct-to-s3`: checks the JWT, but `chunk` and `complete` accept any `x-key` (no `videos/{user.id}/`
  ownership check).
- `_shared/r2-config.ts` hardcodes a public r2.dev URL.
