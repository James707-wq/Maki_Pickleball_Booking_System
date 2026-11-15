const nodemailer = require('nodemailer');

/**
 * One pooled SMTP connection, reused by every email. A burst of emails (an alert to every admin, then a
 * security code) logs in once instead of once per email, so Gmail doesn't refuse with "try again later".
 * Created on first use, after backend/.env has been loaded.
 */
let smtp = null;
function smtpTransport() {
  if (!smtp) {
    const port = Number(process.env.EMAIL_PORT);
    smtp = nodemailer.createTransport({
      pool: true,
      maxConnections: 3,
      host: process.env.EMAIL_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      connectionTimeout: 15000, // give up on an unreachable server in seconds, not nodemailer's 2 minutes
      greetingTimeout: 15000,
      socketTimeout: 60000,     // a connection idle for a minute is closed
    });
  }
  return smtp;
}

/**
 * Sends an email. Uses Resend (RESEND_API_KEY) when set, otherwise SMTP (EMAIL_HOST/PORT/USER/PASS).
 * Used for password reset links (UF-103), admin security codes and alerts, and, when switched on, booking emails.
 * attachments: [{ filename, content (string or Buffer), contentType }]
 */
const sendEmail = async ({ to, subject, html, attachments }) => {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  if (process.env.RESEND_API_KEY) {
    const r = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from || "MAKI's PickleBall Court <onboarding@resend.dev>",
        to: [to], subject, html,
        attachments: (attachments || []).map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64'),
          content_type: a.contentType,
        })),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`Resend ${r.status}: ${detail.slice(0, 200)}`);
    }
    return;
  }

  await smtpTransport().sendMail({ from, to, subject, html, attachments });
};

module.exports = sendEmail;
