# MAKI's PickleBall Court

Full-stack website + MongoDB database implementing the account & dashboard
features below.

| ID | Feature | Where it lives |
|---|---|---|
| UF-101 | User Registration | `POST /api/auth/register` · `frontend/register.html` |
| UF-102 | User Login | `POST /api/auth/login` · `frontend/index.html` |
| UF-103 | Forgot Password | `POST /api/auth/forgot-password` · `frontend/forgot-password.html` |
| UF-104 | Password Reset | `PUT /api/auth/reset-password/:token` · `frontend/reset-password.html` |
| UF-105 | User Profile | `GET /api/users/profile` · `frontend/profile.html` |
| UF-106 | Edit Profile | `PUT /api/users/profile` · `frontend/profile.html` |
| UF-107 | Change Password | `PUT /api/users/change-password` · `frontend/profile.html` |
| UF-108 | Dashboard | `GET /api/dashboard` · `frontend/dashboard.html` |
| UF-109 | View Pickleball Courts | `GET /api/courts` · `frontend/courts.html` |
| UF-110 | Court Information | `GET /api/courts/:id` · `frontend/court-details.html` |
| UF-111 | View Court Availability | `GET /api/courts/:id/availability?date=` |
| UF-112 | Search Courts | `GET /api/courts?q=` · search box on `courts.html` |
| UF-113 | Filter Courts | `GET /api/courts?status=&facility=` · filters on `courts.html` |
| UF-114 | View Schedule | `court-details.html` schedule grid |
| UF-115 | Select Date and Time | date picker + slot buttons on `court-details.html` |
| UF-116 | Court Booking | `POST /api/bookings` |
| UF-117 | Booking Details | `GET /api/bookings/:id` |
| UF-118 | Booking Summary | summary card on `court-details.html` before confirming |
| UF-119 | Booking Confirmation | `frontend/booking-confirmation.html` |
| UF-120 | Booking Reference Number | auto-generated per booking (e.g. `MKI-...`) |
| UF-121 | Payment Status | `paymentStatus` field (pending/paid/failed/refunded) |
| UF-122 | Payment Receipt | `booking-confirmation.html` shows a printable receipt only once the booking is approved and paid; before that it shows booking details and payment status |
| UF-123 | My Bookings | `GET /api/bookings` · `frontend/my-bookings.html` |
| UF-124 | Booking History | Allows users to view their previous completed, cancelled, or expired bookings. |
| UF-125 | Booking Cancellation | Allows users to cancel an existing reservation according to the system's cancellation policy. |
| UF-126 | Booking Rescheduling | Allows users to change their booking date or time if another slot is available. |
| UF-127 | Booking Status | `GET /api/bookings/reference/:referenceNumber` · `frontend/booking-status.html`; status filters are also available on `my-bookings.html`. |
| UF-128 | Booking Notifications | Sends notifications regarding booking confirmations, cancellations, payments, and schedule changes. When a customer cancels, every staff/admin account also gets an alert (admin Dashboard → Alerts). |
| UF-129 | Booking Reminders | `backend/utils/reminders.js` sends an in-app notification (and an email when SMTP is set up) 2 hours before each confirmed booking. |
| UF-130 | Announcements | `GET /api/announcements` · `frontend/announcements.html` (in the nav bar); latest 3 also on the dashboard |
| UF-131 | Promotions/Discounts | Displays available promotions, discounts, or special booking offers. |
| UF-132 | Contact/Support | Allows users to contact the facility or administrator regarding concerns, questions, or booking issues. |
| UF-133 | Feedback and Rating | Allows users to provide feedback or ratings about their booking experience and court facilities. |
| UF-134 | Report a Problem | Allows users to report issues involving a court, booking, payment, or system functionality. |
| UF-135 | Terms and Policies | Allows users to view the facility's booking rules, cancellation policy, payment policy, and terms of service. |
| UF-136 | Check-in | `POST /api/bookings/:id/checkin` · same-day check-in on `frontend/my-bookings.html` |
| UF-137 | Booking Verification | `GET /api/bookings/reference/:referenceNumber` · `frontend/booking-status.html` |
| UF-138 | Logout | `frontend/js/api.js` clears the customer session token on logout |

## Branding and look

The colors come from the logo: navy `#0a325e`, cyan `#33d9ff`, pickleball yellow `#f9e20b`.
- Logo files are in `frontend/img/` (`logo.png`, `logo-mark.png`, `favicon.png`, `favicon-32.png`).
  To use a sharper logo later, replace those files and keep the names. The logo's navy background
  matches the sidebar and header color exactly, so it sits on them without a visible box.
- Colors live at the top of `frontend/css/style.css` (customer site) and `frontend/css/admin.css` (admin).
- Motion: sections fade in, dialogs and toasts ease in and out, dashboard numbers count up and bars rise,
  buttons and cards respond to hover and press, and loading shows shimmer placeholders. Everything switches
  off automatically for people who have "reduce motion" turned on in their device settings.
- Friendly extras: show/hide password, current-page highlight, press `/` in the admin to jump to search.

## Admin features

Sign in at **http://localhost:5000/admin-login.html** (staff and admin accounts only).
The whole admin console is one page: `frontend/admin.html` (+ `frontend/js/admin.js`,
`frontend/css/admin.css`). Every screen reads and writes MongoDB through `/api/admin/*`.

| ID | Feature | Where it lives |
|---|---|---|
| AF-101 | Admin Login | `POST /api/auth/admin-login` · `admin-login.html` |
| AF-102 | Admin Dashboard | `GET /api/admin/dashboard` · Dashboard |
| AF-103 | Profile Management | `PUT /api/users/profile` · My account |
| AF-104 | Change Password | `PUT /api/users/change-password` · My account |
| AF-105 | User Management | `/api/admin/users?type=customers` · Customers |
| AF-106 | Staff Management | `/api/admin/users?type=staff` · Staff |
| AF-107 | Role and Access Management | `/api/admin/roles`, `PATCH /api/admin/users/:id/role` · Roles & access |
| AF-108 | Court Management | `POST/DELETE /api/admin/courts` · Courts |
| AF-109 | Court Information Management | `PUT /api/admin/courts/:id` · Courts → Edit |
| AF-110 | Court Status Management | `PATCH /api/admin/courts/:id/status` · Courts |
| AF-111 | Court Pricing Management | `PATCH /api/admin/courts/:id/price` · Courts → Price |
| AF-112 | Operating Hours Management | `/api/admin/settings` · Hours & rules |
| AF-113 | Time Slot Management | slot length per court (Courts → Edit) + blocked slots (Schedule) |
| AF-114 | Schedule Management | `/api/admin/schedule`, `/api/admin/blocks` · Schedule |
| AF-115 | Booking Management | `GET /api/admin/bookings` · Bookings |
| AF-116 | Booking Approval | Every booking starts as Pending until staff approve it: Bookings → Waiting for approval → Approve / Reject |
| AF-117 | Booking Cancellation | Bookings → Cancel (reason required, customer is notified) |
| AF-118 | Booking Rescheduling | Bookings → Reschedule (date, time, court; conflicts refused) |
| AF-119 | Booking Status Management | `PATCH /api/admin/bookings/:id/status` |
| AF-120 | Payment Management | Payments (mark paid / failed / refunded) |

### The admin menu
The left sidebar groups every admin function: **Dashboard**, **Bookings** (all, today's, waiting for approval,
cancelled), **Payments** (to collect, collected, refunds), **Schedule**, **Courts** (all courts, status, pricing,
opening hours, time slots), **People** (customers, staff, roles & access) and **My account**.
- The small `AF-xxx` codes beside each entry are the function IDs from your requirements table
  (hover an entry for its full name). To hide them, add `.nav-code { display: none; }` to `frontend/css/admin.css`.
- The search box at the top filters the menu by function name or keyword (try "refund", "price", "block",
  "approve"). Press **Enter** to open the first result, **Ctrl K** to jump to it, **Esc** to clear.
- Groups open and close, and the app remembers which ones you closed. On phones the menu sits behind a **Menu** button.
- To add or rename entries, edit the `NAV` list near the top of `frontend/js/admin.js`.

### Integrations (admin)
Each one is optional. It runs only when its keys are in `backend/.env` (see the comments in
`backend/.env.example` for where to get them) **and** it is switched on under admin -> **Integrations**
(sidebar), where admins can turn each one on or off without restarting the server.
Turning HitPay off stops new payment links, but payments already made on a link are still recorded.

**Customers use them too, but only admins can change them.** The same switches control the customer site:
Google sign-in / sign-up on `index.html` and `register.html` (`POST /api/auth/google`; a new email gets a customer
account), the invisible Turnstile check on customer login, sign-up and password reset, "Pay online now" on a booking
(`POST /api/bookings/:id/pay-online`, then `POST /api/bookings/:id/pay-online/check` when the customer comes back from
HitPay's checkout), the forecast for the chosen date on `court-details.html` (`GET /api/weather`),
the facility map on `support.html` (`GET /api/facility`) and "Add to Google Calendar" on confirmed bookings.
Map, calendar and human check for customers in detail:
- **Map**: a "Find us" card with directions on Courts, each court page, the dashboard, the booking page and Support
  (shown once the facility is pinned under Opening hours).
- **Calendar**: a Calendar view on My Bookings (month grid; click a booking for its details), and "Add to
  calendar" on every confirmed booking: Google Calendar, or a `.ics` file for Apple Calendar / Outlook with a
  2-hour reminder (dashboard, My Bookings, booking page).
- **Human check (Turnstile)**: login, sign-up, password reset, making a booking, sending a support report and
  leaving feedback. The server checks it too, so it can't be skipped.

Customer pages only read on/off flags (`GET /api/integrations/config`); the switches themselves
(`PUT /api/admin/integrations`) need an admin console session, the admin-only `settings` permission **and** the
two-step check below, so customers (401) and staff (403) cannot change them.

#### Turning an integration on or off: security PIN + one-time code
Every on/off change takes two checks, so a stolen session or an unlocked computer is not enough to switch off
payments or the human check:
1. **Security PIN** (4 to 6 digits, stored hashed like a password). The first time an admin flips a switch they
   create it, which needs their account password. They can change it, or reset a forgotten one, under **My account**
   (also with the password).
2. **One-time code**: a 6-digit code sent to the admin's email (and mobile, when SMS is set up). It confirms only
   the change it was sent for, works once and expires in 10 minutes. "Send a new code" unlocks after 30 seconds.

After the change **every admin gets a security alert**: on the dashboard, and by email when email is set up
(the backend terminal then prints `Integration change alert emailed to 4 of 4 admin(s): ...`; a failed email is
tried once more, and the reason is printed if it still fails). Each step shows in Audit logs; the PIN and code never do.
Limits: 5 wrong PINs (or wrong passwords on the PIN form) lock the PIN for 15 minutes, 5 wrong codes cancel
the code, and an admin can ask for at most 5 codes per 15 minutes.

Codes and alerts go out whenever email/SMS keys are set, even if those switches are off, so turning Email off
can't lock the admins out. **No email set up yet?** In development the code is printed in the server console
(the terminal running the backend). With `NODE_ENV=production` codes are never printed, so set up email before
going live or the switches can't be changed.

API: `POST /api/admin/integrations/verify` `{ switches, pin }` sends the code and returns a `challengeId`;
`PUT /api/admin/integrations` `{ challengeId, otp }` applies the change; `POST /api/admin/integrations/verify/resend`
`{ challengeId }`; `PUT /api/admin/security/pin` `{ password, pin }`.
Code: `backend/utils/twoStep.js`, `backend/models/SecurityCode.js`, `backend/routes/securityRoutes.js`.

| Service | What it does in admin | Keys |
|---|---|---|
| Google Sign-In | "Sign in with Google" on `admin-login.html`, for existing staff/admin accounts whose email matches. It never creates accounts. | `GOOGLE_CLIENT_ID` |
| Google Calendar | Confirmed bookings appear on the facility calendar and are updated or removed when moved, cancelled or rejected. "Sync upcoming bookings" button for existing ones. | `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` |
| Cloudflare Turnstile | Human check on the admin sign-in form | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Leaflet + OpenStreetMap | Map to pin the facility location (Opening hours) | none |
| HitPay | "Send payment link" in a booking (GCash, QR Ph, cards, GrabPay, ShopeePay: whatever your HitPay account has on). The customer gets a **Pay online now** button, pays on HitPay's checkout and comes back to the booking. It is marked paid by the webhook, when the customer comes back, or when staff press "Check payment"; each time the server asks HitPay for the real status. | `HITPAY_API_KEY`, `HITPAY_SANDBOX` (`true` for sandbox keys, `false` for live), optional `HITPAY_WEBHOOK_SALT` |
| Open-Meteo | Weather forecast with rain chances on the admin dashboard | none (needs the facility location) |
| SMS (Semaphore) | Texts customers booking updates (received, approved, not approved, cancelled, moved, paid, refunded, expired) and the 2-hour reminder | `SEMAPHORE_API_KEY`, optional `SEMAPHORE_SENDER_NAME` |
| Email (Resend, or SMTP) | Same updates by email; the approval email carries a calendar file. Password resets always use it when set up | `RESEND_API_KEY` + `EMAIL_FROM`, or `EMAIL_HOST/PORT/USER/PASS` |
| QR check-in | Confirmed bookings show a signed QR code; staff press **Scan QR** under Check-ins (or type the reference) | none |

Code: `backend/utils/integrations/`, `backend/routes/integrationRoutes.js` (admin) and
`backend/routes/publicIntegrationRoutes.js` (login-page config and `POST /api/webhooks/hitpay`).

### Roles
`admin` can do everything. `staff` can use Dashboard, Bookings, Payments, Schedule,
view courts and change court status. Customers (`user`) cannot use the admin API at all.
The matrix lives in `backend/config/permissions.js` and is shown on the Roles & access screen.

## Tech stack
- **Backend:** Node.js, Express
- **Database:** MongoDB (via Mongoose) — collections: `users`, `courts`, `bookings`, `blockedslots`, `settings`, `notifications`
- **Auth:** JWT (stored in `localStorage` on the frontend), bcrypt-hashed passwords
- **Frontend:** Plain HTML/CSS/JS (no build step needed), served by Express from `/public`
- **Email:** Nodemailer (for password-reset links)

## Project structure
```
makis-pickleball/
├── backend/
│   ├── server.js            # API server and frontend static-file host
│   ├── config/              # MongoDB connection and permissions
│   ├── models/              # MongoDB models
│   ├── middleware/          # JWT protection, role checks, audit
│   ├── routes/              # API routes
│   ├── utils/               # shared backend helpers
│   ├── scripts/             # database/admin utilities
│   └── package.json         # backend dependencies and commands
└── frontend/                # customer pages, admin pages, CSS, JS, images
    └── js/config.js         # API_URL: backend origin (empty = same origin)
```

## Setup

1. **Install backend dependencies**
   ```bash
   npm --prefix backend install
   ```

2. **Configure environment variables**
   Copy `backend/.env.example` to `backend/.env` and fill in your values
   (run this from the repository root):
   ```bash
   Copy-Item backend\.env.example backend\.env
   ```
   - `MONGO_URI` — a local MongoDB (`mongodb://localhost:27017/makis_pickleball`)
     or a free [MongoDB Atlas](https://www.mongodb.com/atlas) connection string.
   - `JWT_SECRET` — any long random string.
   - `CORS_ORIGINS` — optional comma-separated frontend origins for cross-origin deployments.
     Same-origin requests work without it; `CLIENT_URL` is accepted as a single-origin fallback.
   - `EMAIL_*` — SMTP credentials so "Forgot Password" can actually send an email, and admins get
     their one-time codes for Integrations by email (until then, codes are printed in the server console).
     For Gmail, use an [App Password](https://myaccount.google.com/apppasswords),
     not your normal login password.
   - `NODE_ENV=production` on the live server, so one-time codes are never printed in the console.

3. **Run MongoDB** (if running locally)
   ```bash
   mongod
   ```

4. **Start the server**
   ```bash
   npm --prefix backend start
   # or, for auto-restart during development:
   npm --prefix backend run dev
   ```

5. **Seed sample courts** (optional now: you can also add courts from the admin console)
   ```bash
   npm --prefix backend run seed:courts
   ```
   This **deletes and re-creates** all courts, so only run it on a fresh database.

6. **Create your first admin account**
   ```bash
   npm --prefix backend run create:admin -- you@example.com "AStrongPassword1" "First" "Last"
   ```
   If that email already has a customer account, it is promoted to admin instead
   (its password is not changed).

7. Open **http://localhost:5000/admin-login.html** and sign in. Customers use
   **http://localhost:5000** as before. Admins add staff under *Staff*.

### Hosting the frontend separately (optional)
By default the backend also serves `frontend/`, so everything runs on one port.
To host `frontend/` on its own (any static host, or e.g. `npx serve frontend -l 5500`):
1. Set `API_URL` in `frontend/js/config.js` to the backend's origin, e.g. `'http://localhost:5000'`.
2. Add the frontend's origin to `CORS_ORIGINS` in `backend/.env`, e.g. `CORS_ORIGINS=http://localhost:5500`.
3. Set `CLIENT_URL` in `backend/.env` to the frontend's URL so password-reset emails link to it.

### Upgrading an existing database
Booking statuses changed from `upcoming` to `confirmed` / `pending` etc. If you already
have bookings, run once in `mongosh`:
```js
use makis_pickleball
db.bookings.updateMany({ status: "upcoming" }, { $set: { status: "confirmed" } })
db.bookings.updateMany({}, [{ $set: { slotActive: { $in: ["$status", ["pending","confirmed","completed"]] } } }])
db.bookings.dropIndexes()   // the server rebuilds the correct unique index on next start
```
Or, if the data is only for testing: `db.bookings.drop()`.

Security PINs need no migration: the first time each admin flips an integration switch, they are asked to create one.

## Notes / next steps
- Booking is now live end-to-end: pick a slot on `court-details.html` →
  booking summary → `POST /api/bookings` → confirmation page with a
  generated reference number and printable receipt.
- There's no real payment gateway wired in — every booking starts with
  `paymentStatus: "pending"`. That's intentional: it matches the
  AF-120 "Payment Management" feature, where staff
  confirm payment received (e.g. cash at the facility) and flip
  the status to "paid". Add a real gateway later if online payment is needed.
- Customers now get in-app notifications when a booking is received, confirmed,
  rejected, cancelled, moved, or when a payment is recorded or refunded.
- Double-booking is stopped by a unique index (`unique_active_slot`) on
  court + date + start time. If the server prints a **WARNING** about that index at
  startup, fix it before going live (see the message for the `mongosh` command).
- Dates are stored as midnight **Philippine time** (UTC+8) so bookings land on the
  right day whatever timezone the server runs in.
- Passwords are hashed with bcrypt and never returned by the API.
- Reset tokens are hashed before being stored and expire after 30 minutes.
- Court availability is computed on the fly from each court's `openTime`/
  `closeTime`/`slotDurationMinutes` minus any non-cancelled bookings for that
  date — there's no separate "slots" collection to keep in sync.
