# Humor Lab · Chain Tool

Week 8: a separate Next.js application for creating and running sequential AI prompt chains. Uses the existing Humor Lab Supabase project; experimental `studio_*` chains do not change the public app's production prompt mix.

## Features

- Google login plus the current `profiles.is_superadmin` flag on every page, API operation, database function and storage policy.
- Create/edit chains; add, edit, remove and reorder up to eight steps. Save atomically with stale-version protection.
- Recoverable chain deletion and restore. Existing run history stays intact.
- Each step makes a separate Gemini call. Inputs include the source image/scene, and optionally the preceding step's output. The three-step starter describes an image, finds an angle, and writes five captions.
- Private source-image uploads (JPG/PNG/WebP, 4 MB); signed previews. Text scenes also work.
- Per-chain generated-media history (latest 25 runs), immutable step/model/instruction snapshots, exact submitted prompts, outputs, latency and token counts. Step claims prevent duplicate or out-of-order execution. Failed/interrupted runs remain inspectable; pending runs can resume.
- Light, dark and system modes, persisted locally. Responsive editor, labelled navigation and divider lines.

## Setup

Use pinned dependencies: `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env.local` and supply the existing project's URL/anon key plus a server-only Gemini key. No service-role key is used.

Apply `supabase/migrations/20261105121427_prompt_chain_studio.sql` to the original Humor Lab database after its Week 7 migrations. It creates four RLS-protected tables, private role-checked RPC implementations with public invoker wrappers, and the private `prompt-studio` bucket. It reuses the existing Google superadmin helper and enabled Google model inventory.

Add exact production and commit-deployment `/auth/callback` URLs to Supabase Auth URL Configuration. Keep the existing public app Site URL and redirects. Local port: `pnpm dev --port 3012`.

Deploy as a separate Vercel project. Disable Vercel Deployment Protection for grading; the application's own Google/superadmin wall remains mandatory. Existing owner and professor admin flags remain unchanged.

## Checks

`pnpm lint` and `pnpm build`.

`node scripts/test-engine.mjs` exercises real request construction with a mocked provider: previous-output handoff, source image, empty output, HTTP failure and timeout handling. `node scripts/check-access.mjs https://DEPLOYMENT_HOST` verifies anonymous protection.

Run `supabase/tests/studio_access.sql` as the database owner. Transactional fixtures verify chain/step CRUD, reordering, stale-save rejection, sequential execution, duplicate prevention, previous-output handoff, preserved history and member/anonymous denial. All fixture and temporary role changes roll back.

The runner uses one request per step (25-second provider timeout, 60-second route limit). A run interrupted while a step is executing is marked failed when resumed after 90 seconds, rather than silently generating twice. Limits: 20 runs per admin per hour and two recent unfinished runs. Only enabled Google models are supported. Instructions are plain text; outputs are displayed as text, never executed as HTML.
