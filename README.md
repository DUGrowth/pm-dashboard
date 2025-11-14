PM Dashboard (dugrowth/pm-dashboard)

- `index.html` is a standalone dashboard powered by React (via Babel in the browser) and Tailwind CDN.
- `public/js/components/Badge.jsx` and `public/js/components/NotificationBell.jsx` extract shared UI from the page. The page aliases them and falls back to inline implementations if needed.
- `public/js/components/copyCheckSection.jsx` extracts the Copy Checker UI out of the HTML. The page aliases it as `CopyCheckSection` and falls back to the inline implementation if needed.
- Cloudflare Pages Functions live under `functions/api/*`:
  - `copy-check.ts` → copy optimization endpoint (LLM-backed with strong post-validation)
- `entries.ts` → CRUD for scheduled content entries (D1-backed). `DELETE /api/entries?id=...&hard=1` performs a permanent removal; omit `hard` for soft-delete (`deletedAt` timestamp).
  - `ideas.ts` → CRUD for ideas (D1-backed)
  - `linkedin.ts` → CRUD for LinkedIn submissions (D1-backed)
  - `testing-frameworks.ts` → CRUD for testing frameworks (D1-backed)
  - `guidelines.ts` → read/update content guidelines (D1-backed with defaults)
  - `audit.ts` → fetch audit logs (D1-backed) and accept POST to record events
  - `health.ts` → basic health check
  - `notify.ts` → server-side proxy for notifications (Teams webhook; optional email via Brevo/MailChannels)
  - `auth.ts` → password login, invite acceptance, and session management (sets secure cookies)
  - `password.ts` → authenticated users can rotate their password and refresh their session
  - `users.ts` → admin-only user roster + invitation emails
  - `user.ts` → returns the currently authenticated user (backed by the session cookie)
- `public/js/copyCheckerClient.js` exposes a tiny client you can import as a module.
- `tools/test-copy-check.mjs` runs a basic smoke test against the copy-check endpoint.

Environment
- Required for `copy-check`:
  - `OPENAI_API_KEY`
- Optional for `copy-check`:
  - `OPENAI_MODEL` (default `gpt-4o-mini`)
  - `OPENAI_API_BASE` (default `https://api.openai.com/v1`)
- D1 database (for entries/ideas/guidelines/audit): ensure `env.DB` is bound in your Pages/Workers config.
  - Also used for LinkedIn submissions and testing frameworks.
- Access control & invitations:
  - The dashboard now relies on worker-managed sessions (secure HttpOnly cookie set by `/api/auth`). Users sign in with email + password, and admins can send invitations from the Admin tools UI.
  - Invites expire after `INVITE_TTL_HOURS` (default 168); logins keep a session alive for `SESSION_TTL_SECONDS` (default 7 days).
  - `ADMIN_EMAILS` can seed a comma-separated list of addresses that should be treated as administrators.
  - Cloudflare Access headers are still honoured as an optional fallback (`ACCESS_ALLOWED_EMAILS`) while you transition, but they are no longer required.
  - For local development without SSO, set `ALLOW_UNAUTHENTICATED=1` and optionally `DEV_AUTH_EMAIL` / `DEV_AUTH_NAME` for the synthetic user.
  - The Teams webhook proxy restricts outbound requests to `*.office.com` / `*.office365.com` hosts by default; extend/override the allow list with `TEAMS_WEBHOOK_ALLOW_LIST` if needed.
- Notifications:
  - **Brevo (primary):** set `BREVO_API_KEY` (or `BREVO_API_TOKEN`), `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME`. Authenticate your domain inside Brevo (SPF + DKIM) or use a Brevo-managed sender.
  - **MailChannels fallback:** optionally set `MAIL_FROM` / `MAIL_FROM_NAME` (must have `include:mailchannels.net` in the domain’s SPF). If Brevo isn’t available, the worker automatically posts through MailChannels.
  - `MAIL_TO` provides optional default recipients (comma-separated).
  - `APPROVER_DIRECTORY` is a JSON object mapping display names to email addresses (e.g., `{"Dan Davis":"dan@example.org"}`). Requests can pass approver names (`approvers`) and/or explicit `to` values (names or emails); the worker resolves them using this directory (plus `MAIL_TO`) before sending.

Authentication & user management
- The `/api/users` endpoint (surfaced via the “Admin tools → User roster” UI) stores users centrally in D1 and emails invitations that link to `?invite=...`. Invited teammates land on a password setup screen, and all logins go through `/api/auth` (POST = login, PUT = accept invite, DELETE = logout).
- Passwords are hashed with PBKDF2+SHA256; sessions are stored hashed in the `sessions` table and issued as secure, HttpOnly cookies. `SESSION_TTL_SECONDS` controls how long a cookie stays valid (default 7 days). `INVITE_TTL_HOURS` controls how long invite links remain active (default 168 hours / 7 days).
- Configure `MAIL_FROM` / `MAIL_FROM_NAME` (and optionally Brevo credentials) so the worker can send the invitation emails directly. `ADMIN_EMAILS` seeds which accounts should have full admin rights after they accept their invite.
- Cloudflare Access headers are still understood, so you can keep Zero Trust enabled while migrating. Once confident in the new flow, remove the Access policy so teammates can use the built-in password login from any device.
- To bootstrap your first admin account, temporarily set `ALLOW_UNAUTHENTICATED=1` (or insert a row directly into `users`) and create an invite for an address listed in `ADMIN_EMAILS`. After accepting the invite, remove the dev override.
- The worker always ensures a pending owner account (`daniel.davis@populationmatters.org`) exists with admin rights. When that record is missing a password, the worker seeds an invite token (logged to the worker console) so Daniel can activate the account through the invite screen.
- Signed-in teammates can update their password from the Menu → “Change password” action, which calls `/api/password`, rotates their session cookie, and invalidates older sessions.

Local Development
1) Serve `index.html` with any static server (or Cloudflare Pages dev).
2) Run your Cloudflare Pages/Workers dev environment so that `/functions/api/*` are routed. Examples:
   - `wrangler pages dev .` (Pages dev)
   - or Workers: `wrangler dev` with routes mapped appropriately.
   - `wrangler.toml` is included with a placeholder D1 binding; fill in your D1 `database_id`.
3) Test the copy-check endpoint:
   - `node tools/test-copy-check.mjs`
   - Or override endpoint: `ENDPOINT=http://localhost:8788/api/copy-check node tools/test-copy-check.mjs`

Admin tools
- From the Menu, open “Admin tools” to view recent audit events. The view fetches from the server when connected, with a local fallback, and it now also lets you add/remove approvers and dashboard users (Francesca Harrison is listed by default).

D1 schema
- A minimal schema is provided in `schema.sql`.
- To apply it to your D1 database:
  - Fill `database_id` in `wrangler.toml`.
  - Execute: `wrangler d1 execute pm_dashboard --file=schema.sql` (replace with your DB name).
  - If you already have live data, be sure to `ALTER TABLE entries ADD COLUMN author TEXT;` and `ALTER TABLE entries ADD COLUMN approvalDeadline TEXT;` before deploying the latest worker so created/approved entries retain the requestor name and approval due dates.
  - The latest schema also creates `users` and `sessions` tables for authentication. If you’re upgrading an existing database, run those `CREATE TABLE` statements (at the bottom of `schema.sql`) so the new auth endpoints have persistent storage.

Quality Tooling (optional)
- This repo includes config for ESLint, Prettier, and TypeScript typechecking:
  - `package.json` with scripts: `lint`, `format`, `typecheck`, `test:copy-check`
  - `.eslintrc.cjs`, `.eslintignore`, `.prettierrc.json`, `tsconfig.json`
- To use them (requires network to install deps):
  - `npm i`
  - `npm run lint`
  - `npm run format`
  - `npm run typecheck`

Notes
- The copy-check function validates and normalizes LLM output and enforces hard constraints (character limits, URL preservation, banned/required phrases) even on fallback.
- Calendar entries now require a date, at least one platform, and an asset type (a “No asset” option is available). Choosing Video/Design/Carousel enforces the matching copy fields, and the workflow status automatically marks the work as “Approval required” when approvers are assigned or visual assets are pending.
- Content guidelines edited in the dashboard sync to the D1-backed `/api/guidelines` endpoint whenever the API client is reachable, with localStorage fallback for offline development.
- DB SQL statements are wrapped in string literals to avoid TypeScript parse issues.
