# Personal Finance Tracker

A single-file static web app. Data is stored in your browser's `localStorage`
(no backend, no accounts).

## Deploy to Netlify via GitHub

1. Push this repo to GitHub (private recommended).
2. Netlify -> Add new site -> Import an existing project -> GitHub -> pick this repo.
3. Build command: empty. Publish directory: `.` (already set in `netlify.toml`).
4. Deploy. Every push to `main` redeploys automatically.

## Notes

- Data is per-browser and per-device. Clearing site data erases it.
- Libraries load from CDNs (Tailwind, Chart.js, Font Awesome, Google Fonts).
