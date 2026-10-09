# Personal Finance Tracker

Single-page finance tracker with **login, admin user management, one-time
registration codes**, and per-user data stored in **Netlify Blobs** (no external
database needed).

## Structure

- `index.html` – public front page (landing page with live budget + debt demos)
- `app.html` – the app (login screen, admin panel, tracker). Landing buttons link to `/app.html` and `/app.html#register`
- `assets/` – logo files (mark + wordmark in dark and light versions, favicons)
- `netlify/functions/api.mjs` – API (auth, admin CRUD, codes, per-user data)
- `package.json` – dependency: `@netlify/blobs`
- `netlify.toml` – publish dir + functions dir

## Deploy (GitHub -> Netlify)

1. Push this repo to GitHub, import it in Netlify (build command empty, publish dir `.`).
2. In Netlify: **Site configuration -> Environment variables**, add:
   - `SESSION_SECRET` – long random string (32+ chars)
   - `ADMIN_PASSWORD` – password for the first admin account
   - `ADMIN_USERNAME` – optional, defaults to `admin`
3. Redeploy. Log in as the admin, open **Admin**, generate a registration code,
   and give it to the person who should sign up.

## How it works

- **Admin** (header -> Admin): create / edit (reset password, change role,
  disable) / delete users, and generate / delete registration codes.
- **Sign up**: needs a code. A code can be used **once**; after that it shows as used.
- Each user's finance data is saved on the server under their own account.
- The admin account is created automatically on the first admin login using
  `ADMIN_PASSWORD`. Changing that env var later does not change an existing
  admin password — use *Reset password* in the Admin panel instead.
- **Income sources**: income is a list (e.g. Salary, Sideline, Online Work), added
  and edited in *Income & Expense Manager*. The dashboard uses the total. Accounts that
  saved a single income number before are migrated automatically to one "Salary" source.
- **Theme**: a sun/moon button in the header switches light/dark. It only exists after
  login, is saved per account, and the login screen is always dark.
- **Viewing a user's profile (admin)**: *Admin -> Users -> eye icon*. The admin must
  re-enter their own password first; this grants 10 minutes of access (memory only,
  cleared on logout). The view is read-only and the user is not notified. After 5 wrong
  passwords the confirmation is locked for 15 minutes. Tune `ELEVATE_TTL_MS`,
  `ELEVATE_MAX_FAILS`, `ELEVATE_LOCK_MS` at the top of `api.mjs`.
- Data previously stored in the browser (`localStorage`) can be imported into
  an account on first login.

## Local development

```
npm install
npx netlify dev
```
