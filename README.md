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
| UF-121 | Payment Status | `paymentStatus` field (pending/paid/failed/refunded). Customers pay at the front desk; there is no online payment and no payment method to choose, and none is recorded |
| UF-122 | Payment Receipt | `booking-confirmation.html` shows a printable receipt only once the booking is approved and paid; before that it shows booking details and payment status |
| UF-123 | My Bookings | `GET /api/bookings` · `frontend/my-bookings.html` |
| UF-124 | Booking History | Allows users to view their previous completed, cancelled, or expired bookings. |
| UF-125 | Booking Cancellation | `PATCH /api/bookings/:id/cancel` · My Bookings → Cancel. Follows the cancellation policy (admin → Hours & rules): the dialog shows what comes back before the customer confirms (`GET /api/bookings/:id/cancel-check`). |
| UF-126 | Booking Rescheduling | Allows users to change their booking date or time if another slot is available. |
| UF-127 | Booking Status | `GET /api/bookings/reference/:referenceNumber` · `frontend/booking-status.html`; status filters are also available on `my-bookings.html`. |
| UF-128 | Booking Notifications | Sends notifications regarding booking confirmations, cancellations, payments, and schedule changes. Customers read them on their own **Notifications** page (`frontend/notifications.html`, opened from the bell in the top bar; not on the dashboard): All or Unread, mark one or all as read, grouped by day, "View booking" when a notification mentions one, and "Show older" for the history. When a customer cancels, every staff/admin account also gets an alert (admin Dashboard → Alerts). |
| UF-129 | Booking Reminders | `backend/utils/reminders.js` sends an in-app notification (and an email when SMTP is set up) 2 hours before each confirmed booking. |
| UF-130 | Announcements | `GET /api/announcements` · `frontend/announcements.html` (in the nav bar); latest 3 also on the dashboard |
| UF-131 | Promotions/Discounts | Displays available promotions, discounts, or special booking offers. |
| UF-132 | Contact/Support | Allows users to contact the facility or administrator regarding concerns, questions, or booking issues. |
| UF-133 | Feedback and Rating | Allows users to provide feedback or ratings about their booking experience and court facilities. |
| UF-134 | Report a Problem | Allows users to report issues involving a court, booking, payment, or system functionality. |
| UF-135 | Terms and Policies | Allows users to view the facility's booking rules, cancellation policy, payment policy, and terms of service. |
| UF-136 | Check-in | `POST /api/bookings/:id/checkin` · same-day check-in on `frontend/my-bookings.html` |
| UF-137 | Booking Verification | `GET /api/bookings/reference/:referenceNumber` · `frontend/booking-status.html` |
| UF-138 | Logout | `POST /api/auth/logout` ends the session on the server, then `frontend/js/api.js` clears the token. Profile → "Where you're signed in" signs out other devices. |
**The top bar (customer site)** is built by `frontend/js/nav.js` on every page, so links are changed in one place:
- Wide screens: **Home**, **Book a court**, **My bookings** and **More** (Announcements, Find us, Check a booking, Help & support),
  then the notifications bell (with the unread count; it opens the Notifications page) and the account menu (your name: My profile, Log out).
- Phones and small tablets (860 px and narrower): the logo, the bell and one **Menu** button that lists everything.
- The page you are on is marked (pages without their own link mark their section: a court's page marks Book a court). Menus close
  on Escape or a click outside, and work from the keyboard.

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
| AF-121 | Payment Verification | `/api/admin/payments/verification`, `POST /api/admin/bookings/:id/verify-payment` · Payments → Verification (customers no longer send a method and reference; this lists any sent before that change) |
| AF-122 | Refund Management | `/api/admin/refunds` · Payments → Refunds: what the cancellation policy says to give back, partial refunds, "refund anyway" |
| AF-123 | Transaction History | `/api/admin/transactions` · Payments → Transactions (search, type, dates, Export CSV) |
| AF-124 | Customer Booking History | `/api/admin/users/:id/bookings` · People → Customers → History |
| AF-125 | Notifications Management | `/api/admin/notifications` · Messaging → Notifications |
| AF-126 | Announcements Management | `/api/admin/announcements` · Messaging → Announcements |
| AF-127 | Promotions and Discounts | `/api/admin/promotions` · Messaging → Promotions |
| AF-128 | Feedback Management | `/api/admin/feedback` · Customer care → Feedback |
| AF-129 | Complaint/Issue Management | `/api/admin/issues` · Customer care → Issues |
| AF-130 | Check-in Management | `/api/admin/checkins` · Check-ins (QR scan or reference number) |
| AF-131 | Reports | `/api/admin/reports/:type` · Insights → Reports |
| AF-132 | Booking Analytics | `/api/admin/analytics/bookings` · Insights → Booking analytics |
| AF-133 | Revenue Analytics | `/api/admin/analytics/revenue` · Insights → Revenue analytics |
| AF-134 | User Analytics | `/api/admin/analytics/users` · Insights → User analytics |
| AF-135 | Audit Logs | `backend/middleware/audit.js` · Security → Audit logs (Export CSV) |
| AF-136 | System Settings | `/api/admin/settings` · Courts → Hours & rules: opening hours, booking rules and the cancellation policy; plus Location and Integrations |
| AF-137 | Cancellation Policy Management | Hours & rules → Cancellation and refunds (cut-off, full-refund window, late refund %) · `backend/utils/policy.js` |
| AF-138 | Backup and Restore | `/api/admin/backups*` · Data → Backup & restore (daily automatic backups; download, restore and delete need PIN + one-time code) |
| AF-139 | Data Management | `/api/admin/data` · Data → Data checks (find and fix records that disagree, clean up old records, record counts) |
| AF-140 | Security Management | Security → Login security (lockouts, rate limits), Active sessions, Audit logs, API tokens; admin security PIN |
| AF-141 | Session Management | `/api/admin/sessions` · Security → Active sessions (end one, or all of one person's) |
| AF-142 | Search and Filter | Search boxes and filters on bookings, payments, transactions, customers, staff, sign-ins, sessions and audit logs |
| AF-143 | Export Reports | `?format=csv` on reports, bookings, transactions and audit logs (Excel-ready CSV); Reports → Print / save PDF |
| AF-144 | Logout | Sign out ends the session on the server (`POST /api/auth/logout`), not just in the browser |

### The admin menu
The left sidebar groups every admin function: **Dashboard**, **Bookings** (all, today's, waiting for approval,
cancelled), **Payments** (to collect, collected, refunds), **Schedule**, **Courts** (all courts, status, pricing,
hours & rules, time slots), **Location** (the facility's map pin and address, plus the courts by area),
**People** (customers, staff, roles & access), **Customer care**, **Messaging**, **Insights**, **Integrations**,
**Security** (login security, active sessions, audit logs, API tokens), **Data** (backup & restore, data checks)
and **My account**.
- The small `AF-xxx` codes beside each entry are the function IDs from your requirements table
  (hover an entry for its full name). To hide them, add `.nav-code { display: none; }` to `frontend/css/admin.css`.
- The search box at the top filters the menu by function name or keyword (try "refund", "price", "block",
  "approve"). Press **Enter** to open the first result, **Ctrl K** to jump to it, **Esc** to clear.
- Groups open and close, and the app remembers which ones you closed. On phones the menu sits behind a **Menu** button.
- Every screen has its own address, and its page, search, filters and tabs are part of it, e.g.
  `http://localhost:5000/admin#/audit?page=5` or `#/bookings?status=pending&page=2`. Reload or share the address and
  the same view opens; Back and Forward step through pages and filters (`stateFrom`, `stateTo` and `bindState` in
  `frontend/js/admin.js`). Customer pages keep their filters the same way after `?`, e.g.
  `my-bookings?status=cancelled&view=calendar`, `courts?facility=Indoor`, `court-details?id=...&date=2026-11-20`,
  `booking-status?reference=MKI-...`.
- Every page has a clean address when the backend serves it: `/`, `/courts`, `/my-bookings`, `/admin`, `/admin-login`.
  An old address ending in `.html` (a bookmark or an emailed link) is sent to the clean one with the same `?` and `#`
  parts (`backend/server.js`). On another static host the menus link to the `.html` files (`window.PAGE` in
  `frontend/js/config.js`).
- To add or rename entries, edit the `NAV` list near the top of `frontend/js/admin.js`.

### Integrations (admin)
Each one is optional. It runs only when its keys are in `backend/.env` (see the comments in
`backend/.env.example` for where to get them) **and** it is switched on under admin -> **Integrations**
(sidebar), where admins can turn each one on or off without restarting the server.

**Customers use them too, but only admins can change them.** The same switches control the customer site:
Google sign-in / sign-up on `index.html` and `register.html` (`POST /api/auth/google`; a new email gets a customer
account; it uses `CUSTOM_GOOGLE_CLIENT_ID` when that is set, otherwise `GOOGLE_CLIENT_ID`), the invisible Turnstile check on customer login, sign-up and password reset, the forecast for the chosen date on `court-details.html` (`GET /api/weather`),
the facility map on `support.html` (`GET /api/facility`) and "Add to Google Calendar" on confirmed bookings.
Map, calendar and human check for customers in detail:
- **Map**: a "Find us" card with directions on Courts, each court page, the dashboard, the booking page and Support
  (shown once the facility is pinned under admin → **Location**). The **Location** page in the customer menu
  (`frontend/location.html`, `GET /api/facility`) has a large map, directions in Google Maps, Waze or OpenStreetMap,
  "How far am I?" (uses the browser's location, which never leaves the device), the opening hours, the address and
  which area of the facility each court is in (each court's Location field).
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
2. **One-time code**: a 6-digit code sent to the admin's email. It confirms only
   the change it was sent for, works once and expires in 10 minutes. "Send a new code" unlocks after 30 seconds.

After the change **every admin gets a security alert**: on the dashboard, and by email when email is set up
(the backend terminal then prints `Integration change alert emailed to 4 of 4 admin(s): ...`; a failed email is
tried once more, and the reason is printed if it still fails). Each step shows in Audit logs; the PIN and code never do.
Limits: 5 wrong PINs (or wrong passwords on the PIN form) lock the PIN for 15 minutes, 5 wrong codes cancel
the code, and an admin can ask for at most 5 codes per 15 minutes.

Codes and alerts go out whenever email keys are set, even if the Email switch is off, so turning Email off
can't lock the admins out. **No email set up yet?** In development the code is printed in the server console
(the terminal running the backend). With `NODE_ENV=production` codes are never printed, so set up email before
going live or the switches can't be changed.

API: `POST /api/admin/integrations/verify` `{ switches, pin }` sends the code and returns a `challengeId`;
`PUT /api/admin/integrations` `{ challengeId, otp }` applies the change; `POST /api/admin/integrations/verify/resend`
`{ challengeId }`; `PUT /api/admin/security/pin` `{ password, pin }`.
Code: `backend/utils/twoStep.js`, `backend/models/SecurityCode.js`, `backend/routes/securityRoutes.js`.

**Reset to defaults** (button at the top of Integrations) turns every switch back to its default, which is on for
every service, with the same PIN and one-time code. The dialog first lists what will change. Tick **Also remove the
Custom API (webhook)** to delete its address, events and signing secret too. Keys in `backend/.env` are never touched,
so a service without its keys stays "Not set up". The code applies exactly the reset that was shown: a switch someone
moves in the meantime is left alone. API: `GET /api/admin/integrations/reset` (what would change),
`POST /api/admin/integrations/reset/verify` `{ pin, webhook }` (sends the code), `PUT /api/admin/integrations/reset`
`{ challengeId, otp }` (applies it) and `POST /api/admin/integrations/reset/verify/resend` `{ challengeId }`.
The defaults are the ones declared in `backend/models/Settings.js`.

**Server settings check (`backend/.env`).** The server tells the admins when its settings change and when a value can't work:
- *At every start* it compares `backend/.env` with the previous start: a service that is now set up or no longer set up
  ("Google Calendar is now set up", "Email is no longer set up") and keys added, changed or removed. It also checks
  each value, e.g. a Google client *secret* (`GOCSPX-...`) pasted where the client ID belongs, a private key that can't
  be read, an `EMAIL_HOST` with `smtp://` or a port in it, `JWT_SECRET` still being
  the example value, or a service with only some of its keys. Every admin gets a dashboard alert and an email (when email
  is set up), and it goes into the audit log. A problem is reported once, until it is fixed.
- *While running* it watches the file: when it is edited, every admin gets a dashboard alert naming the keys that
  changed and saying the server keeps its old values until it is restarted.
- The **Integrations** page shows a "Server settings" card with all of this, keys the app doesn't use (like the old
  `PAYMONGO_*`), and a red note on any service whose keys have a problem.

Values are never stored, sent or shown, only key names. To see whether a value changed, the database keeps a salted
scrypt fingerprint of it (`backend/models/EnvState.js`). Code: `backend/utils/envCheck.js` (the list of keys and their
checks), tests in `backend/tests/envcheck.test.js`.

**Rate limits.** Every API request is rate-limited (`backend/middleware/rateLimits.js`, express-rate-limit), set in
`backend/.env` as `<requests>/<window>` (window in `s`, `m` or `h`; `off` turns one off):

| Setting | Covers | Counted per | Default |
|---|---|---|---|
| `RATE_LIMIT_AUTH` | sign-in, sign-up, password reset, Google sign-in (`/api/auth/*`) | IP address | `30/15m` |
| `RATE_LIMIT_API` | every other `/api` request | account when signed in, otherwise IP address | `300/1m` |
| `RATE_LIMIT_CREATE` | making bookings, feedback, support messages, broadcasts, announcements | account when signed in, otherwise IP address | `20/10m` |

Over a limit the server answers `429` with `Retry-After`, the standard `RateLimit` / `RateLimit-Policy` headers and
`{ success: false, code: "RATE_LIMITED", limit, retryAfter, message }`. **`GET /api/rate-limit`** shows the caller where
they stand (`limit`, `used`, `remaining`, `resetsAt` for each limit) and is not counted itself. IPv6 addresses are
counted by their /64 network. Admins see the limits and who was refused in the
last 24 hours under **Security → Login security** (`GET /api/admin/rate-limits`); each refusal is audit-logged (at most
once an hour per person or address), and a sign-in flood also sends every admin a dashboard alert. On a live server
behind a proxy, set `TRUST_PROXY=1` (the number of proxies) so each visitor's real IP address is used. Counts are kept in
the server's memory: they start over when it restarts.

**API tokens (for other systems).** Another system (a spreadsheet, a door panel at the courts, the facility's own app)
can call `/api/v1` with a token instead of a password. Admins make tokens under **Security → API tokens**: a name, what
it may do, its own rate limit (per minute, hour or day, never more than `RATE_LIMIT_API` allows anyone) and an expiry
(7, 30 or 90 days, a year, a date up to a year away, or never). The settings are **checked before anything is saved**:
the form lists every problem first, then the admin confirms with the security PIN and a one-time code, and they are
checked once more at the moment of saving. The token (`mkp_` + 43 characters) is **shown once**; the database keeps
only its SHA-256 hash and first characters. Tokens can be revoked at once; making and revoking are audit-logged and
every admin is alerted about new tokens.

| Request (send `Authorization: Bearer mkp_...`) | Needs | Gives |
|---|---|---|
| `GET /api/v1/me` | any token | the token: name, permissions, rate limit, expiry |
| `GET /api/v1/courts` | `courts:read` | courts, prices and opening hours |
| `GET /api/v1/courts/:id/availability?date=YYYY-MM-DD` | `courts:read` | free and taken times on a day |
| `GET /api/v1/bookings?from=&to=&status=&court=&page=&limit=` | `bookings:read` | bookings (at most 62 days, 100 a page); `customers:read` adds email and mobile |
| `GET /api/v1/bookings/:reference` | `bookings:read` | one booking |
| `POST /api/v1/check-ins` `{ "code": "MKI-..." }` | `checkins:write` | checks a customer in by booking reference or QR code (same rules as the desk) |

Bookings look the same as in the custom API's webhook events. Refusals: `401` `TOKEN_MISSING`, `TOKEN_INVALID`,
`TOKEN_REVOKED` or `TOKEN_EXPIRED`; `403` `TOKEN_SCOPE`; `429` `RATE_LIMITED` with `Retry-After` (every answer carries
`RateLimit` headers). Code: `backend/utils/apiTokens.js` (settings checks), `backend/middleware/apiToken.js`,
`backend/routes/apiV1Routes.js`, `backend/routes/apiTokenAdminRoutes.js`; tests in `backend/tests/apitokens.test.js`.

| Service | What it does in admin | Keys |
|---|---|---|
| Google Sign-In | "Sign in with Google" on `admin-login.html`, for existing staff/admin accounts whose email matches. It never creates accounts. Customers can get their own Google client with `CUSTOM_GOOGLE_CLIENT_ID`; each sign-in page only accepts tokens made for its own client ID | `GOOGLE_CLIENT_ID`, optional `CUSTOM_GOOGLE_CLIENT_ID` |
| Google Calendar | Confirmed bookings appear on the facility calendar and are updated or removed when moved, cancelled or rejected. "Sync upcoming bookings" button for existing ones. | `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` |
| Cloudflare Turnstile | Human check on the admin sign-in form | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Leaflet + OpenStreetMap | Map to pin the facility location (Location) | none |
| Open-Meteo | Weather forecast with rain chances on the admin dashboard | none (needs the facility location) |
| Email (Resend, or SMTP) | Emails customers booking updates (received, approved, not approved, cancelled, moved, paid, refunded, expired) and the 2-hour reminder; the approval email carries a calendar file. Password resets and admin one-time codes always use it when set up | `RESEND_API_KEY` + `EMAIL_FROM`, or `EMAIL_HOST/PORT/USER/PASS` |
| QR check-in | Confirmed bookings show a signed QR code; staff press **Verify booking (QR or reference)** under Check-ins or on the Dashboard, scan it (or type the reference), see whether it is good to play now, then **Check in now** | none |
| Custom API (webhook) | Sends signed booking events to your own system (see below) | none in `.env`: the address and secret are set in the admin console |

Code: `backend/utils/integrations/`, `backend/routes/integrationRoutes.js` (admin) and
`backend/routes/publicIntegrationRoutes.js` (login-page config, map and weather; no login needed). Online payment
(HitPay) was removed: customers pay at the front desk, and left-over `HITPAY_*` keys in `backend/.env` are listed as unused.

### Custom API (webhook)
Sends booking events to the facility's own system: another booking app, a spreadsheet through Zapier, Make or n8n,
a lights or door controller at the courts. Set it up under admin → **Integrations** → **Custom API (webhook)**:
the address of your system, which events to send, whether to include customer contact details (off by default;
the customer's name is always sent) and a signing secret (made for you and shown **once**, or your own).
Saving asks for the security PIN and a one-time code, like the on/off switches, and every admin is alerted.
**Send test event** sends a `webhook.test` event; **Recent events** lists the last 20 deliveries with their answers.

| Event | When |
|---|---|
| `booking.created` | a booking is made (waiting for approval) |
| `booking.approved` / `booking.rejected` | staff approve it / don't |
| `booking.cancelled` | cancelled by the customer or staff, or expired without approval |
| `booking.rescheduled` | moved to another date, time or court (also by the customer) |
| `booking.completed` | its time is over |
| `booking.paid` / `booking.refunded` | payment recorded by staff / refunded |
| `booking.checked_in` | checked in at the desk, by QR scan, or by the customer |

Each event is a `POST` of JSON:
```json
{
  "id": "evt_9f2c41d07a3b5e6c8d1e2f30",
  "type": "booking.approved",
  "createdAt": "2026-11-16T01:40:12.345Z",
  "facility": "MAKI's PickleBall Court",
  "data": {
    "booking": {
      "id": "...", "reference": "MKI-20261120-4F7K", "status": "confirmed", "statusReason": "",
      "court": { "id": "...", "name": "Court 1" },
      "date": "2026-11-20", "startTime": "08:00", "endTime": "09:00",
      "start": "2026-11-20T08:00:00+08:00", "end": "2026-11-20T09:00:00+08:00",
      "totalFee": 400, "discount": 0, "promoCode": "", "currency": "PHP",
      "paymentStatus": "pending", "paidAt": null, "checkedInAt": null,
      "customer": { "id": "...", "name": "Juan Dela Cruz" },
      "createdAt": "..."
    },
    "changes": { "status": { "from": "pending", "to": "confirmed" } }
  }
}
```
with the headers `X-Webhook-Id` (the same on every retry, so repeats can be ignored), `X-Webhook-Event`,
`X-Webhook-Timestamp` (Unix seconds) and `X-Webhook-Signature: sha256=<hex>`, the HMAC-SHA256 of
`<timestamp>.<raw body>` keyed with the secret. Checking it in Node.js (Express):
```js
const crypto = require('crypto');
app.post('/makis-events', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('X-Webhook-Timestamp');
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.MAKIS_WEBHOOK_SECRET)
    .update(timestamp + '.' + req.body).digest('hex');
  const given = req.get('X-Webhook-Signature') || '';
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // within 5 minutes
  if (!fresh || given.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body);
  res.sendStatus(200);
});
```
- **Delivery:** any 2xx answer within 10 seconds counts. Otherwise the event is tried again after 1 min, 5 min,
  30 min, 2 h and 6 h, then marked failed (an admin can press **Send again**). Redirects are not followed. Events are
  saved before they are sent, so retries survive a restart; a retry can arrive after a newer event, so order by `createdAt`.
- **Undone changes send nothing:** the first try waits a few seconds and is skipped if the change was rolled back
  (for example a booking that clashed with another one at the same moment).
- **Safety:** the secret is stored encrypted with a key derived from `JWT_SECRET` (if you change `JWT_SECRET`, make a
  new webhook secret) and is never shown again. With `NODE_ENV=production` the address must be public `https`
  (no `localhost` or private network addresses). Deliveries are kept for 30 days.
- **Code:** `backend/utils/integrations/webhook.js` (events, signing, sending, retries), `backend/models/WebhookDelivery.js`,
  `backend/utils/secretBox.js`, the `/api/admin/integrations/webhook*` routes in `backend/routes/integrationRoutes.js`,
  and the Booking model hooks that spot each change. Tests: `backend/tests/webhook.test.js`.

### Roles
`admin` can do everything. `staff` get the **staff console**: the desk work below, nothing else.

| Staff feature | Where |
|---|---|
| Staff Login | `/admin-login` ("Staff sign in"), the same page admins use |
| Staff Dashboard | Dashboard: today's bookings, courts right now, check-ins, what needs attention (approvals, payments to verify, refunds, maintenance). No revenue or account totals |
| Profile Management, Change Password | My account |
| View Court Availability | Courts (all courts and their status) and "Courts right now" on the dashboard |
| View Court Schedule | Schedule → Court schedule, view only (blocking slots is for admins); an open slot can be booked for a walk-in |
| Booking Management, Confirmation, Cancellation | Bookings: approve, reject, cancel (refunds follow the cancellation policy) |
| Create Walk-in Booking | "Walk-in booking" on the Dashboard and Bookings: a guest without an account, or a customer's account; paid at the desk or later |
| SF-111 Booking Rescheduling | A booking → **Reschedule...**: another date, time or court; the customer is told |
| SF-112 Booking Status Update | A booking: approve, mark completed, cancel, reinstate; check in and out (below) |
| SF-113 Booking Verification | **Verify booking (QR or reference)** on the Dashboard and Check-ins: scan the QR code or type the reference. It says whether the booking is good to play now (confirmed, today, not over, not checked in yet) and changes nothing until you press **Check in now** |
| SF-114 Check-in Processing | **Check in now** after verifying, **Check in** in a booking on its day, or the Check-ins list |
| SF-115 Check-out Processing | **Check out** in a booking or on the Check-ins list; the court stops showing as occupied |
| SF-116 Customer Information | A booking → **Their bookings and contact**: email, mobile and every booking of that customer (the full customer list stays with admins) |
| SF-117 Payment Verification | Payments → Verification: approve or reject a payment reference a customer sent before payment methods were removed (none can be sent now); the customer is told |
| SF-118 Payment Recording | A booking → Payment → **Mark paid** (no payment method is chosen); it goes into Transaction history with the staff member's name |
| SF-119 Receipt Generation | A paid booking → **Receipt** (also opens by itself after a walk-in pays at the desk) → **Print receipt** prints only the receipt |
| SF-120 Refund Processing | Payments → Refunds: what the cancellation policy says to give back; record the refund (amount and reason) |
| SF-121 Court Status Update | Courts → Status: available, maintenance, closed, unavailable. A court being played on shows **Occupied until ...** with who is on it |
| SF-122 Maintenance Reporting | **Report a problem** (Courts → Maintenance, or the Courts page): where, what kind, how urgent, optionally set the court to maintenance. Admins are alerted at once and set it to being fixed / fixed; the reporter is told |
| SF-123 Court Assignment | A booking → **Assign court...**: pick a free court for the same time; the fee stays what the customer agreed to; works while they are already playing |
| SF-124 Daily Schedule | Schedule → Daily schedule: every reservation on one day by time, with customer, mobile, status, payment and check-in; Print |
| SF-125 Booking Search | Bookings → search box: reference, customer or walk-in name (first, last or full), email, mobile (with or without spaces), payment reference, or a date like 2026-11-20 |
| SF-126 Booking Filter | Bookings: status, payment, court, date and **time** (morning, afternoon, evening, or who is playing at an hour); the CSV export follows the filters |
| SF-127 Notifications | **My notifications** (the bell opens it, with the unread count; also under My account; not on the dashboard): All or Unread, mark one or all as read, grouped by day, Show older. Alerts include new bookings, customer reschedules and cancellations, payments to verify, courts changing status, blocked and unblocked slots, new hours or rules, staff announcements, shifts, poor ratings, answers to help requests. Each alert opens the screen it is about; a message pops up when one arrives (checked every 30 seconds). Nobody is alerted about their own action |
| SF-128 Announcements | Messaging → Announcements (read only): instructions for staff and what customers were told. Admins choose who sees each announcement: customers, staff only, or everyone |
| SF-129 Customer Feedback | Customer care → Feedback (read only; hiding and reviewing stay with admins). A 1- or 2-star rating alerts the staff |
| SF-130 Incident Reporting | Customer care → Incidents → **Record an incident** (or from a booking): kind, when, what happened, what was done, serious or not. Admins are alerted and resolve it; staff add notes |
| SF-131 Daily Booking Report | Insights → Daily report: reservations by status and source, arrivals (checked in, on court, finished, no check-in), payments for the day, court usage; Print and CSV |
| SF-132 Payment Report | Payments → Shift payments: what was received and refunded during your shift (or any times on a day), by staff member, every transaction; "Only what I recorded"; Print for the handover |
| SF-133 Court Utilization | Courts → Court usage: an hour-by-court grid (booked, on court, finished, waiting for approval, blocked, free, closed), courts in use now, usage per court and for the day, busiest time; today updates every minute |
| SF-134 Shift Information | My account → My shifts (and on the Dashboard: "On shift until 16:00"). Admins assign shifts under People → Shifts; staff are told when one is added, changed or removed |
| SF-135 Activity Log | My account → My activity: everything you did in the console, including signing in and out. Admins see everyone's under Security → Audit logs, with a Staff only filter |
| SF-136 Help/Support | My account → Help & support: how-to guides for what your account can do, the administrators' contacts, and **Ask the administrators** (answers come back in the same thread). Admins answer under People → Help requests |
| SF-137 Logout | **Sign out** at the bottom of the menu ends the session on the server (the token stops working at once) and is recorded in the activity log |

**Admin only:** customers list and accounts, staff, roles, shifts, settings (hours, booking rules, policy), prices,
adding or editing courts, blocking time slots, promotions, writing announcements, sending notifications, hiding or
reviewing feedback, customer issues, reports and analytics, everyone's audit and sign-in logs, sessions,
integrations, backups and data checks, and handling maintenance reports, incidents and help requests (staff report
them and add notes). Staff see the money they handle, not the takings: on Payments the amounts collected
and refunded show as counts, and Transactions shows totals for up to 31 days at a time (e.g. today, for a shift), not
all-time.

To add a staff account: sign in as an admin, open **People → Staff → Add staff member**, enter their name, email and a
temporary password, keep the role **Staff**, and press Create account. They sign in at `/admin-login` and can change the
password under My account. To make an existing account staff, use People → Roles & access. Customers (`user`) cannot
use the admin API at all. To give staff more or less, change the `staff` list in `backend/config/permissions.js`.
The matrix lives in `backend/config/permissions.js` and is shown on the Roles & access screen.
Active sessions (`sessions`) and Backup & restore / Data checks (`data`) are admin only.

### Booking rules and cancellation policy (AF-136, AF-137)
Set under **Courts → Hours & rules**; the card beside the form shows what customers read, word for word. 0 means no limit.
- **Booking rules** (customers only; staff can still book and move anything): how many days ahead, how many hours'
  notice, how many upcoming bookings one customer may hold.
- **Cancellation and refunds**: until how many hours before the start customers can cancel or move a booking; how
  early a cancellation must be for a full refund, and the percentage later ones get back. When the facility cancels
  or rejects a paid booking, or it expires unapproved, the refund is always the full fee.
- **Payments**: there is nothing to set up: no payment methods and no online payment. Customers pay at the front desk,
  and the rules tell them that.
- Customers see the rules on the booking page, on My Bookings (each booking says until when it can be cancelled) and
  on Terms. The cancel dialog shows exactly what comes back before they confirm.
- A cancelled paid booking stays **paid** and waits under **Payments → Refunds** with the amount the policy says to
  give back. It becomes refunded when staff record the refund there, which also writes it to Transaction history and
  tells the customer. (Before, a customer cancelling marked it refunded at once, so no refund was ever recorded; Data
  checks finds and moves those.) The logic and its tests: `backend/utils/policy.js`, `backend/tests/policy.test.js`.

### Sessions and signing out (AF-141, AF-144)
Every sign-in is a session (`backend/models/Session.js`, `backend/utils/sessions.js`): the token carries its id, and
every request checks the session is still open. So signing out, an admin ending a session, a new password or a
deactivated account stops that token at once.
- **Security → Active sessions**: who is signed in, where (admin console or customer site), device, IP address and last
  activity; end one session or all of one person's. Ended sessions stay listed for 30 days.
- **My account** (admin) and **Profile** (customers) list your own devices, with "Sign out all other devices".
  Changing your password keeps this device signed in and signs out the others.
- After this update everyone signs in again once: older tokens have no session.

### Backup and restore (AF-138)
**Data → Backup & restore** (`backend/utils/backup.js`).
- A backup is one JSON file with every record (bookings, accounts, payments, settings, logs), written as MongoDB
  Extended JSON so ids, dates and numbers come back exactly. Sessions and one-time codes are left out.
- Files are saved in `backend/backups/` (git ignores it) or `BACKUP_DIR`. They hold customers' details and password
  hashes, so keep downloaded copies safe. `BACKUP_DIR` inside `frontend/` is refused (anyone could download it).
- **Back up now**, or automatic backups: one a day while the server runs, keeping the newest 7 (adjustable).
- **Download**, **Restore** and **Delete** ask for the security PIN and a one-time code, and every admin is alerted.
- **Restore** replaces all data with the backup's (accounts too, so passwords and PINs go back to what they were).
  A safety backup of the current data is made first, so a restore can be undone. On a single MongoDB server (no
  transactions) a restore that fails half way puts everything back. Everyone except the admin restoring is signed out.
- **Upload a backup** checks the file first: not a backup, made by a newer app, damaged or repeated records, or no
  active admin account (it would lock everyone out) are all refused.

### Data checks (AF-139)
**Data → Data checks** (`backend/utils/dataChecks.js`) finds records that disagree and fixes the safe ones: cancelled
bookings marked refunded with no refund recorded, paid bookings or refunds missing from Transaction history, finished
bookings not marked completed or expired yet, promo codes whose use count is wrong. Bookings whose customer or court no
longer exists are shown but not changed. It also deletes read notifications older than 90 days on request, and lists
what MongoDB removes by itself. Every fix is written to the audit log.

### Exports (AF-143)
**Export CSV** on Bookings, Transactions and Audit logs exports every row matching the current filters; Reports has
**Download CSV** next to Print / save PDF. The files open in Excel and Google Sheets: UTF-8 (₱ shows), numbers stay
numbers, dates are in Philippine time, and text that would start a formula (e.g. a name beginning with `=`) is made
safe. `backend/utils/csv.js`, `backend/tests/csv.test.js`.

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
│   ├── utils/               # shared backend helpers (concurrency.js: timestamp concurrency control)
│   ├── tests/               # npm test - concurrency control and custom API (webhook) tests
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

Sessions: after updating, everyone (customers and staff) signs in again once. The cancellation policy starts with the
old behaviour (cancel any time before the start, always a full refund) until an admin changes it under Hours & rules.
Paid bookings that customers cancelled before this update were marked refunded with no refund recorded: open
Data → Data checks and press "Move them to Payments → Refunds", then record what was actually given back.

## Concurrency control (timestamp-based)

Many people use the system at once: customers book and cancel, staff approve, reschedule and record
payments, and background jobs complete, expire and remind bookings. The database is protected with
**timestamp-based concurrency control**, a validation-based (optimistic) form of the timestamp
ordering protocol. Code: `backend/utils/concurrency.js`. Tests: `npm --prefix backend test`.

### The timestamps
| Name | Where | Meaning |
|---|---|---|
| **W-TS(X)** | `writeTS` on every record (bookings, courts, users, settings, promos, announcements, feedback, issues, blocks, notifications) | when the record was last written |
| **TS(T)** | `res.locals.tx.ts` on every write request | the transaction's own timestamp, unique and strictly increasing |
| **Schedule TS** | `scheduleTS` on each court | when anything that decides which slots of that court are bookable last changed |

Timestamps come from `nextTimestamp()`, which never repeats and never goes backwards inside the
server process, even for two calls in the same millisecond or if the system clock is adjusted.

### The protocol
1. **Read phase**: a request reads a record and remembers the W-TS it saw.
2. **Validation + write (one atomic step)**: the update is sent with the filter `{ _id, writeTS: <seen> }`
   and sets a new W-TS. If another transaction wrote the record in between, nothing matches and the write is rejected.
   This is automatic for every `doc.save()`. `updateOne / updateMany / findOneAndUpdate` stamp a fresh W-TS
   so anyone holding the old one is invalidated.
3. **Abort and restart**: a rejected transaction is rolled back and restarted with a **new TS(T)**,
   up to 3 times with a short random back-off (`tx()` / `txRouter()` wrap every POST/PUT/PATCH/DELETE route).
   Business rules are re-checked on the fresh data. For example, a booking that was cancelled meanwhile
   can no longer be approved.

### Stale screens (client versions)
A person can look at a record for minutes before clicking. The admin console and customer pages send the
W-TS of what they displayed in the `If-Match` header (or `expectedWriteTS` in the body). If the record changed
since then, the server answers **409 `WRITE_CONFLICT`** with who/when wording and does **not** retry. The page
reloads the record, so nobody overwrites a change they never saw. Requests without a version (old clients,
scripts) still work and are protected by steps 1-3.

### Races that span several collections (schedule timestamp)
The unique index `unique_active_slot` stops two bookings on one slot. Some conflicts involve different
collections, though, and need the court's schedule timestamp:

| Race | What happens now |
|---|---|
| Customer books a slot while staff block it | one of them is undone and retried, so the slot is never both booked and blocked |
| Customer books while staff set the court to maintenance/closed | the booking is undone and retried, then refused ("court is maintenance") |
| Customer books while staff change hours or slot length | the hours change is re-checked against the new booking, or the booking is retried on the new grid |
| Staff remove a court while it is being booked | the delete or the booking is retried |
| Booking moved (rescheduled) or brought back from cancelled onto a slot being blocked | the move is reverted and retried |

Each such operation follows: read the court (remember `scheduleTS`) → check the slots → write → `commitSchedule()`
(conditional on `scheduleTS`). If the commit fails, its own write is undone (`commitScheduleOrUndo`) and the request restarts.
Booking-only changes to a court's schedule do **not** change the court's W-TS, so an admin's open court form does not go stale.

### Other fixes made along the way
- The auto-complete job no longer turns a booking that was cancelled a moment earlier into "completed".
- Expired-booking notices are sent once, even when two requests run the housekeeping job together.
- Two admins pressing *Publish* at once no longer send the announcement to every customer twice.
- Deleting an announcement works again (the route path was misspelled `/a.publishedannouncements/:id`).
- Customer reschedule checks the slot before looking for the customer's own clashes (it read an undefined date when the slot was invalid).

### Existing databases
Nothing to migrate: records without `writeTS` are treated as version `null` and still validated. To give old
records their own version anyway, run `npm --prefix backend run backfill:writets` once.

### Limits
- Timestamps are strictly ordered within one server process. With several Node processes, the atomic
  `{ _id, writeTS }` filter still prevents lost updates. Only the TS(T) ordering between processes is approximate.
- Several customers booking the same court at the same instant are serialised through its schedule
  timestamp. After 3 failed attempts the customer sees "Please try again". That's fine for a facility's
  traffic, but very high contention would need MongoDB multi-document transactions (replica set) instead.

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
  court + date + start time, plus timestamp concurrency control (see above). If the server prints a **WARNING** about that index at
  startup, fix it before going live (see the message for the `mongosh` command).
- Dates are stored as midnight **Philippine time** (UTC+8) so bookings land on the
  right day whatever timezone the server runs in.
- Passwords are hashed with bcrypt and never returned by the API.
- Reset tokens are hashed before being stored and expire after 30 minutes.
- Court availability is computed on the fly from each court's `openTime`/
  `closeTime`/`slotDurationMinutes` minus any non-cancelled bookings for that
  date — there's no separate "slots" collection to keep in sync.

## UI refresh (Nov 2026)

- New minimal look across every customer and admin page: Plus Jakarta Sans type, soft aurora background, floating glass navbar (`frontend/js/nav.js`: Home, Book a court, My bookings, More, the notifications bell and the account menu; one Menu button on phones), cursor spotlight, button sheen and ripple, scroll reveal, count-up stats, confetti after booking.
- Login, register, forgot/reset password and admin sign-in use a split photo layout. A new account starts on **Profile → Avatar studio**.
- Court photos: mockups in `frontend/img/courts/court-1..6.jpg`. A court shows its own `imageUrl` if set, otherwise a mockup picked from its id. Admins can choose a mockup in **Courts → Add/Edit court → Court photo**.
- Customizable avatar: `frontend/js/avatar.js` draws it; customers edit it in **Profile → Avatar studio**. Saved on the user as `avatar` (`PUT /api/users/profile`, choices validated in `backend/routes/userRoutes.js`). Shown in the navbar account menu, the dashboard and the console sidebar (`GET /api/admin/me` returns it).
- `backend/config/db.js` (and the seed / create-admin scripts) look up the MongoDB Atlas address through public DNS (8.8.8.8, 1.1.1.1), for routers that refuse the `mongodb+srv://` lookup.
