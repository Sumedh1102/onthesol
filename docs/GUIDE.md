# SmashPoint (On The Sol Sports Academy) — Complete Working Guide

A step-by-step walkthrough of the project: what it is, how to run it, how a customer books a court, how the admin runs the facility, how payments work, and how to deploy it. Every screenshot was captured from this project running locally (demo data, Razorpay **test stand-in**, no real money).

---

## Contents

1. [What the project is](#1-what-the-project-is)
2. [Tech stack and project layout](#2-tech-stack-and-project-layout)
3. [Run it locally (step by step)](#3-run-it-locally-step-by-step)
4. [The public website tour](#4-the-public-website-tour)
5. [Booking a court — the full customer flow](#5-booking-a-court--the-full-customer-flow)
6. [Admin dashboard walkthrough](#6-admin-dashboard-walkthrough)
7. [How it works inside](#7-how-it-works-inside)
8. [Razorpay payments setup](#8-razorpay-payments-setup)
9. [Testing](#9-testing)
10. [Deploying to production](#10-deploying-to-production)
11. [Daily operations and troubleshooting](#11-daily-operations-and-troubleshooting)

---

## 1. What the project is

A court-booking website for a multi-sport academy (badminton, pickleball, basketball).

- **Customers** pick a sport, court, date, duration (1 or 2 hours) and time slot, pay online with Razorpay, and get a confirmation page. No account needed.
- **Admin** (one login, no public sign-up) sees bookings, blocks courts for maintenance, edits prices and booking hours, cancels/refunds, and views payments.
- **Money** is stored as integer paise; dates are `YYYY-MM-DD` in Asia/Kolkata.

---

## 2. Tech stack and project layout

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (black/white theme, neon `#B7FF00` accent) |
| Database | PostgreSQL 14+ (needs `btree_gist`) via Drizzle ORM + `pg` |
| Payments | Razorpay (orders, Checkout, webhooks, refunds) |
| Email | Optional, via Resend |
| Tests | Vitest (unit + integration), Playwright (E2E) |

```
src/
  app/(site)/        public pages: home, booking/[code], policies
  app/admin/         login + panel (overview, bookings, courts, payments, account)
  app/api/           availability, bookings, payments, cron, health
  components/        home sections, BookingWizard, forms
  lib/               pure shared logic: booking rules/engine, pricing, formatting
  server/            server-only: db, auth, services, payments, queries, actions
  content/           site.ts (facility copy) and sports.ts (sport copy)
drizzle/             SQL migrations (incl. hand-written constraints/triggers)
scripts/             deploy, migrate, seed, admin CLI, catalogue (courts + prices)
tests/               integration + Playwright E2E + fake Razorpay
docs/                DEPLOYMENT.md, this guide, screenshots
```

---

## 3. Run it locally (step by step)

**Prerequisites:** Node.js ≥ 20.9, npm, and PostgreSQL (Docker is easiest).

### Step 1 — Install dependencies

```bash
npm ci
```

### Step 2 — Start PostgreSQL

With Docker:

```bash
docker compose up -d
```

This creates the `smashpoint` database (user/password `smashpoint`) on port 5432. Without Docker, install Postgres yourself, create a database and make sure the `btree_gist` extension is available.

### Step 3 — Create your `.env`

```bash
cp .env.example .env
```

Edit the key values:

| Variable | What to put |
| --- | --- |
| `DATABASE_URL` | `postgres://smashpoint:smashpoint@localhost:5432/smashpoint` (default) |
| `AUTH_SECRET` | A random string of 32+ characters (`openssl rand -base64 32`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Your first admin (password ≥ 12 characters) |
| `SEED_DEMO_DATA` | `true` to load the 5 demo courts and a demo admin (optional) |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` | Test keys (`rzp_test_…`). Leave blank and the site runs but online booking is switched off |
| `CRON_SECRET` | `openssl rand -hex 24` (protects the scheduled-jobs endpoint) |

### Step 4 — Create the schema and starter data

```bash
npm run db:deploy
```

Expected output:

```
⏳ Applying migrations…
✅ Database schema is up to date
🌱 Loading the demo facility (5 courts, demo admin; no bookings)…
✅ Demo ready. Admin: admin@example.com / onthesol@123
```

On a real (non-demo) database this applies migrations, creates the five courts with the rate card, and creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

### Step 5 — Start the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. The admin is at <http://localhost:3000/admin/login>.

![Home page hero](guide-images/01-home-hero.png)

> **Checks before pushing code:** `npm run typecheck && npm test && npm run build`.

---

## 4. The public website tour

The home page (`/`) is one long page; the top navigation jumps between sections. Availability is read live from the database on every request.

### 4.1 Hero
Full-height hero with the three sports and a **Book a Court** button (top right) that jumps to the booking flow.

### 4.2 Sports
One row per sport. Each has a **Book … now** button that pre-selects that sport in the booking flow (`/?sport=pickleball#book`).

![Sports section](guide-images/02-sports.png)

### 4.3 Courts
Five court cards (Badminton 1 & 2, Pickleball 1 & 2, Basketball 1) with surface, live availability and price. A card's **Book** button pre-selects that court.

![Courts section](guide-images/03-courts.png)

### 4.4 Court rental rates
The full rate card read from the database: 1 hour, 2 hours (a package price, not double) and monthly plans of 1/3/6/12 months (valid Monday–Saturday). There is no peak-hour surcharge.

![Rate card](guide-images/04-rate-card.png)

### 4.5 About and contact
About the academy (including the `#coaching` strip) and contact details. Name, phone numbers and the email placeholder come from `src/content/site.ts`.

![About](guide-images/05-about.png)
![Contact](guide-images/09-contact.png)

### 4.6 Policies
Privacy, Terms, and **Cancellation & refund policy** pages are linked from the footer.

![Policy page](guide-images/14-policy.png)

### 4.7 On a phone
The layout is fully responsive; the rate table becomes cards.

<p>
<img src="guide-images/23-mobile-home.png" width="260" alt="Mobile home">
<img src="guide-images/24-mobile-booking.png" width="260" alt="Mobile booking">
</p>

---

## 5. Booking a court — the full customer flow

### Step 1 — Choose sport and court
Open `/#book` (or click any **Book** button). Sport and court are chosen first; pre-selection from links works too.

![Booking wizard start](guide-images/06-wizard-start.png)

### Step 2 — Pick a date and duration
Pick a date within the advance-booking window (default set in admin) and **1 hour** or **2 hours**. Prices on the buttons come from the court's rate card, and the 2-hour button shows the saving.

![Date and duration](guide-images/07-wizard-date-duration.png)

### Step 3 — Pick a time slot
Slots are grouped Morning / Afternoon / Evening with a "free" count. Booked, held, blocked and past slots are disabled with a reason. The selected slot turns neon, and the **Booking summary** panel shows sport, court, date, time, duration and total. Click **Continue**.

![Slot and summary](guide-images/08-wizard-slot-summary.png)

### Step 4 — Enter your details
Full name, email address and mobile number.

![Details](guide-images/10-wizard-details.png)

### Step 5 — Review
Check everything once more, then **Pay ₹… securely**. At this moment the server validates the request, **holds the slot for 10 minutes** (as a PENDING booking, under a court row lock) and creates the Razorpay order. The amount is always computed on the server.

![Review](guide-images/11-wizard-review.png)

### Step 6 — Pay with Razorpay Checkout
Razorpay Checkout opens. (The screenshot is the test stand-in used by the automated tests; with real test keys you see Razorpay's own UI and can use their test cards/UPI.)

![Checkout](guide-images/12-checkout.png)

### Step 7 — Confirmation
After payment the browser posts the result to `/api/payments/verify`. The server checks the signature **and** fetches the payment from Razorpay (order, amount, currency, status) before confirming. The customer lands on a private link `/booking/SP-XXXXXX?t=<signature>` with the booking reference, an **Add to calendar** file and a print view.

![Confirmation](guide-images/13-confirmation.png)

If the customer closes the page before paying, the hold simply expires after 10 minutes and the slot is released.

---

## 6. Admin dashboard walkthrough

### Step 1 — Sign in
Go to `/admin/login`. Demo credentials after seeding: `admin@example.com` / `onthesol@123`. Sign-in is rate-limited (6 attempts per account / 20 per IP per 15 minutes).

![Admin login](guide-images/15-admin-login.png)

### Step 2 — Overview
Live numbers: today's bookings, upcoming, confirmed (30 days), pending payments (slots currently held), cancellations, and amount collected. The **Today on court** grid shows every court by hour (confirmed / payment hold / blocked / free), and **Latest bookings** lists recent activity.

![Overview](guide-images/16-admin-overview.png)

### Step 3 — Bookings
Search and filter all bookings.

![Bookings list](guide-images/17-admin-bookings.png)

Open one for the full detail: customer, slot, payment status, and the actions **Cancel** or **Cancel and refund** (refund is sent through Razorpay).

![Booking detail](admin-guide-images/a04-booking-detail.png)

### Step 4 — Courts
Each court's status and rate card at a glance.

![Courts](guide-images/19-admin-courts.png)

Open a court to edit its status, surface, 1 h / 2 h prices and monthly plans, to **block** time for maintenance or events (never over an existing booking), and to set the online **booking hours** (default 7 AM–10 PM).

![Edit court](guide-images/20-admin-court-edit.png)

### Step 5 — Payments
Every Razorpay payment with its status (captured, failed, refunded).

![Payments](guide-images/21-admin-payments.png)

### Step 6 — Account
Change your password (signs out other sessions).

![Account](guide-images/22-admin-account.png)

### Admin CLI

```bash
npm run admin -- create <email> "<name>"   # create an administrator
npm run admin -- password <email>          # set a new password (signs out their sessions)
npm run admin -- deactivate <email>        # block sign-in
npm run admin -- list
```

---

## 7. How it works inside

### Booking status flow

```
PENDING → PAYMENT_INITIATED → PAID → CONFIRMED
                  └──────→ CANCELLED / REFUNDED / EXPIRED
```

### Request sequence

1. `GET /api/availability` — slot list for a court/date/duration.
2. `POST /api/bookings` — validates, holds the slot (`createBookingHold`), creates the Razorpay order, returns Checkout parameters.
3. Razorpay Checkout collects payment in the browser.
4. `POST /api/payments/verify` — signature check + server-side fetch from Razorpay.
5. `recordCapture` (`src/server/payments/service.ts`) — **the only place a booking becomes PAID → CONFIRMED**. It is idempotent.
6. Backups if the browser never calls back: the Razorpay **webhook** (`/api/payments/webhook/razorpay`) and the **reconciliation job** confirm the payment. Late or duplicate payments are refunded automatically.

### Double-booking is impossible, on two levels
- A court **row lock** inside `createBookingHold`.
- A PostgreSQL `EXCLUDE` constraint `bookings_no_overlap` (`drizzle/0001_booking_constraints.sql`).

Booking rules (1–2 hours on the hour, inside booking hours) live in `src/lib/booking/rules.ts` **and** in a database trigger — change both together.

### Pricing
`priceForDuration` in `src/lib/booking/engine.ts` is the only price calculation. Prices live on the `courts` table (`price_1h`, `price_2h`, `monthly_price_*`), edited in `/admin/courts`.

### Scheduled jobs
`/api/cron/reminders` (needs `Authorization: Bearer $CRON_SECRET`) expires holds, reconciles payments, sends reminders and cleans up. It's called daily by Vercel Cron and every 30 minutes by the GitHub Actions workflow `scheduler.yml`. Slot correctness doesn't depend on it.

### Security
- Admin session: signed cookie `sp_session` + a database `sessions` row (revocable); `src/proxy.ts` only does an optimistic check, `getSession()` is authoritative.
- Public POST routes check same-origin and are rate-limited.
- Customer links are HMAC-signed with `AUTH_SECRET`.
- In production the server refuses to boot with a short/placeholder `AUTH_SECRET` or malformed Razorpay keys.

---

## 8. Razorpay payments setup

1. Create a Razorpay account and switch the dashboard to **Test mode**.
2. **Account & Settings → API Keys** → generate keys. Put `RAZORPAY_KEY_ID` (`rzp_test_…`) and `RAZORPAY_KEY_SECRET` in `.env`.
3. **Webhooks** → add `https://<your-site>/api/payments/webhook/razorpay` with a secret (→ `RAZORPAY_WEBHOOK_SECRET`) and these events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
4. For local webhook testing, expose your dev server with a tunnel (e.g. ngrok) and use that URL.
5. Use Razorpay's test cards/UPI to make a payment; check it under **Admin → Payments**.
6. Going live: replace with `rzp_live_…` keys and the live webhook. Never expose the key secret to the browser.

---

## 9. Testing

```bash
npm run typecheck          # TypeScript (runs next typegen first)
npm test                   # unit tests (pure logic, Vitest)

# Integration tests (drop + re-migrate their database; name must contain "test")
TEST_DATABASE_URL=postgres://smashpoint:smashpoint@localhost:5432/smashpoint_test npm run test:integration

# End-to-end browser tests (starts next dev on :3100 with a fake Razorpay)
E2E_DATABASE_URL=postgres://smashpoint:smashpoint@localhost:5432/smashpoint_e2e_test npx playwright test
```

Single test file: `npx vitest run src/lib/booking/engine.test.ts`. CI (`.github/workflows/ci.yml`) runs all of these.

---

## 10. Deploying to production

Full detail is in [`DEPLOYMENT.md`](DEPLOYMENT.md). Summary:

### Option A — Vercel + Neon (recommended)
1. Create a Neon Postgres database; copy the **pooled** connection string.
2. Import the repo into Vercel.
3. Set environment variables: `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL`, Razorpay keys, `CRON_SECRET` (and optionally `RESEND_API_KEY`, `EMAIL_FROM`).
4. Deploy. The build runs `vercel-build` = `db:deploy && next build`: migrations and first-run setup happen automatically.
5. Add the Razorpay webhook pointing at your production URL.
6. In GitHub repo secrets set `APP_URL` and `CRON_SECRET` so `.github/workflows/scheduler.yml` calls the jobs endpoint every 30 minutes.

### Option B — Docker (Railway, Render, Fly.io, Cloud Run, VPS)
```bash
docker build -t smashpoint .
docker run -p 3000:3000 --env-file .env smashpoint
```
The image runs a bundled `deploy.cjs` (migrations + setup) before starting `server.js`.

### After the first deploy
1. Open `/admin/login` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Check **Courts** — prices and booking hours.
3. Replace placeholders in `src/content/site.ts` (email, address, opening hours).
4. Make a test booking with Razorpay test keys, then refund it from the admin.
5. Hit `/api/health` — it should return `{"ok":true,"db":"up"}`.

---

## 11. Daily operations and troubleshooting

| Task | How |
| --- | --- |
| Change a price | Admin → Courts → court → edit rate card |
| Close a court for maintenance | Admin → Courts → court → add block |
| Cancel a booking | Admin → Bookings → booking → Cancel (or Cancel and refund) |
| Add another admin | `npm run admin -- create <email> "<name>"` |
| Forgot admin password | `npm run admin -- password <email>` |
| Locked out by sign-in rate limit | Clear the `rate_limits` table |
| Reset a dev database | `npm run db:reset` (refuses when `NODE_ENV=production`) |

| Symptom | Likely cause |
| --- | --- |
| Whole deployment returns 500 | `AUTH_SECRET` too short/placeholder or malformed Razorpay keys (`src/lib/env-check.ts`) — check the logs at startup |
| "Online booking is switched off" | Razorpay keys missing |
| Build fails: `DATABASE_URL` missing | Set any `postgres://` URL — build never connects |
| Slot stays "held" | Hold expires after 10 min by itself; the cron job also releases it |
| Paid but booking not confirmed | Check webhook configuration; the reconciliation job confirms it within 30 minutes |
| `btree_gist` error on migrate | Use a Postgres host that allows the extension (Neon, Supabase, RDS, Render do) |
