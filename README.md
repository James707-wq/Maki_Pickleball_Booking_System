# MAKI's PickleBall Court

Full-stack website + MongoDB database implementing the account & dashboard
features below.

| ID | Feature | Where it lives |
|---|---|---|
| UF-101 | User Registration | `POST /api/auth/register` · `public/register.html` |
| UF-102 | User Login | `POST /api/auth/login` · `public/index.html` |
| UF-103 | Forgot Password | `POST /api/auth/forgot-password` · `public/forgot-password.html` |
| UF-104 | Password Reset | `PUT /api/auth/reset-password/:token` · `public/reset-password.html` |
| UF-105 | User Profile | `GET /api/users/profile` · `public/profile.html` |
| UF-106 | Edit Profile | `PUT /api/users/profile` · `public/profile.html` |
| UF-107 | Change Password | `PUT /api/users/change-password` · `public/profile.html` |
| UF-108 | Dashboard | `GET /api/dashboard` · `public/dashboard.html` |
| UF-109 | View Pickleball Courts | `GET /api/courts` · `public/courts.html` |
| UF-110 | Court Information | `GET /api/courts/:id` · `public/court-details.html` |
| UF-111 | View Court Availability | `GET /api/courts/:id/availability?date=` |
| UF-112 | Search Courts | `GET /api/courts?q=` · search box on `courts.html` |
| UF-113 | Filter Courts | `GET /api/courts?status=&facility=` · filters on `courts.html` |
| UF-114 | View Schedule | `court-details.html` schedule grid |
| UF-115 | Select Date and Time | date picker + slot buttons on `court-details.html` |
| UF-116 | Court Booking | `POST /api/bookings` |
| UF-117 | Booking Details | `GET /api/bookings/:id` |
| UF-118 | Booking Summary | summary card on `court-details.html` before confirming |
| UF-119 | Booking Confirmation | `public/booking-confirmation.html` |
| UF-120 | Booking Reference Number | auto-generated per booking (e.g. `MKI-...`) |
| UF-121 | Payment Status | `paymentStatus` field (pending/paid/failed/refunded) |
| UF-122 | Payment Receipt | receipt view + Print button on `booking-confirmation.html` |
| UF-123 | My Bookings | `GET /api/bookings` · `public/my-bookings.html` |
| UF-124 | Booking History | Allows users to view their previous completed, cancelled, or expired bookings. |
| UF-125 | Booking Cancellation | Allows users to cancel an existing reservation according to the system's cancellation policy. |
| UF-126 | Booking Rescheduling | Allows users to change their booking date or time if another slot is available. |
| UF-127 | Booking Status | `GET /api/bookings/reference/:referenceNumber` · `public/booking-status.html`; status filters are also available on `my-bookings.html`. |
| UF-128 | Booking Notifications | Sends notifications regarding booking confirmations, cancellations, payments, and schedule changes. |
| UF-129 | Booking Reminders | Reminds users about upcoming pickleball reservations. |
| UF-130 | Announcements | Allows users to view important announcements from the pickleball facility. |
| UF-131 | Promotions/Discounts | Displays available promotions, discounts, or special booking offers. |
| UF-132 | Contact/Support | Allows users to contact the facility or administrator regarding concerns, questions, or booking issues. |
| UF-133 | Feedback and Rating | Allows users to provide feedback or ratings about their booking experience and court facilities. |
| UF-134 | Report a Problem | Allows users to report issues involving a court, booking, payment, or system functionality. |
| UF-135 | Terms and Policies | Allows users to view the facility's booking rules, cancellation policy, payment policy, and terms of service. |
| UF-136 | Check-in | `POST /api/bookings/:id/checkin` · same-day check-in on `public/my-bookings.html` |
| UF-137 | Booking Verification | `GET /api/bookings/reference/:referenceNumber` · `public/booking-status.html` |
| UF-138 | Logout | `public/js/api.js` clears the customer session token on logout |

## Branding and look

The colors come from the logo: navy `#0a325e`, cyan `#33d9ff`, pickleball yellow `#f9e20b`.
- Logo files are in `public/img/` (`logo.png`, `logo-mark.png`, `favicon.png`, `favicon-32.png`).
  To use a sharper logo later, replace those files and keep the names. The logo's navy background
  matches the sidebar and header color exactly, so it sits on them without a visible box.
- Colors live at the top of `public/css/style.css` (customer site) and `public/css/admin.css` (admin).
- Motion: sections fade in, dialogs and toasts ease in and out, dashboard numbers count up and bars rise,
  buttons and cards respond to hover and press, and loading shows shimmer placeholders. Everything switches
  off automatically for people who have "reduce motion" turned on in their device settings.
- Friendly extras: show/hide password, current-page highlight, press `/` in the admin to jump to search.

## Admin features

Sign in at **http://localhost:5000/admin-login.html** (staff and admin accounts only).
The whole admin console is one page: `public/admin.html` (+ `public/js/admin.js`,
`public/css/admin.css`). Every screen reads and writes MongoDB through `/api/admin/*`.

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
| AF-116 | Booking Approval | Hours & rules → "Approve each booking"; Bookings → Approve / Reject |
| AF-117 | Booking Cancellation | Bookings → Cancel (reason required, customer is notified) |
| AF-118 | Booking Rescheduling | Bookings → Reschedule (date, time, court; conflicts refused) |
| AF-119 | Booking Status Management | `PATCH /api/admin/bookings/:id/status` |
| AF-120 | Payment Management | Payments (mark paid / failed / refunded) |

### The admin menu
The left sidebar groups every admin function: **Dashboard**, **Bookings** (all, today's, waiting for approval,
cancelled), **Payments** (to collect, collected, refunds), **Schedule**, **Courts** (all courts, status, pricing,
opening hours, time slots), **People** (customers, staff, roles & access) and **My account**.
- The small `AF-xxx` codes beside each entry are the function IDs from your requirements table
  (hover an entry for its full name). To hide them, add `.nav-code { display: none; }` to `public/css/admin.css`.
- The search box at the top filters the menu by function name or keyword (try "refund", "price", "block",
  "approve"). Press **Enter** to open the first result, **Ctrl K** to jump to it, **Esc** to clear.
- Groups open and close, and the app remembers which ones you closed. On phones the menu sits behind a **Menu** button.
- To add or rename entries, edit the `NAV` list near the top of `public/js/admin.js`.

### Roles
`admin` can do everything. `staff` can use Dashboard, Bookings, Payments, Schedule,
view courts and change court status. Customers (`user`) cannot use the admin API at all.
The matrix lives in `config/permissions.js` and is shown on the Roles & access screen.

## Tech stack
- **Backend:** Node.js, Express
- **Database:** MongoDB (via Mongoose) — collections: `users`, `courts`, `bookings`, `blockedslots`, `settings`, `notifications`
- **Auth:** JWT (stored in `localStorage` on the frontend), bcrypt-hashed passwords
- **Frontend:** Plain HTML/CSS/JS (no build step needed), served by Express from `/public`
- **Email:** Nodemailer (for password-reset links)

## Project structure
```
makis-pickleball/
├── server.js               # entry point
├── config/db.js            # MongoDB connection
├── config/permissions.js   # role -> feature access (admin / staff / user)
├── models/                 # User, Court, Booking, BlockedSlot, Settings, Notification
├── middleware/auth.js      # JWT protection + role check (authorize)
├── routes/                 # auth, user, dashboard, court, booking, admin
├── utils/                  # bookingUtils (slot rules), handleError, sendEmail
├── scripts/                # seedCourts.js, createAdmin.js
└── public/                 # customer pages + admin-login.html, admin.html
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```
   - `MONGO_URI` — a local MongoDB (`mongodb://localhost:27017/makis_pickleball`)
     or a free [MongoDB Atlas](https://www.mongodb.com/atlas) connection string.
   - `JWT_SECRET` — any long random string.
   - `CORS_ORIGINS` — optional comma-separated frontend origins for cross-origin deployments.
     Same-origin requests work without it; `CLIENT_URL` is accepted as a single-origin fallback.
   - `EMAIL_*` — SMTP credentials so "Forgot Password" can actually send an email.
     For Gmail, use an [App Password](https://myaccount.google.com/apppasswords),
     not your normal login password.

3. **Run MongoDB** (if running locally)
   ```bash
   mongod
   ```

4. **Start the server**
   ```bash
   npm start
   # or, for auto-restart during development:
   npm run dev
   ```

5. **Seed sample courts** (optional now: you can also add courts from the admin console)
   ```bash
   npm run seed:courts
   ```
   This **deletes and re-creates** all courts, so only run it on a fresh database.

6. **Create your first admin account**
   ```bash
   npm run create:admin -- you@example.com "AStrongPassword1" "First" "Last"
   ```
   If that email already has a customer account, it is promoted to admin instead
   (its password is not changed).

7. Open **http://localhost:5000/admin-login.html** and sign in. Customers use
   **http://localhost:5000** as before. Admins add staff under *Staff*.

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
#   M a k i _ P i c k l e b a l l _ B o o k i n g _ S y s t e m  
 