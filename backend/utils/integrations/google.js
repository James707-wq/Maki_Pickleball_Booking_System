/**
 * Google Sign-In (verify ID tokens from the admin login page) and
 * Google Calendar (mirror confirmed bookings onto the facility calendar via a service account).
 */
const { OAuth2Client, JWT } = require('google-auth-library');
const { env, isActive } = require('./index');

/* ---------- Sign-In ---------- */
let oauthClient = null;
async function verifyGoogleIdToken(credential) {
  if (!(await isActive('googleSignIn'))) throw Object.assign(new Error('Google sign-in is turned off'), { status: 400 });
  oauthClient = oauthClient || new OAuth2Client(env('GOOGLE_CLIENT_ID'));
  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: String(credential || ''), audience: env('GOOGLE_CLIENT_ID') });
    payload = ticket.getPayload() || {};
  } catch (err) {
    throw Object.assign(new Error('Google sign-in could not be verified. Please try again.'), { status: 401 });
  }
  if (!payload.email || !payload.email_verified) {
    throw Object.assign(new Error('Your Google email is not verified'), { status: 401 });
  }
  return {
    email: String(payload.email).toLowerCase(),
    name: payload.name || '',
    firstName: String(payload.given_name || (payload.name || '').split(' ')[0] || 'Google').slice(0, 60),
    lastName: String(payload.family_name || (payload.name || '').split(' ').slice(1).join(' ') || 'User').slice(0, 60),
  };
}

/* ---------- Calendar ---------- */
let calendarClient = null;
function calendar() {
  if (!calendarClient) {
    calendarClient = new JWT({
      email: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      key: env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'), // .env files store newlines as \n
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });
  }
  return calendarClient;
}
const eventsUrl = (id = '') =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env('GOOGLE_CALENDAR_ID'))}/events${id ? '/' + encodeURIComponent(id) : ''}`;
const httpStatus = (e) => (e && e.response ? e.response.status : 0);

const SHOW_ON_CALENDAR = ['confirmed', 'completed'];

/**
 * Makes the calendar match one booking: confirmed/completed -> event exists and is up to date,
 * anything else -> event removed. Never throws; returns what happened.
 */
async function syncBookingToCalendar(bookingOrId) {
  if (!(await isActive('googleCalendar'))) return 'skipped';
  const Booking = require('../../models/Booking');
  const U = require('../bookingUtils');
  const id = bookingOrId && bookingOrId._id ? bookingOrId._id : bookingOrId;
  try {
    const b = await Booking.findById(id).populate('user', 'firstName lastName email phone');
    if (!b) return 'missing';

    if (!SHOW_ON_CALENDAR.includes(b.status)) {
      if (!b.calendarEventId) return 'none';
      await calendar().request({ url: eventsUrl(b.calendarEventId), method: 'DELETE' }).catch((e) => {
        if (![404, 410].includes(httpStatus(e))) throw e;
      });
      await Booking.updateOne({ _id: b._id }, { $unset: { calendarEventId: 1 } });
      return 'removed';
    }

    const day = U.toDateStr(b.date);
    const who = b.user ? `${b.user.firstName} ${b.user.lastName}` : 'Customer';
    const event = {
      summary: `${b.courtName} · ${who}`,
      description: [`Booking ${b.referenceNumber}`, b.user && b.user.email, b.user && b.user.phone,
        `Payment: ${b.paymentStatus}`, `Fee: PHP ${b.totalFee}`].filter(Boolean).join('\n'),
      start: { dateTime: `${day}T${b.startTime}:00+08:00`, timeZone: 'Asia/Manila' },
      end: { dateTime: `${day}T${b.endTime}:00+08:00`, timeZone: 'Asia/Manila' },
      extendedProperties: { private: { bookingId: String(b._id) } },
      status: 'confirmed', // also restores an event that was cancelled earlier
    };

    // Event id comes from the booking id (hex digits are valid Calendar ids), so overlapping syncs
    // can never create two events for one booking.
    const eventId = b.calendarEventId || `mkb${b._id}`;
    let result = 'updated';
    try {
      await calendar().request({ url: eventsUrl(eventId), method: 'PUT', data: event });
    } catch (e) {
      if (![404, 410].includes(httpStatus(e))) throw e;
      try {
        await calendar().request({ url: eventsUrl(), method: 'POST', data: { ...event, id: eventId } });
        result = 'created';
      } catch (e2) {
        if (httpStatus(e2) !== 409) throw e2; // 409: another sync created it a moment ago
        await calendar().request({ url: eventsUrl(eventId), method: 'PUT', data: event });
      }
    }
    if (b.calendarEventId !== eventId) await Booking.updateOne({ _id: b._id }, { $set: { calendarEventId: eventId } });
    return result;
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error ? err.response.data.error.message : err.message;
    console.error(`Calendar sync for booking ${id} failed:`, detail);
    return 'failed';
  }
}

module.exports = { verifyGoogleIdToken, syncBookingToCalendar };
