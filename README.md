# Personal Finance Tracker

Single-page finance tracker with **login, admin user management, one-time
registration codes**, and per-user data stored in **Netlify Blobs** (no external
database needed).

## Structure

- `index.html` – the app (login screen, admin panel, tracker)
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
- Data previously stored in the browser (`localStorage`) can be imported into
  an account on first login.

## Local development

```
npm install
npx netlify dev
```
