'use strict';
/* =====================================================================
   MAKI's PickleBall Court - admin console, part 2 (AF-121 .. AF-143)
   Loaded before admin.js, which merges EXTRA into its views, icons and menu.
   Uses the helpers defined in admin.js (api, view, setHead, openModal, ...).
   ===================================================================== */
const EXTRA = { views: {}, icons: {} };

const ICON_PATHS = {
  verify: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  refunds: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',
  transactions: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  checkins: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 15l2.5 2.5L16 13"/>',
  comms: '<path d="M4 5h16v11H9l-5 4z"/>',
  care: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  insights: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
};
Object.assign(EXTRA.icons, ICON_PATHS);

/* ---------- small shared helpers ---------- */
const money = (n) => peso(n);
const pager2 = (d, noun, goto) => `<div class="pager"><span class="num">${d.total} ${noun}${d.total === 1 ? '' : 's'} &middot; page ${d.page} of ${d.pages}</span>
  <div><button class="btn small" data-page="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Previous</button>
  <button class="btn small" data-page="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div></div>`;
const pillX = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const stars = (n) => `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
const ago = (d) => fmtStamp(d);
const rangeDefaults = (days = 30) => ({ from: addDays(todayStr(), -(days - 1)), to: todayStr() });
const qsOf = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const dateFields = (r) => `
  <label class="inl">From <input type="date" id="rFrom" value="${esc(r.from)}" max="${todayStr()}" aria-label="From date" /></label>
  <label class="inl">To <input type="date" id="rTo" value="${esc(r.to)}" max="${todayStr()}" aria-label="To date" /></label>`;
const hbars = (rows, fmt, empty) => {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<div class="hbars">${rows.map((r) => `<div class="hb"><span class="hl" title="${esc(r.label)}">${esc(r.label)}</span>
    <span class="ht"><i style="width:${Math.max(2, Math.round((r.v / max) * 100))}%"></i></span><b class="num">${fmt(r.v)}</b></div>`).join('')}</div>`;
};
const columns = (days, rows, key, fmt) => {
  const max = Math.max(1, ...rows.map((r) => r[key]));
  // long ranges: label only some columns so the axis stays readable
  const every = Math.ceil(rows.length / 10);
  return `<div class="chart" role="img" aria-label="Chart by day">${rows.map((r, i) => `
    <div class="col"><div class="n num">${r[key] ? (key === 'amount' ? '' : r[key]) : ''}</div>
    <div class="bar-fill" title="${esc(fmtShort(r.date))}: ${key === 'amount' ? money(r[key]) : r[key]}" style="height:${Math.max(2, Math.round((r[key] / max) * 110))}px"></div>
    <div class="d">${i % every === 0 ? esc(fmtShort(r.date)) : '&nbsp;'}</div></div>`).join('')}</div>`;
};

/* =====================================================================
   AF-121 Payment Verification
   ===================================================================== */
EXTRA.views.verify = { label: 'Payment verification', perm: 'payments', render: renderVerify };

async function renderVerify() {
  setHead('Payment verification', 'Customers send their payment reference here. Check it, then verify or reject.');
  const { bookings } = await api('/payments/verification');
  view.innerHTML = `<div class="card"><div class="tablewrap"><table>
    <thead><tr><th>Booking</th><th>Customer</th><th class="r">Amount</th><th>Their reference</th><th>Sent</th><th></th></tr></thead>
    <tbody>${bookings.length ? bookings.map((b) => `<tr>
      <td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">${esc(courtOf(b))} &middot; ${fmtDate(b.date)}</span></td>
      <td>${esc(custName(b))}<span class="sub">${esc(b.user ? b.user.email : '')}</span></td>
      <td class="r num">${money(b.totalFee)}${b.discount ? `<span class="sub">promo ${esc(b.promoCode)} −${money(b.discount)}</span>` : ''}</td>
      <td class="num"><b>${esc(b.paymentReference || '-')}</b></td>
      <td>${esc(ago(b.paymentSubmittedAt))}</td>
      <td class="r"><div class="btnrow" style="justify-content:flex-end;">
        <button class="btn small primary" data-act="verify" data-id="${esc(b._id)}">Verify</button>
        <button class="btn small danger" data-act="reject" data-id="${esc(b._id)}">Reject</button></div></td></tr>`).join('')
      : emptyRow(6, 'Nothing to verify. Customers pay at the desk or online now; a reference only shows here if one was sent before.')}</tbody></table></div></div>`;
  refreshView = renderVerify;
  view.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const bk = bookings.find((x) => x._id === b.dataset.id);
    if (b.dataset.act === 'verify') verifyDialog(bk, true); else verifyDialog(bk, false);
  };
}

function verifyDialog(b, approve) {
  openModal(approve ? 'Verify payment' : 'Reject payment', `
    <form id="vForm">
      <p>${approve ? 'Confirm you received' : 'Reject the payment of'} <b class="num">${money(b.totalFee)}</b> for <b class="num">${esc(b.referenceNumber)}</b>.<br>
      <span class="muted">Their reference: <b class="num">${esc(b.paymentReference)}</b></span></p>
      ${approve ? '' : field('Reason (the customer will see this)', '<input name="note" maxlength="200" placeholder="e.g. Reference number not found" required />')}
      <div class="dlg-foot"><button type="button" class="btn" id="vCancel">Cancel</button>
      <button type="submit" class="btn ${approve ? 'primary' : 'solid-danger'}">${approve ? 'Mark as paid' : 'Reject payment'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#vCancel').onclick = closeModal;
  onSubmit($('#vForm'), async (data) => {
    await api(`/bookings/${b._id}/verify-payment`, { method: 'POST', body: { approve, note: data.note }, version: b.writeTS });
    toast(approve ? 'Payment verified' : 'Payment rejected');
    closeModal(); refreshView();
  });
}

/* =====================================================================
   AF-122 Refund Management
   ===================================================================== */
EXTRA.views.refunds = { label: 'Refunds', perm: 'payments', render: renderRefunds };

/** What the cancellation policy says to give back (bookings from before the policy: the full fee). */
const refundDueOf = (b) => (b.refundDue != null ? b.refundDue : b.totalFee);

async function renderRefunds() {
  setHead('Refunds', 'Paid bookings that were cancelled or not approved. The cancellation policy says how much goes back.');
  const { eligible, kept = [], done } = await api('/refunds');
  const table = (rows, head, body, empty) => `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.length ? rows.map(body).join('') : emptyRow(head.split('</th>').length - 1, empty)}</tbody></table></div>`;
  view.innerHTML = `
    <div class="card" style="margin-bottom:16px;"><h2>Ready to refund <span class="muted">(${eligible.length})</span></h2>
      ${table(eligible, '<th>Booking</th><th>Customer</th><th>Status</th><th class="r">Paid</th><th class="r">To refund</th><th></th>',
        (b) => `<tr><td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">${esc(courtOf(b))} &middot; ${fmtDate(b.date)}</span></td>
          <td>${esc(custName(b))}</td><td>${pillS(b.status)}${b.statusReason ? `<span class="sub">${esc(b.statusReason)}</span>` : ''}</td>
          <td class="r num">${money(b.totalFee)}</td>
          <td class="r num"><b>${money(refundDueOf(b))}</b><span class="sub">${esc(b.refundRule || 'Full refund')}</span></td>
          <td class="r"><button class="btn small danger" data-id="${esc(b._id)}">Refund...</button></td></tr>`,
        'No cancelled bookings are waiting for a refund.')}
    </div>
    ${kept.length ? `<div class="card" style="margin-bottom:16px;"><h2>Not refunded under the policy <span class="muted">(${kept.length})</span></h2>
      <p class="sub" style="padding:0 18px;">Cancelled too close to the start time for a refund. You can still refund one as a goodwill gesture.</p>
      ${table(kept, '<th>Booking</th><th>Customer</th><th class="r">Paid</th><th>Why</th><th></th>',
        (b) => `<tr><td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">${esc(courtOf(b))} &middot; ${fmtDate(b.date)}</span></td>
          <td>${esc(custName(b))}</td><td class="r num">${money(b.totalFee)}</td><td class="muted">${esc(b.refundRule || '')}</td>
          <td class="r"><button class="btn small" data-kept="${esc(b._id)}">Refund anyway...</button></td></tr>`, '')}
    </div>` : ''}
    <div class="card"><h2>Refund history</h2>
      ${table(done, '<th>Booking</th><th>Customer</th><th>Refunded</th><th>Reason</th><th>When</th>',
        (b) => `<tr><td class="num"><b>${esc(b.referenceNumber)}</b></td><td>${esc(custName(b))}</td>
          <td class="num">${money((b.refund && b.refund.amount) || b.totalFee)}<span class="sub">of ${money(b.totalFee)}</span></td>
          <td>${esc((b.refund && b.refund.reason) || '-')}</td><td>${b.refund && b.refund.at ? esc(ago(b.refund.at)) : '-'}</td></tr>`,
        'No refunds yet.')}
    </div>`;
  refreshView = renderRefunds;
  view.onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) refundDialog(eligible.find((x) => x._id === btn.dataset.id));
    const anyway = e.target.closest('button[data-kept]');
    if (anyway) refundDialog(kept.find((x) => x._id === anyway.dataset.kept), { anyway: true });
  };
}

function refundDialog(b, { anyway = false } = {}) {
  if (!b) return;
  const due = anyway || !(refundDueOf(b) > 0) ? b.totalFee : refundDueOf(b);
  const policy = b.refundRule ? `<p class="sub">Cancellation policy: ${esc(b.refundRule)}${b.refundDue != null ? ` (${money(b.refundDue)})` : ''}.</p>` : '';
  openModal(anyway ? 'Refund anyway' : 'Refund payment', `
    <form id="rfForm">
      <p>Booking <b class="num">${esc(b.referenceNumber)}</b> for ${esc(custName(b))}. The customer paid <b class="num">${money(b.totalFee)}</b>.</p>
      ${policy}
      ${field('Refund amount (₱)', `<input name="amount" type="number" min="1" max="${b.totalFee}" step="1" value="${due}" required />`, 'Lower it for a partial refund.')}
      ${field('Reason', `<input name="reason" maxlength="200" value="${esc(b.statusReason ? 'Booking ' + b.status + ': ' + b.statusReason : 'Booking ' + b.status)}" required />`)}
      <div class="dlg-foot"><button type="button" class="btn" id="rfCancel">Cancel</button><button type="submit" class="btn solid-danger">Process refund</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#rfCancel').onclick = closeModal;
  onSubmit($('#rfForm'), async (data) => {
    await api(`/bookings/${b._id}/refund`, { method: 'POST', body: { amount: Number(data.amount), reason: data.reason }, version: b.writeTS });
    toast('Refund recorded; the customer was notified');
    closeModal(); renderRefunds(); 
  });
}

/* =====================================================================
   AF-123 Transaction History
   ===================================================================== */
EXTRA.views.transactions = { label: 'Transactions', perm: 'payments', render: renderTransactions };
const TX_DEFAULTS = { page: 1, type: '', q: '', from: '', to: '' };
const tx = { ...TX_DEFAULTS };

async function renderTransactions(params) {
  const go = bindState(tx, TX_DEFAULTS, params); // #/transactions?type=refund&page=2
  setHead('Transactions', 'Every payment, refund and failed payment, newest first', '<button class="btn" id="txCsv" type="button" title="Every transaction matching the filters, as a spreadsheet">Export CSV</button>');
  $('#txCsv').onclick = () => downloadFile(`/transactions?${qsOf({ format: 'csv', type: tx.type, q: tx.q, from: tx.from, to: tx.to })}`, 'transactions.csv', $('#txCsv'))
    .catch((e) => toast(e.message, true));
  view.innerHTML = `
    <div class="card ribbon cols3" id="txTotals"></div>
    <div class="bar">
      <input class="grow" id="tQ" type="search" placeholder="Search reference, customer name or email (press /)" value="${esc(tx.q)}" aria-label="Search transactions" />
      <select id="tType" aria-label="Type"><option value="">All types</option>${optionList([['payment', 'Payments'], ['refund', 'Refunds'], ['failed', 'Failed']], tx.type)}</select>
      <label class="inl">From <input type="date" id="tFrom" value="${esc(tx.from)}" aria-label="From date" /></label>
      <label class="inl">To <input type="date" id="tTo" value="${esc(tx.to)}" aria-label="To date" /></label>
    </div>
    <div class="card" id="listCard"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i><i></i></div></div>`;
  async function load() {
    const d = await api(`/transactions?${qsOf({ page: tx.page, limit: 20, type: tx.type, q: tx.q, from: tx.from, to: tx.to })}`);
    if (d.page > d.pages) { tx.page = d.pages; stateTo(tx, TX_DEFAULTS, { push: false }); return load(); }
    $('#txTotals').innerHTML = !d.totals ? `<div style="grid-column:1/-1;"><div class="k">Totals</div>
        <p style="margin:6px 0 0;">Pick From and To dates (up to 31 days) to see the totals, e.g. today for your shift. <button class="btn small" type="button" id="txToday">Show today</button></p></div>`
      : `<div><div class="k">Payments received</div><div class="v num">${money(d.totals.payment)}</div></div>
      <div><div class="k">Refunded</div><div class="v num">${money(d.totals.refund)}</div></div>
      <div><div class="k">Net</div><div class="v num">${money(d.totals.payment - d.totals.refund)}</div></div>`;
    const typePill = (t) => pillX(`t-${t}`, { payment: 'Payment', refund: 'Refund', failed: 'Failed' }[t]);
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>When</th><th>Booking</th><th>Customer</th><th>Type</th><th class="r">Amount</th><th>Recorded by</th></tr></thead>
      <tbody>${d.transactions.length ? d.transactions.map((t) => `<tr>
        <td>${esc(ago(t.createdAt))}</td>
        <td class="num"><b>${esc(t.referenceNumber)}</b><span class="sub">${esc(t.courtName)}</span></td>
        <td>${t.user ? esc(t.user.firstName + ' ' + t.user.lastName) : t.customerName ? `${esc(t.customerName)} (walk-in)` : 'Deleted user'}</td>
        <td>${typePill(t.type)}${t.note ? `<span class="sub">${esc(t.note)}</span>` : ''}</td>
        <td class="r num ${t.type === 'refund' ? 'neg' : ''}">${t.type === 'refund' ? '−' : ''}${money(t.amount)}</td>
        <td>${t.recordedBy ? esc(t.recordedBy.firstName + ' ' + t.recordedBy.lastName) : '-'}</td></tr>`).join('')
        : emptyRow(6, 'No transactions match these filters.')}</tbody></table></div>${pager2(d, 'transaction')}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { tx.q = $('#tQ').value.trim(); tx.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'tQ') search(); };
  view.onchange = (e) => {
    if (e.target.id === 'tType') tx.type = e.target.value;
    else if (e.target.id === 'tFrom') tx.from = e.target.value;
    else if (e.target.id === 'tTo') tx.to = e.target.value;
    else return;
    tx.page = 1; go();
  };
  view.onclick = (e) => {
    if (e.target.closest('#txToday')) { tx.from = todayStr(); tx.to = todayStr(); tx.page = 1; $('#tFrom').value = tx.from; $('#tTo').value = tx.to; go(); return; }
    const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { tx.page = Number(pg.dataset.page); go(); }
  };
}

/* =====================================================================
   AF-124 Customer Booking History (opened from the Customers list)
   ===================================================================== */
async function openHistory(userId) {
  openModal('Booking history', '<div class="skeleton"><i></i><i></i><i></i></div>', { wide: true });
  try {
    const d = await api(`/users/${userId}/bookings`);
    const u = d.user; const t = d.totals;
    modalBody.innerHTML = `
      <p style="margin:12px 0 4px;"><b>${esc(u.firstName)} ${esc(u.lastName)}</b> ${pillA(u.isActive)}<br>
      <span class="muted">${esc(u.email)}${u.phone ? ' &middot; ' + esc(u.phone) : ''} &middot; joined ${esc(fmtDate(u.createdAt))}</span></p>
      <div class="mini">${[['Bookings', t.count], ['Upcoming', t.upcoming], ['Completed', t.completed], ['Cancelled', t.cancelled], ['Paid so far', money(t.spent)]]
        .map(([k, v]) => `<div><span>${k}</span><b class="num">${v}</b></div>`).join('')}</div>
      <div class="tablewrap" style="max-height:320px;overflow:auto;"><table>
        <thead><tr><th>Reference</th><th>Court</th><th>Date and time</th><th>Status</th><th>Payment</th><th class="r">Fee</th></tr></thead>
        <tbody>${d.bookings.length ? d.bookings.map((b) => `<tr class="click" data-id="${esc(b._id)}">
          <td class="num"><b>${esc(b.referenceNumber)}</b></td><td>${esc(b.courtName)}</td>
          <td>${fmtDate(b.date)}<span class="sub num">${esc(b.startTime)}–${esc(b.endTime)}</span></td>
          <td>${pillS(b.status)}</td><td>${pillP(b.paymentStatus)}</td><td class="r num">${money(b.totalFee)}</td></tr>`).join('')
          : emptyRow(6, 'This customer has not booked yet.')}</tbody></table></div>
      <div class="dlg-foot"><button type="button" class="btn" id="hClose">Close</button></div>`;
    $('#hClose').onclick = closeModal;
    modalBody.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && can('bookings')) { closeModal(); openBooking(tr.dataset.id); } };
  } catch (err) { modalBody.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

/* =====================================================================
   AF-125 Notifications Management
   ===================================================================== */
EXTRA.views.notifications = { label: 'Notifications', perm: 'notifications', render: renderNotifications };

async function renderNotifications() {
  setHead('Notifications', 'Send a message that shows up on customers’ dashboards');
  const [{ users }, { sent }] = await Promise.all([api('/users?type=customers&active=true'), api('/notifications')]);
  view.innerHTML = `
    <div class="grid2" style="grid-template-columns:1fr 1.2fr;">
      <div class="card"><div class="pad"><form id="nForm">
        ${field('Send to', `<select name="audience" id="nAud">${optionList([['all', 'All active customers'], ['upcoming', 'Customers with upcoming bookings'], ['user', 'One customer']], 'all')}</select>`)}
        <div id="nUserWrap" class="hidden">${field('Customer', `<select name="userId">${optionList(users.map((u) => [u.id, `${u.firstName} ${u.lastName} (${u.email})`]), '')}</select>`)}</div>
        ${field('Message', '<textarea name="message" rows="4" maxlength="300" placeholder="e.g. Court 2 will be closed tomorrow for resurfacing." required></textarea>', 'Up to 300 characters. Good for booking, payment, schedule or system updates.')}
        <div class="dlg-foot"><button type="submit" class="btn primary">Send notification</button></div>
        <div class="msg error hidden" role="alert"></div>
      </form></div></div>
      <div class="card"><h2>Recently sent</h2><div class="tablewrap"><table>
        <thead><tr><th>Message</th><th class="r">Sent to</th><th class="r">Read</th></tr></thead>
        <tbody>${sent.length ? sent.map((s) => `<tr><td>${esc(s.message)}<span class="sub">${esc(s.sentBy)} &middot; ${esc(ago(s.at))}</span></td>
          <td class="r num">${s.recipients}</td><td class="r num">${s.read}</td></tr>`).join('') : emptyRow(3, 'Nothing sent yet.')}</tbody></table></div></div>
    </div>`;
  const aud = $('#nAud');
  aud.onchange = () => $('#nUserWrap').classList.toggle('hidden', aud.value !== 'user');
  onSubmit($('#nForm'), async (data) => {
    const r = await api('/notifications', { method: 'POST', body: data });
    toast(`Sent to ${r.sent} customer${r.sent === 1 ? '' : 's'}`);
    renderNotifications();
  });
}

/* =====================================================================
   AF-126 Announcements Management
   ===================================================================== */
EXTRA.views.announcements = { label: 'Announcements', perm: 'announcements', render: renderAnnouncements };

async function renderAnnouncements() {
  setHead('Announcements', 'News for customers (their dashboard) and instructions for staff (their console). Both are told when you publish.', '<button class="btn primary" id="newAnn" type="button">New announcement</button>');
  const { announcements: list } = await api('/announcements');
  view.innerHTML = list.length ? list.map((a) => `<div class="card note-card" data-id="${esc(a._id)}">
      <div class="pad"><div class="row-between"><b>${esc(a.title)}</b><span>${pillX({ staff: 'r-staff', everyone: 'r-admin' }[a.audience] || 'r-user', { staff: 'For staff', everyone: 'For everyone' }[a.audience] || 'For customers')} ${pillX(a.published ? 'u-active' : 'u-off', a.published ? 'Published' : 'Draft')}</span></div>
      <p class="pre">${esc(a.body)}</p>
      <div class="row-between"><span class="muted">${a.published && a.publishedAt ? 'Published ' + esc(fmtStamp(a.publishedAt)) : 'Created ' + esc(fmtStamp(a.createdAt))}</span>
      <div class="btnrow"><button class="btn small" data-act="edit">Edit</button>
        <button class="btn small ${a.published ? '' : 'primary'}" data-act="toggle">${a.published ? 'Unpublish' : 'Publish'}</button>
        <button class="btn small danger" data-act="del">Delete</button></div></div></div></div>`).join('')
    : '<div class="card"><div class="empty">No announcements yet. Create one to tell customers about closures, events or new rules.</div></div>';
  refreshView = renderAnnouncements;
  $('#newAnn').onclick = () => announcementForm(null);
  view.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = list.find((x) => x._id === b.closest('[data-id]').dataset.id);
    if (b.dataset.act === 'edit') announcementForm(a);
    if (b.dataset.act === 'toggle') api(`/announcements/${a._id}/publish`, { method: 'PATCH', body: { published: !a.published }, version: a.writeTS }).then(() => { toast(a.published ? 'Unpublished' : 'Published'); refreshView(); }).catch((x) => toast(x.message, true));
    if (b.dataset.act === 'del') confirmDelete(`Delete “${a.title}”?`, () => api(`/announcements/${a._id}`, { method: 'DELETE', version: a.writeTS }).then(() => { toast('Deleted'); refreshView(); }));
  };
}

function announcementForm(a) {
  openModal(a ? 'Edit announcement' : 'New announcement', `
    <form id="aForm">
      ${field('Title', `<input name="title" maxlength="120" value="${esc(a ? a.title : '')}" required />`)}
      ${field('Message', `<textarea name="body" rows="5" maxlength="2000" required>${esc(a ? a.body : '')}</textarea>`)}
      ${field('Who sees it', `<select name="audience">${optionList([['customers', 'Customers (their dashboard)'], ['staff', 'Staff only (instructions in the console)'], ['everyone', 'Everyone']], a ? a.audience || 'customers' : 'customers')}</select>`)}
      ${a ? '' : '<label class="chk"><input type="checkbox" name="published" checked /> Publish right away</label>'}
      <div class="dlg-foot"><button type="button" class="btn" id="aCancel">Cancel</button><button type="submit" class="btn primary">${a ? 'Save changes' : 'Create'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#aCancel').onclick = closeModal;
  onSubmit($('#aForm'), async (data) => {
    await api(a ? `/announcements/${a._id}` : '/announcements', { method: a ? 'PUT' : 'POST', body: data, version: a ? a.writeTS : undefined });
    toast(a ? 'Announcement saved' : 'Announcement created');
    closeModal(); refreshView();
  });
}

function confirmDelete(text, run) {
  openModal('Please confirm', `<p>${esc(text)} This can't be undone.</p>
    <div class="dlg-foot"><button type="button" class="btn" id="cdNo">Keep it</button><button type="button" class="btn solid-danger" id="cdYes">Delete</button></div>`);
  $('#cdNo').onclick = closeModal;
  $('#cdYes').onclick = async () => { try { await run(); closeModal(); } catch (e) { toast(e.message, true); } };
}

/* =====================================================================
   AF-127 Promotions and Discounts
   ===================================================================== */
EXTRA.views.promotions = { label: 'Promotions', perm: 'promotions', render: renderPromotions };

const promoState = (p) => {
  if (!p.active) return ['u-off', 'Off'];
  const now = Date.now();
  if (p.startsAt && new Date(p.startsAt) > now) return ['s-pending', 'Scheduled'];
  if (p.endsAt && new Date(p.endsAt) < now) return ['s-cancelled', 'Ended'];
  if (p.usageLimit && p.usedCount >= p.usageLimit) return ['s-cancelled', 'Used up'];
  return ['u-active', 'Live'];
};

async function renderPromotions() {
  setHead('Promotions', 'Discount codes customers can enter when they book', '<button class="btn primary" id="newPromo" type="button">New promotion</button>');
  const { promotions: list } = await api('/promotions');
  view.innerHTML = `<div class="card"><div class="tablewrap"><table>
    <thead><tr><th>Code</th><th>Offer</th><th>Runs</th><th class="r">Used</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.length ? list.map((p) => { const [cls, txt] = promoState(p); return `<tr>
      <td class="num"><b>${esc(p.code)}</b></td>
      <td>${esc(p.title)}<span class="sub">${p.type === 'percent' ? p.value + '% off' : money(p.value) + ' off'}${p.description ? ' &middot; ' + esc(p.description) : ''}</span></td>
      <td>${p.startsAt ? esc(fmtDate(p.startsAt)) : 'Now'} – ${p.endsAt ? esc(fmtDate(p.endsAt)) : 'No end'}</td>
      <td class="r num">${p.usedCount}${p.usageLimit ? ' / ' + p.usageLimit : ''}</td>
      <td>${pillX(cls, txt)}</td>
      <td class="r"><div class="btnrow" style="justify-content:flex-end;" data-id="${esc(p._id)}">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small" data-act="toggle">${p.active ? 'Turn off' : 'Turn on'}</button>
        <button class="btn small danger" data-act="del">Delete</button></div></td></tr>`; }).join('')
      : emptyRow(6, 'No promotions yet. Create a code like WELCOME10 for 10% off.')}</tbody></table></div></div>`;
  refreshView = renderPromotions;
  $('#newPromo').onclick = () => promoForm(null);
  view.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = list.find((x) => x._id === b.parentElement.dataset.id);
    if (b.dataset.act === 'edit') promoForm(p);
    if (b.dataset.act === 'toggle') api(`/promotions/${p._id}/active`, { method: 'PATCH', body: { active: !p.active }, version: p.writeTS }).then(() => { toast(p.active ? 'Promotion turned off' : 'Promotion turned on'); refreshView(); }).catch((x) => toast(x.message, true));
    if (b.dataset.act === 'del') confirmDelete(`Delete promotion ${p.code}?`, () => api(`/promotions/${p._id}`, { method: 'DELETE', version: p.writeTS }).then(() => { toast('Deleted'); refreshView(); }));
  };
}

function promoForm(p) {
  const v = p || { code: '', title: '', description: '', type: 'percent', value: 10, startsAt: '', endsAt: '', usageLimit: 0 };
  openModal(p ? 'Edit promotion' : 'New promotion', `
    <form id="pForm">
      <div class="row2">${field('Code', `<input name="code" maxlength="20" value="${esc(v.code)}" placeholder="WELCOME10" required style="text-transform:uppercase" />`, 'Letters and numbers; customers type this.')}
      ${field('Title', `<input name="title" maxlength="100" value="${esc(v.title)}" placeholder="Welcome offer" required />`)}</div>
      <div class="row2">${field('Discount type', `<select name="type">${optionList([['percent', 'Percent off'], ['fixed', 'Peso amount off']], v.type)}</select>`)}
      ${field('Value', `<input name="value" type="number" min="1" step="1" value="${esc(v.value)}" required />`)}</div>
      <div class="row2">${field('Starts', `<input name="startsAt" type="date" value="${v.startsAt ? toDateStr(v.startsAt) : ''}" />`, 'Leave empty to start now.')}
      ${field('Ends', `<input name="endsAt" type="date" value="${v.endsAt ? toDateStr(v.endsAt) : ''}" />`, 'Leave empty for no end date.')}</div>
      ${field('Limit total uses', `<input name="usageLimit" type="number" min="0" step="1" value="${esc(v.usageLimit || 0)}" />`, '0 means unlimited.')}
      ${field('Description (optional)', `<input name="description" maxlength="500" value="${esc(v.description)}" />`)}
      <div class="dlg-foot"><button type="button" class="btn" id="pCancel">Cancel</button><button type="submit" class="btn primary">${p ? 'Save changes' : 'Create promotion'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#pCancel').onclick = closeModal;
  onSubmit($('#pForm'), async (data) => {
    await api(p ? `/promotions/${p._id}` : '/promotions', { method: p ? 'PUT' : 'POST', body: data, version: p ? p.writeTS : undefined });
    toast(p ? 'Promotion saved' : 'Promotion created');
    closeModal(); refreshView();
  });
}

/* =====================================================================
   AF-128 Feedback Management
   ===================================================================== */
EXTRA.views.feedback = { label: 'Feedback', perm: 'feedback.view', render: renderFeedback };
const FB_DEFAULTS = { page: 1, rating: '', status: '' };
const fbUi = { ...FB_DEFAULTS };
const FB_LABEL = { new: 'New', reviewed: 'Reviewed', hidden: 'Hidden' };
const FB_CLASS = { new: 's-pending', reviewed: 'u-active', hidden: 'u-off' };

async function renderFeedback(params) {
  const go = bindState(fbUi, FB_DEFAULTS, params); // #/feedback?rating=1&page=2
  setHead('Feedback', can('feedback') ? 'Ratings and comments from completed bookings' : 'What customers said about their games and the facility (read only)');
  view.innerHTML = `<div class="grid2" style="grid-template-columns:1fr 2fr;" id="fbTop"></div>
    <div class="bar"><select id="fRating" aria-label="Rating"><option value="">Any rating</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${String(fbUi.rating) === String(n) ? ' selected' : ''}>${n} star${n > 1 ? 's' : ''}</option>`).join('')}</select>
    <select id="fStatus" aria-label="Status"><option value="">Any status</option>${optionList(Object.entries(FB_LABEL).filter(([k]) => can('feedback') || k !== 'hidden'), fbUi.status)}</select></div>
    <div id="fbList"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i></div></div>`;
  let items = [];
  async function load() {
    const d = await api(`/feedback?${qsOf({ page: fbUi.page, limit: 15, rating: fbUi.rating, status: fbUi.status })}`);
    if (d.page > d.pages) { fbUi.page = d.pages; stateTo(fbUi, FB_DEFAULTS, { push: false }); return load(); }
    items = d.feedback;
    const max = Math.max(1, ...Object.values(d.stars));
    $('#fbTop').innerHTML = `<div class="card"><div class="pad center"><div class="big num">${d.count ? d.average.toFixed(1) : '–'}</div>${stars(Math.round(d.average))}<div class="muted">${d.count} visible rating${d.count === 1 ? '' : 's'}</div></div></div>
      <div class="card"><div class="pad"><div class="hbars">${[5, 4, 3, 2, 1].map((n) => `<div class="hb"><span class="hl">${n} ★</span><span class="ht"><i style="width:${Math.round((d.stars[n] / max) * 100)}%"></i></span><b class="num">${d.stars[n]}</b></div>`).join('')}</div></div></div>`;
    $('#fbList').innerHTML = items.length ? `<div class="card">${items.map((f) => `<div class="fb ${f.status === 'hidden' ? 'dim' : ''}" data-id="${esc(f._id)}">
        <div class="row-between"><div>${stars(f.rating)} <b>${esc(f.user ? f.user.firstName + ' ' + f.user.lastName : 'Deleted user')}</b>
          <span class="muted"> &middot; ${esc(f.courtName)}${f.booking ? ' &middot; ' + esc(f.booking.referenceNumber) : ''}</span></div>${pillX(FB_CLASS[f.status], FB_LABEL[f.status])}</div>
        ${f.comment ? `<p class="pre">${esc(f.comment)}</p>` : '<p class="muted">No comment left.</p>'}
        <div class="row-between"><span class="muted">${esc(fmtStamp(f.createdAt))}</span>${can('feedback') ? `<div class="btnrow">
          ${f.status !== 'reviewed' ? '<button class="btn small" data-set="reviewed">Mark reviewed</button>' : ''}
          ${f.status !== 'hidden' ? '<button class="btn small" data-set="hidden">Hide</button>' : '<button class="btn small" data-set="new">Show again</button>'}</div>` : ''}</div></div>`).join('')}
      ${pager2(d, 'review')}</div>`
      : '<div class="card"><div class="empty">No feedback matches. Customers can rate a booking once it is completed.</div></div>';
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  view.onchange = (e) => { if (e.target.id === 'fRating') fbUi.rating = e.target.value; else if (e.target.id === 'fStatus') fbUi.status = e.target.value; else return; fbUi.page = 1; go(); };
  view.onclick = async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { fbUi.page = Number(pg.dataset.page); return go(); }
    const b = e.target.closest('[data-set]');
    if (!b) return;
    try { await api(`/feedback/${b.closest('[data-id]').dataset.id}`, { method: 'PATCH', body: { status: b.dataset.set } }); refreshView(); } catch (x) { toast(x.message, true); }
  };
}

/* =====================================================================
   AF-129 Complaint / Issue Management
   ===================================================================== */
EXTRA.views.issues = { label: 'Issues', perm: 'issues', render: renderIssues };
const ISS_DEFAULTS = { status: 'open' };
const issUi = { ...ISS_DEFAULTS };
const ISS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

async function renderIssues(params) {
  setHead('Issues', 'Complaints and problems reported by customers');
  const go = bindState(issUi, ISS_DEFAULTS, params); // #/issues?status=resolved ("All" is status= )
  const d = await api(`/issues?${qsOf({ status: issUi.status })}`);
  view.innerHTML = `<div class="tabs" role="tablist">${[['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['', 'All']].map(([k, l]) =>
    `<button type="button" role="tab" class="${issUi.status === k ? 'on' : ''}" data-tab="${k}" aria-selected="${issUi.status === k}">${l}${k ? ` <span class="muted">${d.counts[k]}</span>` : ''}</button>`).join('')}</div>
    ${d.issues.length ? d.issues.map((i) => `<div class="card note-card" data-id="${esc(i._id)}"><div class="pad">
      <div class="row-between"><div><b>${esc(i.subject)}</b><div class="muted">${esc(i.user ? i.user.firstName + ' ' + i.user.lastName : 'Deleted user')} &middot; ${esc(i.category)} &middot; ${esc(fmtStamp(i.createdAt))}${i.booking ? ' &middot; ' + esc(i.booking.referenceNumber) : ''}</div></div>
        ${pillX('i-' + i.status, ISS_LABEL[i.status])}</div>
      <p class="pre">${esc(i.message)}</p>
      ${i.replies.length ? `<div class="thread">${i.replies.map((r) => `<div class="reply ${r.byRole === 'user' ? 'cust' : ''}"><b>${esc(r.byName || ROLE_LABEL[r.byRole])}</b> <span class="muted">${esc(fmtStamp(r.at))}</span><div class="pre">${esc(r.message)}</div></div>`).join('')}</div>` : ''}
      <div class="btnrow" style="margin-top:10px;"><button class="btn small primary" data-act="reply">Reply</button>
        ${i.status !== 'resolved' ? '<button class="btn small" data-act="resolve">Mark resolved</button>' : '<button class="btn small" data-act="reopen">Reopen</button>'}</div>
    </div></div>`).join('') : '<div class="card"><div class="empty">Nothing here. Reported problems will appear in this list.</div></div>'}`;
  refreshView = () => renderIssues(null); // same tab
  view.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { issUi.status = t.dataset.tab; return go(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const issue = d.issues.find((x) => x._id === b.closest('[data-id]').dataset.id);
    if (b.dataset.act === 'reply') return replyDialog(issue);
    const status = b.dataset.act === 'resolve' ? 'resolved' : 'open';
    api(`/issues/${issue._id}`, { method: 'PATCH', body: { status }, version: issue.writeTS }).then(() => { toast(status === 'resolved' ? 'Marked resolved' : 'Reopened'); refreshView(); }).catch((x) => toast(x.message, true));
  };
}

function replyDialog(issue) {
  openModal('Reply to customer', `
    <form id="iForm"><p class="muted">${esc(issue.subject)}</p>
      ${field('Your reply', '<textarea name="message" rows="5" maxlength="2000" required></textarea>', 'The customer is notified and sees this on their support page.')}
      <label class="chk"><input type="checkbox" name="resolve" /> Also mark as resolved</label>
      <div class="dlg-foot"><button type="button" class="btn" id="iCancel">Cancel</button><button type="submit" class="btn primary">Send reply</button></div>
      <div class="msg error hidden" role="alert"></div></form>`);
  $('#iCancel').onclick = closeModal;
  onSubmit($('#iForm'), async (data) => {
    await api(`/issues/${issue._id}/reply`, { method: 'POST', body: { message: data.message, status: data.resolve ? 'resolved' : 'in_progress' } });
    toast('Reply sent'); closeModal(); refreshView();
  });
}

/* =====================================================================
   AF-130 Check-in Management
   ===================================================================== */
EXTRA.views.checkins = { label: 'Check-ins', perm: 'checkins', render: renderCheckins };
const ciUi = { date: '' };

async function renderCheckins(params) {
  setHead('Check-ins', 'Record when customers arrive and leave', '<button class="btn primary" id="scanQr" type="button">Verify booking (QR or reference)</button>');
  $('#scanQr').onclick = openQrScanner;
  const go = bindState(ciUi, { date: '' }, params); // #/checkins?date=2026-11-20 (none = today)
  const d = await api(`/checkins?${qsOf({ date: ciUi.date })}`);
  ciUi.date = d.date;
  const isToday = d.date === todayStr();
  const inN = d.bookings.filter((b) => b.checkedInAt && !b.checkedOutAt).length;
  const doneN = d.bookings.filter((b) => b.checkedOutAt).length;
  const waitN = d.bookings.filter((b) => !b.checkedInAt).length;
  view.innerHTML = `
    <div class="bar"><label class="inl">Date <input type="date" id="cDate" value="${esc(d.date)}" /></label>
      <button class="btn" id="cToday" type="button" ${isToday ? 'disabled' : ''}>Today</button></div>
    <div class="card ribbon cols3"><div><div class="k">Waiting to arrive</div><div class="v num">${waitN}</div></div>
      <div><div class="k">On court now</div><div class="v num">${inN}</div></div><div><div class="k">Finished</div><div class="v num">${doneN}</div></div></div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Time</th><th>Customer</th><th>Court</th><th>Payment</th><th>Check-in</th><th></th></tr></thead>
      <tbody>${d.bookings.length ? d.bookings.map((b) => `<tr data-id="${esc(b._id)}">
        <td class="num"><b>${esc(b.startTime)}–${esc(b.endTime)}</b></td>
        <td>${esc(custName(b))}<span class="sub num">${esc(b.referenceNumber)}</span></td><td>${esc(courtOf(b))}</td><td>${pillP(b.paymentStatus)}</td>
        <td>${b.checkedOutAt ? `<span class="pill s-completed">Left ${esc(fmtStamp(b.checkedOutAt))}</span>` : b.checkedInAt ? `<span class="pill s-confirmed">In since ${esc(fmtStamp(b.checkedInAt))}</span>` : '<span class="muted">Not arrived</span>'}</td>
        <td class="r"><div class="btnrow" style="justify-content:flex-end;">
          ${!b.checkedInAt && isToday ? '<button class="btn small primary" data-act="in">Check in</button>' : ''}
          ${b.checkedInAt && !b.checkedOutAt ? '<button class="btn small" data-act="out">Check out</button>' : ''}
          ${b.checkedInAt && !b.checkedOutAt ? '<button class="btn small" data-act="undo">Undo</button>' : ''}</div></td></tr>`).join('')
        : emptyRow(6, 'No confirmed bookings on this date.')}</tbody></table></div></div>`;
  refreshView = () => renderCheckins(null); // same day
  view.onchange = (e) => { if (e.target.id === 'cDate' && e.target.value) { ciUi.date = e.target.value === todayStr() ? '' : e.target.value; go(); } };
  view.onclick = async (e) => {
    if (e.target.closest('#cToday')) { ciUi.date = ''; return go(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    try {
      await api(`/bookings/${b.closest('tr').dataset.id}/checkin`, { method: 'PATCH', body: { action: b.dataset.act } });
      refreshView();
    } catch (x) { toast(x.message, true); }
  };
}

/* ---------- QR check-in at the front desk ---------- */
let qrScanner = null;
function stopQrScanner() {
  if (qrScanner) { const s = qrScanner; qrScanner = null; s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) { /* ignore */ } }); }
}
const loadQrLib = () => (window.Html5Qrcode ? Promise.resolve() : new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  s.onload = resolve; s.onerror = () => reject(new Error('Scanner could not load'));
  document.head.appendChild(s);
}));

/**
 * SF-113 Booking Verification (QR code or reference), then SF-114 Check-in. Verifying changes nothing: it says whether
 * the booking is good to play now (confirmed, today, not over, not checked in yet), and offers "Check in now".
 */
function openQrScanner() {
  openModal('Verify a booking', `
    <div id="qrReader" class="qr-reader"><p class="muted" style="padding:24px;text-align:center;">Starting the camera…</p></div>
    <form id="qrManual" class="row2" style="margin-top:12px;align-items:end;">
      <label class="f" style="margin:0;">Or type the booking reference<input id="qrCode" placeholder="MKI-..." autocomplete="off" /></label>
      <button class="btn primary" type="submit">Verify</button>
    </form>
    <div id="qrResult" class="verify-card hidden" role="status" aria-live="assertive"></div>
    <div class="dlg-foot"><button class="btn" type="button" id="qrClose">Done</button></div>`);
  const result = $('#qrResult');
  const showError = (text) => { result.className = 'verify-card bad'; result.innerHTML = `<p class="verify-msg"><b>✕</b> ${esc(text)}</p>`; };
  const showVerdict = (b, v) => {
    const canIn = can('checkins') && v.ok && !b.checkedInAt && toDateStr(b.date) === todayStr();
    result.className = `verify-card ${v.level}`;
    result.innerHTML = `<p class="verify-msg"><b>${v.level === 'ok' ? '✓' : v.level === 'bad' ? '✕' : '!'}</b> ${esc(v.message)}</p>
      <dl class="kv"><dt>Reference</dt><dd class="num">${esc(b.referenceNumber)}</dd><dt>Customer</dt><dd>${esc(custName(b))}</dd>
        <dt>Court</dt><dd>${esc(courtOf(b))}</dd><dt>When</dt><dd class="num">${fmtDate(b.date)}, ${esc(b.startTime)}–${esc(b.endTime)}</dd>
        <dt>Status</dt><dd>${pillS(b.status)} ${pillP(b.paymentStatus)}</dd></dl>
      <div class="btnrow">${canIn ? '<button class="btn primary" type="button" data-vact="in">Check in now</button>' : ''}${can('bookings') ? '<button class="btn" type="button" data-vact="open">Open booking</button>' : ''}</div>`;
    result.onclick = async (e) => {
      const btn = e.target.closest('[data-vact]');
      if (!btn) return;
      if (btn.dataset.vact === 'open') { stopQrScanner(); openBooking(b._id); return; }
      btn.disabled = true;
      try {
        await api(`/bookings/${b._id}/checkin`, { method: 'PATCH', body: { action: 'in' }, version: b.writeTS });
        result.className = 'verify-card ok';
        result.innerHTML = `<p class="verify-msg"><b>✓</b> ${esc(custName(b))} checked in: ${esc(courtOf(b))}, ${esc(b.startTime)}–${esc(b.endTime)}</p>`;
        if (typeof refreshView === 'function') refreshView();
      } catch (err) { btn.disabled = false; showError(err.message); }
    };
  };
  let busy = false;
  let last = { code: '', at: 0 };
  const submit = async (code) => {
    code = String(code || '').trim();
    if (!code || busy) return;
    if (code === last.code && Date.now() - last.at < 4000) return; // the camera reads the same code many times a second
    last = { code, at: Date.now() };
    busy = true;
    try {
      const r = await api('/bookings/verify', { method: 'POST', body: { code } });
      showVerdict(r.booking, r.verdict);
    } catch (e) { showError(e.message); }
    busy = false;
  };
  $('#qrManual').onsubmit = (e) => { e.preventDefault(); submit($('#qrCode').value); $('#qrCode').value = ''; };
  $('#qrClose').onclick = () => { stopQrScanner(); closeModal(); };
  const dlgEl = document.getElementById('modalTitle').closest('dialog');
  if (dlgEl) dlgEl.addEventListener('close', stopQrScanner, { once: true });

  loadQrLib().then(() => {
    if (!$('#qrReader')) return;
    qrScanner = new Html5Qrcode('qrReader');
    return qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => submit(text), () => {});
  }).catch(() => {
    const box = $('#qrReader');
    if (box) box.innerHTML = '<p class="muted" style="padding:16px;text-align:center;">Camera not available here (it needs https or localhost and camera permission). Type the reference below instead.</p>';
  });
}

/* =====================================================================
   AF-131 Reports
   ===================================================================== */
EXTRA.views.reports = { label: 'Reports', perm: 'reports', render: renderReports };
const repUi = { type: 'bookings', from: '', to: '' }; // dates filled on first render (admin.js loads after this file)
const REPORT_TYPES = [['bookings', 'Bookings'], ['payments', 'Payments'], ['transactions', 'Transactions'], ['users', 'New customers'], ['courts', 'Courts']];

async function renderReports(params) {
  const go = bindState(repUi, { type: 'bookings', ...rangeDefaults(30) }, params); // #/reports?type=payments&from=...&to=...
  if (!REPORT_TYPES.some(([k]) => k === repUi.type)) repUi.type = 'bookings';
  if (!repUi.from) Object.assign(repUi, rangeDefaults(30));
  setHead('Reports', 'Pick a report and a date range, then download it for Excel or print / save it as a PDF',
    '<button class="btn" id="csvRep" type="button" title="Every row, numbers ready to add up in Excel or Google Sheets">Download CSV</button><button class="btn" id="printRep" type="button">Print / save PDF</button>');
  $('#csvRep').onclick = () => downloadFile(`/reports/${repUi.type}?${qsOf({ from: repUi.from, to: repUi.to, format: 'csv' })}`, `${repUi.type}-report.csv`, $('#csvRep'))
    .catch((e) => toast(e.message, true));
  view.innerHTML = `<div class="bar"><select id="rType" aria-label="Report">${optionList(REPORT_TYPES, repUi.type)}</select>${dateFields(repUi)}
    <button class="btn primary" id="rGo" type="button">Generate</button></div><div id="repOut"></div>`;
  async function run() {
    $('#repOut').innerHTML = '<div class="card"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>';
    try {
      const r = await api(`/reports/${repUi.type}?${qsOf({ from: repUi.from, to: repUi.to })}`);
      $('#repOut').innerHTML = `<div class="card" id="repCard"><div class="pad"><h2 style="padding:0;">${esc(r.title)}</h2>
        <div class="muted">${esc(fmtDate(r.from + 'T00:00:00+08:00'))} to ${esc(fmtDate(r.to + 'T00:00:00+08:00'))} &middot; ${r.rows.length} row${r.rows.length === 1 ? '' : 's'}</div>
        <div class="mini">${r.summary.map((s) => `<div><span>${esc(s.label)}</span><b class="num">${esc(s.value)}</b></div>`).join('')}</div></div>
        <div class="tablewrap"><table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${r.rows.length ? r.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : emptyRow(r.columns.length, 'No records in this date range.')}</tbody></table></div>
        ${r.truncated ? '<div class="pad muted">Showing the first 2,000 rows. Narrow the date range to see the rest.</div>' : ''}</div>`;
    } catch (e) { $('#repOut').innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`; }
  }
  refreshView = run;
  run();
  view.onchange = (e) => { if (e.target.id === 'rType') repUi.type = e.target.value; else if (e.target.id === 'rFrom') repUi.from = e.target.value; else if (e.target.id === 'rTo') repUi.to = e.target.value; else return; go(); };
  $('#printRep').onclick = () => window.print();
}

/* =====================================================================
   AF-132 / AF-133 / AF-134  Analytics (bookings, revenue, users)
   ===================================================================== */
EXTRA.views.analytics = { label: 'Analytics', perm: 'analytics', render: renderAnalytics };
const anUi = { tab: 'bookings', from: '', to: '' };
const kpi = (k, v, s = '') => `<div><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;

async function renderAnalytics(params) {
  const go = bindState(anUi, { tab: 'bookings', ...rangeDefaults(30) }, params); // #/analytics?tab=revenue&from=...&to=...
  if (!['bookings', 'revenue', 'users'].includes(anUi.tab)) anUi.tab = 'bookings';
  if (!anUi.from) Object.assign(anUi, rangeDefaults(30));
  const titles = { bookings: 'Booking analytics', revenue: 'Revenue analytics', users: 'User analytics' };
  setHead(titles[anUi.tab], 'Trends for the date range you choose');
  const preset = (n) => `<button type="button" class="btn small" data-days="${n}">Last ${n} days</button>`;
  view.innerHTML = `<div class="bar">${dateFields(anUi)}${preset(7)}${preset(30)}${preset(90)}</div><div id="anOut"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;
  async function run() {
    try {
      const d = await api(`/analytics/${anUi.tab}?${qsOf({ from: anUi.from, to: anUi.to })}`);
      let html = '';
      if (anUi.tab === 'bookings') {
        html = `<div class="card ribbon">${kpi('Bookings', d.totals.active, 'excluding cancelled')}${kpi('Cancelled', d.totals.cancelled, d.totals.rejected + ' rejected')}
          ${kpi('Cancellation rate', d.totals.cancellationRate + '%', 'of all requests')}${kpi('All requests', d.totals.all, 'in this range')}</div>
          <div class="card"><h2>Bookings per day</h2>${columns(d.perDay.length, d.perDay, 'count')}</div>
          <div class="grid2" style="grid-template-columns:1fr 1fr;margin-top:16px;">
            <div class="card"><h2>Most booked courts</h2><div class="pad">${hbars(d.byCourt.map((c) => ({ label: c.name, v: c.count })), String, 'No bookings in this range.')}</div></div>
            <div class="card"><h2>Peak hours</h2><div class="pad">${hbars(d.peakHours.map((h) => ({ label: h.hour, v: h.count })), String, 'No bookings in this range.')}</div></div></div>`;
      } else if (anUi.tab === 'revenue') {
        html = `<div class="card ribbon">${kpi('Collected', money(d.totals.gross), d.totals.payments + ' payments')}${kpi('Refunded', money(d.totals.refunded))}
          ${kpi('Net income', money(d.totals.net), 'collected minus refunds')}${kpi('Still to collect', money(d.totals.outstanding), 'unpaid bookings in range')}</div>
          <div class="card"><h2>Income per day</h2>${columns(d.perDay.length, d.perDay, 'amount')}<div class="legend"><span>Hover a bar for the amount. Average payment ${money(d.totals.average)}.</span></div></div>
          <div class="card" style="margin-top:16px;"><h2>Income by court</h2><div class="pad">${hbars(d.byCourt.map((c) => ({ label: c.name, v: c.amount })), money, 'No payments in this range.')}</div></div>`;
      } else {
        html = `<div class="card ribbon">${kpi('Registered customers', d.totals.total, d.totals.active + ' active, ' + d.totals.inactive + ' deactivated')}${kpi('New in range', d.totals.newUsers)}
          ${kpi('Booked in range', d.totals.activeBookers, d.totals.bookings + ' bookings')}${kpi('Repeat customers', d.totals.repeatCustomers, d.totals.neverBooked + ' never booked')}</div>
          <div class="card"><h2>New sign-ups per day</h2>${columns(d.perDay.length, d.perDay, 'count')}</div>
          <div class="card" style="margin-top:16px;"><h2>Most active customers</h2><div class="tablewrap"><table>
            <thead><tr><th>Customer</th><th class="r">Bookings</th><th class="r">Paid</th></tr></thead>
            <tbody>${d.top.length ? d.top.map((t) => `<tr><td>${esc(t.name)}<span class="sub">${esc(t.email)}</span></td><td class="r num">${t.bookings}</td><td class="r num">${money(t.spent)}</td></tr>`).join('') : emptyRow(3, 'No bookings in this range.')}</tbody></table></div></div>`;
      }
      $('#anOut').innerHTML = html;
    } catch (e) { $('#anOut').innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`; }
  }
  refreshView = run;
  run();
  view.onchange = (e) => { if (e.target.id === 'rFrom') anUi.from = e.target.value; else if (e.target.id === 'rTo') anUi.to = e.target.value; else return; go(); };
  view.onclick = (e) => {
    const p = e.target.closest('[data-days]');
    if (!p) return;
    Object.assign(anUi, rangeDefaults(Number(p.dataset.days)));
    $('#rFrom').value = anUi.from; $('#rTo').value = anUi.to; go();
  };
}

/* =====================================================================
   Login security: login history, failed attempts, locked accounts
   ===================================================================== */
EXTRA.views.logins = { label: 'Login security', perm: 'logins', render: renderLogins };
EXTRA.icons.logins = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/><circle cx="12" cy="16" r="1.4"/>';
const LG_DEFAULTS = { page: 1, q: '', result: '', portal: '', date: '' };
const lgUi = { ...LG_DEFAULTS };
const LOGIN_REASON = {
  ok: 'Signed in',
  wrong_password: 'Wrong password',
  unknown_email: 'No account with this email',
  deactivated: 'Account is deactivated',
  locked: 'Refused: account locked',
  locked_now: 'Wrong password, account now locked',
  no_admin_access: 'Customer account tried the admin console',
};
const loginPill = (l) => (l.success ? pillX('u-active', 'Success')
  : ['locked', 'locked_now'].includes(l.reason) ? pillX('s-pending', 'Locked') : pillX('p-failed', 'Failed'));
const ipLabel = (ip) => {
  const clean = String(ip || '').replace(/^::ffff:/, '');
  return ['::1', '127.0.0.1'].includes(clean) ? 'This computer' : (clean || 'unknown');
};
function deviceOf(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome/Brave' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const untilLabel = (d) => `${Math.max(1, Math.ceil((new Date(d).getTime() - Date.now()) / 60000))} min left`;

async function renderLogins(params) {
  const go = bindState(lgUi, LG_DEFAULTS, params); // #/logins?result=failed&page=2
  setHead('Login security', 'Who signed in, failed attempts and locked accounts');
  view.innerHTML = `<div id="lgTop"><div class="card"><div class="skeleton"><i></i><i></i></div></div></div>
    <div id="rlCard"></div>
    <div class="bar">
      <input class="grow" id="lgQ" type="search" placeholder="Search email, name or IP address" value="${esc(lgUi.q)}" aria-label="Search sign-ins" />
      <select id="lgResult" aria-label="Result">${optionList([['', 'All results'], ['success', 'Successful'], ['failed', 'Failed'], ['locked', 'Locked out']], lgUi.result)}</select>
      <select id="lgPortal" aria-label="Where">${optionList([['', 'Customer site and admin'], ['customer', 'Customer site'], ['admin', 'Admin console']], lgUi.portal)}</select>
      <label class="inl">Day <input type="date" id="lgDate" value="${esc(lgUi.date)}" /></label>
    </div>
    <div class="card" id="listCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;

  async function load() {
    const d = await api(`/logins?${qsOf({ page: lgUi.page, limit: 25, q: lgUi.q, result: lgUi.result, portal: lgUi.portal, date: lgUi.date })}`);
    if (d.page > d.pages) { lgUi.page = d.pages; stateTo(lgUi, LG_DEFAULTS, { push: false }); return load(); }
    const s = d.summary;
    $('#lgTop').innerHTML = `
      <div class="card ribbon">
        <div><div class="k">Successful sign-ins today</div><div class="v num">${s.today.success}</div><div class="s">customers and staff</div></div>
        <div class="${s.today.failed ? 'urgent' : ''}"><div class="k">Failed attempts today</div><div class="v num">${s.today.failed}</div><div class="s">wrong password or email</div></div>
        <div class="${s.locked.length ? 'urgent' : ''}"><div class="k">Locked accounts now</div><div class="v num">${s.locked.length}</div><div class="s">after ${s.policy.maxFailed} wrong passwords, for ${s.policy.lockMinutes} min</div></div>
        <div class="${s.suspiciousIps.length ? 'urgent' : ''}"><div class="k">Suspicious IP addresses</div><div class="v num">${s.suspiciousIps.length}</div><div class="s">${s.policy.maxFailed}+ failures in 24 hours</div></div>
      </div>
      ${s.locked.length ? `<div class="card" style="margin-bottom:16px;"><div class="pad"><h2 style="font-size:15px;margin-top:0;">Locked accounts</h2>
        <div class="tablewrap"><table><thead><tr><th>Account</th><th>Role</th><th>Unlocks</th><th></th></tr></thead><tbody>
        ${s.locked.map((u) => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.name)}</b><span class="sub">${esc(u.email)}</span></td><td>${pillR(u.role)}</td>
          <td>${esc(fmtStamp(u.lockUntil))}<span class="sub">${esc(untilLabel(u.lockUntil))}</span></td>
          <td style="text-align:right;"><button class="btn small" data-act="unlock">Unlock now</button></td></tr>`).join('')}
        </tbody></table></div></div></div>` : ''}
      ${s.suspiciousIps.length ? `<div class="card" style="margin-bottom:16px;"><div class="pad"><h2 style="font-size:15px;margin-top:0;">Suspicious IP addresses (last 24 hours)</h2>
        <div class="tablewrap"><table><thead><tr><th>IP address</th><th>Failed attempts</th><th>Accounts tried</th><th>Last attempt</th><th></th></tr></thead><tbody>
        ${s.suspiciousIps.map((r) => `<tr><td><b>${esc(ipLabel(r.ip))}</b><span class="sub">${esc(r.ip)}</span></td><td class="num">${r.failed}</td><td class="num">${r.accounts}</td>
          <td>${esc(fmtStamp(r.last))}</td><td style="text-align:right;"><button class="btn small" data-ip="${esc(r.ip)}">Show attempts</button></td></tr>`).join('')}
        </tbody></table></div></div></div>` : ''}`;

    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>When</th><th>Account</th><th>Where</th><th>Result</th><th>Details</th><th>IP / device</th></tr></thead>
      <tbody>${d.logins.length ? d.logins.map((l) => `<tr>
        <td>${esc(fmtStamp(l.createdAt))}</td>
        <td><b>${esc(l.name || l.email || 'Unknown')}</b><span class="sub">${l.name ? esc(l.email) : ''}${l.role ? ` ${pillR(l.role)}` : ''}</span></td>
        <td>${l.portal === 'admin' ? 'Admin console' : 'Customer site'}</td>
        <td>${loginPill(l)}</td>
        <td class="muted">${esc(LOGIN_REASON[l.reason] || l.reason)}</td>
        <td><span title="${esc(l.ip)}">${esc(ipLabel(l.ip))}</span><span class="sub" title="${esc(l.userAgent || '')}">${esc(deviceOf(l.userAgent))}</span></td>
      </tr>`).join('') : emptyRow(6, 'No sign-in attempts match these filters.')}</tbody></table></div>${pager2(d, 'attempt')}`;
  }

  /** Rate limits (backend/.env RATE_LIMIT_*): the limits in use and who was refused in the last day. */
  async function loadRateLimits() {
    let r;
    try { r = await api('/rate-limits'); } catch (e) { return; } // an older server: no card
    const box = $('#rlCard');
    if (!box) return;
    const nameOf = Object.fromEntries(r.limits.map((l) => [l.name, l.label]));
    const proxies = typeof r.trustProxy === 'number' ? `${r.trustProxy} prox${r.trustProxy === 1 ? 'y' : 'ies'}` : 'the trusted proxies';
    box.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="pad">
      <h2 style="font-size:15px;margin-top:0;">Rate limits</h2>
      <p class="sub rl-note">How many requests one person or address may make before the server answers "Too many requests".
        Change them in backend/.env and restart the server.</p>
      <div class="tablewrap"><table><thead><tr><th>Requests</th><th>Limit</th><th>Counted per</th><th>Setting</th></tr></thead><tbody>
      ${r.limits.map((l) => `<tr><td><b>${esc(l.label)}</b></td>
        <td>${l.off ? '<span class="pill s-cancelled">Off</span>' : `${esc(l.limit)} per ${esc(l.per)}`}</td>
        <td>${esc(l.countedBy)}</td><td><code>${esc(l.setting)}</code><span class="sub">${esc(l.source)}</span></td></tr>`).join('')}
      </tbody></table></div>
      <h3 class="rl-h">Refused in the last 24 hours</h3>
      ${r.blocked.length ? `<div class="tablewrap"><table><thead><tr><th>Who</th><th>Limit</th><th class="r">Refused</th><th>Last time</th><th>Blocked until</th><th></th></tr></thead><tbody>
        ${r.blocked.map((b) => `<tr><td><b>${esc(b.who)}</b><span class="sub">${esc(b.kind === 'ip' ? 'IP address' : `${b.email}${b.role ? ` · ${b.role}` : ''}`)}</span></td>
          <td>${esc(nameOf[b.limit] || b.limit)}<span class="sub">${esc(b.path)}</span></td><td class="r num">${esc(b.count)}</td>
          <td>${esc(fmtStamp(b.lastAt))}</td><td>${new Date(b.until) > new Date() ? esc(fmtStamp(b.until)) : '<span class="muted">Over</span>'}</td>
          <td style="text-align:right;">${b.kind === 'ip' ? `<button class="btn small" data-ip="${esc(b.who)}">Show attempts</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="sub rl-note">Nobody was refused in the last 24 hours.</p>'}
      <p class="sub rl-note" style="margin-top:10px;">The server sees your address as <b>${esc(r.yourIp || 'unknown')}</b>.
        ${r.trustProxy ? `It reads each visitor's address through ${esc(proxies)} (TRUST_PROXY).`
          : 'If every visitor shows the same address on the live server (the proxy\'s), set TRUST_PROXY=1 in backend/.env.'}</p>
    </div></div>`;
  }

  refreshView = () => Promise.all([load(), loadRateLimits()]).catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { lgUi.q = $('#lgQ').value.trim(); lgUi.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'lgQ') search(); };
  view.onchange = (e) => {
    const map = { lgResult: 'result', lgPortal: 'portal', lgDate: 'date' };
    if (!map[e.target.id]) return;
    lgUi[map[e.target.id]] = e.target.value; lgUi.page = 1; go();
  };
  view.onclick = async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { lgUi.page = Number(pg.dataset.page); return go(); }
    const ipBtn = e.target.closest('[data-ip]');
    if (ipBtn) {
      lgUi.q = ipBtn.dataset.ip; lgUi.result = 'failed'; lgUi.page = 1;
      $('#lgQ').value = lgUi.q; $('#lgResult').value = 'failed';
      return go();
    }
    const b = e.target.closest('[data-act=unlock]');
    if (!b) return;
    b.disabled = true; b.classList.add('is-busy');
    try {
      await api(`/users/${b.closest('tr').dataset.id}/unlock`, { method: 'PATCH' });
      toast('Account unlocked. The person can sign in again.');
      refreshView();
    } catch (x) { toast(x.message, true); b.disabled = false; b.classList.remove('is-busy'); }
  };
}
/* =====================================================================
   AF-135 Audit Logs
   ===================================================================== */
EXTRA.views.audit = { label: 'Audit logs', perm: 'audit', render: renderAudit };
const AU_DEFAULTS = { page: 1, q: '', date: '', role: '' };
const auUi = { ...AU_DEFAULTS };

async function renderAudit(params) {
  const go = bindState(auUi, AU_DEFAULTS, params); // #/audit?page=5
  setHead('Audit logs', 'A record of what staff and admins changed, newest first', '<button class="btn" id="auCsv" type="button" title="Every entry matching the search, as a spreadsheet">Export CSV</button>');
  $('#auCsv').onclick = () => downloadFile(`/audit?${qsOf({ format: 'csv', q: auUi.q, date: auUi.date, role: auUi.role })}`, 'audit-logs.csv', $('#auCsv'))
    .catch((e) => toast(e.message, true));
  view.innerHTML = `<div class="bar"><input class="grow" id="aQ" type="search" placeholder="Search by person, action or detail (press /)" value="${esc(auUi.q)}" aria-label="Search logs" />
    <select id="aRole" aria-label="Whose actions"><option value="">Everyone</option>${optionList([['staff', 'Staff only'], ['admin', 'Admins only']], auUi.role)}</select>
    <label class="inl">Day <input type="date" id="aDate" value="${esc(auUi.date)}" /></label></div>
    <div class="card" id="listCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;
  async function load() {
    const d = await api(`/audit?${qsOf({ page: auUi.page, limit: 25, q: auUi.q, date: auUi.date, role: auUi.role })}`);
    if (d.page > d.pages) { auUi.page = d.pages; stateTo(auUi, AU_DEFAULTS, { push: false }); return load(); }
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>What they did</th><th>Details</th></tr></thead>
      <tbody>${d.logs.length ? d.logs.map((l) => `<tr><td>${esc(fmtStamp(l.createdAt))}</td>
        <td><b>${esc(l.actorName || 'Unknown')}</b><span class="sub">${esc(ROLE_LABEL[l.actorRole] || l.actorRole)}</span></td>
        <td>${esc(l.action)}</td><td class="muted" title="${esc(l.userAgent || '')}">${esc(l.detail || '-')}<span class="sub">${l.ip ? `IP ${esc(l.ip)}` : ''}</span></td></tr>`).join('') : emptyRow(4, 'No activity recorded for these filters.')}</tbody></table></div>${pager2(d, 'entry')}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { auUi.q = $('#aQ').value.trim(); auUi.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'aQ') search(); };
  view.onchange = (e) => {
    if (e.target.id === 'aDate') auUi.date = e.target.value;
    else if (e.target.id === 'aRole') auUi.role = e.target.value;
    else return;
    auUi.page = 1; go();
  };
  view.onclick = (e) => { const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { auUi.page = Number(pg.dataset.page); go(); } };
}

/* =====================================================================
   Shared: a small "are you sure?" dialog
   ===================================================================== */
function confirmBox(title, html, okLabel, onOk, { danger = false } = {}) {
  openModal(title, `<form id="cfForm">${html}<div class="msg error hidden" role="alert"></div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn ${danger ? 'solid-danger' : 'primary'}">${esc(okLabel)}</button></div></form>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  onSubmit($('#cfForm'), async (d) => { await onOk(d); });
}
const bytesLabel = (n) => (n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* =====================================================================
   AF-141 Session management
   ===================================================================== */
EXTRA.views.sessions = { label: 'Active sessions', perm: 'sessions', render: renderSessions };
const SS_DEFAULTS = { page: 1, q: '', portal: '', status: 'active' };
const ssUi = { ...SS_DEFAULTS };
const SIGNIN_METHOD = { password: 'With password', google: 'With Google', signup: 'New account', reset: 'After a password reset', 'password-change': 'After a password change' };

async function renderSessions(params) {
  const go = bindState(ssUi, SS_DEFAULTS, params); // #/sessions?status=ended&page=2
  setHead('Active sessions', 'Who is signed in now. Ending a session signs that device out at once.');
  view.innerHTML = `<div class="card ribbon cols3" id="ssTop"></div>
    <div class="bar">
      <input class="grow" id="ssQ" type="search" placeholder="Search name, email or IP address (press /)" value="${esc(ssUi.q)}" aria-label="Search sessions" />
      <select id="ssPortal" aria-label="Where">${optionList([['', 'Customer site and admin'], ['customer', 'Customer site'], ['admin', 'Admin console']], ssUi.portal)}</select>
      <select id="ssStatus" aria-label="Show">${optionList([['active', 'Signed in now'], ['ended', 'Ended, last 30 days']], ssUi.status)}</select>
    </div>
    <div class="card" id="listCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;

  let rows = [];
  async function load() {
    const d = await api(`/sessions?${qsOf({ page: ssUi.page, q: ssUi.q, portal: ssUi.portal, status: ssUi.status })}`);
    if (d.page > d.pages) { ssUi.page = d.pages; stateTo(ssUi, SS_DEFAULTS, { push: false }); return load(); }
    rows = d.sessions;
    $('#ssTop').innerHTML = `<div><div class="k">Admin console</div><div class="v num">${d.counts.admin}</div><div class="s">sessions open now</div></div>
      <div><div class="k">Customer site</div><div class="v num">${d.counts.customer}</div><div class="s">sessions open now</div></div>
      <div><div class="k">People signed in</div><div class="v num">${d.counts.people}</div><div class="s">on one device or more</div></div>`;
    const open = ssUi.status !== 'ended';
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Account</th><th>Where</th><th>Device</th><th>Signed in</th><th>${open ? 'Last active' : 'Ended'}</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map((x) => `<tr data-id="${esc(x.id)}">
        <td><b>${esc(x.user ? x.user.name : 'Deleted account')}</b><span class="sub">${x.user ? `${esc(x.user.email)} ${pillR(x.user.role)}` : ''}</span></td>
        <td>${x.portal === 'admin' ? 'Admin console' : 'Customer site'}${x.current ? `<span class="sub">${pillX('u-active', 'You, on this device')}</span>` : ''}</td>
        <td>${esc(x.device)}<span class="sub" title="Signed in from ${esc(x.signedInIp)}">${esc(ipLabel(x.ip))}</span></td>
        <td>${esc(fmtStamp(x.signedInAt))}<span class="sub">${esc(SIGNIN_METHOD[x.method] || x.method)}</span></td>
        <td>${open ? esc(fmtStamp(x.lastSeenAt)) : `${esc(fmtStamp(x.endedAt))}<span class="sub">${esc(x.endReason)}${x.endedByName ? ` by ${esc(x.endedByName)}` : ''}</span>`}</td>
        <td class="r nowrap">${open && !x.current ? `<button class="btn small danger" data-act="end">End</button>${x.user ? ' <button class="btn small" data-act="all">End all theirs</button>' : ''}` : ''}</td></tr>`).join('')
        : emptyRow(6, open ? 'Nobody matching these filters is signed in.' : 'No ended sessions match these filters.')}</tbody></table></div>${pager2(d, 'session')}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();

  const search = debounce(() => { ssUi.q = $('#ssQ').value.trim(); ssUi.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'ssQ') search(); };
  view.onchange = (e) => {
    if (e.target.id === 'ssPortal') ssUi.portal = e.target.value;
    else if (e.target.id === 'ssStatus') ssUi.status = e.target.value;
    else return;
    ssUi.page = 1; go();
  };
  view.onclick = (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { ssUi.page = Number(pg.dataset.page); return go(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const x = rows.find((r) => r.id === b.closest('tr').dataset.id);
    if (!x) return;
    const who = x.user ? `<b>${esc(x.user.name)}</b> (${esc(x.user.email)})` : 'this account';
    if (b.dataset.act === 'end') {
      confirmBox('End this session?', `<p style="margin-top:0;">${who} is signed out of the ${x.portal === 'admin' ? 'admin console' : 'customer site'} on ${esc(x.device)} at once. They can sign in again with their password.</p>`,
        'End session', async () => { await api(`/sessions/${x.id}`, { method: 'DELETE' }); closeModal(); toast('Session ended'); refreshView(); }, { danger: true });
    } else {
      confirmBox('End all their sessions?', `<p style="margin-top:0;">${who} is signed out on every device${x.user && x.user.id === (state.me && state.me.id) ? ' except this one' : ''}. If you think someone else knows their password, also reset it under People.</p>`,
        'End all sessions', async () => { const r = await api(`/users/${x.user.id}/sessions/end`, { method: 'POST' }); closeModal(); toast(`${r.ended} session${r.ended === 1 ? '' : 's'} ended`); refreshView(); }, { danger: true });
    }
  };
}

/* =====================================================================
   AF-138 Backup and restore
   ===================================================================== */
EXTRA.views.backups = { label: 'Backup & restore', perm: 'data', render: renderBackups };
const BACKUP_KIND = { manual: 'Made by hand', auto: 'Automatic', 'before-restore': 'Before a restore', uploaded: 'Uploaded' };

async function uploadBackup(file) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${window.API_ROOT || '/api'}/admin/backups/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer(),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401) signOut({ reason: data.message || '' });
  if (!res.ok || data.success === false) throw new Error(data.message || (res.status === 413 ? 'That file is too big' : 'The upload failed'));
  return data;
}

async function renderBackups() {
  setHead('Backup & restore', 'Copies of all the app\'s data. Restore one to go back to that moment.',
    '<button class="btn" id="bkUpload" type="button">Upload a backup</button><button class="btn primary" id="bkNow" type="button">Back up now</button>');
  view.innerHTML = '<div class="card"><div class="skeleton"><i></i><i></i><i></i></div></div>';
  const d = await api('/backups');
  const total = d.counts.reduce((sum, c) => sum + c.count, 0);
  view.innerHTML = `
    <div class="card ribbon cols3">
      <div><div class="k">Saved backups</div><div class="v num">${d.backups.length}</div><div class="s">in ${esc(d.folder)} on the server</div></div>
      <div><div class="k">Newest</div><div class="v num" style="font-size:18px;margin-top:8px;">${d.backups.length ? esc(fmtStamp(d.backups[0].createdAt)) : 'None yet'}</div><div class="s">${d.backups.length ? esc(BACKUP_KIND[d.backups[0].kind] || '') : 'Press Back up now'}</div></div>
      <div><div class="k">Records now</div><div class="v num">${total.toLocaleString('en-PH')}</div><div class="s">database ${esc(bytesLabel(d.dataSize))}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px;"><div class="tablewrap"><table>
      <thead><tr><th>Backup</th><th>Made</th><th class="r">Records</th><th class="r">Size</th><th></th></tr></thead>
      <tbody>${d.backups.length ? d.backups.map((b) => `<tr data-name="${esc(b.name)}">
        <td><b>${esc(BACKUP_KIND[b.kind] || b.kind)}</b><span class="sub num">${esc(b.name)}</span>${b.damaged ? `<span class="sub" style="color:var(--red);">Damaged: ${esc(b.damaged)}</span>` : ''}</td>
        <td>${esc(fmtStamp(b.createdAt))}<span class="sub">${b.createdBy ? `by ${esc(b.createdBy)}` : ''}</span></td>
        <td class="r num" title="${esc(b.parts.map((p) => `${p.label}: ${p.count}`).join(', '))}">${b.records.toLocaleString('en-PH')}</td>
        <td class="r num">${esc(bytesLabel(b.size))}</td>
        <td class="r nowrap">${b.damaged ? '' : '<button class="btn small" data-act="download">Download</button> <button class="btn small" data-act="restore">Restore...</button> '}<button class="btn small danger" data-act="delete">Delete</button></td></tr>`).join('')
        : emptyRow(5, 'No backups yet. Press "Back up now", or turn on automatic backups below.')}</tbody></table></div></div>
    <div class="grid2" style="grid-template-columns:1fr 1fr;">
      <div class="card"><div class="pad">
        <h2 style="font-size:15px;margin-top:0;">Automatic backups</h2>
        <form id="bkAuto">
          <label class="check" style="margin-top:0;"><input type="checkbox" name="auto" ${d.settings.auto ? 'checked' : ''} />
            <span><b>Back up once a day</b>While the server is running. Older automatic backups are removed.</span></label>
          ${field('Keep the newest', `<input name="keep" type="number" min="1" max="60" step="1" required value="${d.settings.keep}" />`, 'automatic backups (1 to 60)')}
          <div class="dlg-foot" style="justify-content:flex-start;"><button class="btn primary" type="submit">Save</button></div>
          <div class="msg error hidden" role="alert"></div>
        </form>
      </div></div>
      <div class="card"><div class="pad">
        <h2 style="font-size:15px;margin-top:0;">Good to know</h2>
        <ul class="plain-list">
          <li>A backup has every booking, account, payment, setting and log. Sessions and one-time codes are left out.</li>
          <li>Restoring replaces all current data with the backup's. A safety backup of the data as it is now is made first, so a restore can be undone.</li>
          <li>Downloading, restoring and deleting ask for your security PIN and a one-time code, and every admin is told.</li>
          <li>Backups hold customers' details and password hashes. Keep downloaded copies somewhere safe, and upload only files made by this app (at most ${d.maxUploadMb} MB).</li>
        </ul>
      </div></div>
    </div>
    <input type="file" id="bkFile" accept=".json,application/json" hidden />`;

  $('#bkNow').onclick = async () => {
    const b = $('#bkNow'); b.disabled = true; b.classList.add('is-busy');
    try { const r = await api('/backups', { method: 'POST' }); toast(`Backup saved: ${r.backup.records.toLocaleString('en-PH')} records`); renderBackups(); }
    catch (e) { toast(e.message, true); }
    finally { if (b.isConnected) { b.disabled = false; b.classList.remove('is-busy'); } }
  };
  $('#bkUpload').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = async () => {
    const file = $('#bkFile').files[0];
    if (!file) return;
    try {
      const r = await uploadBackup(file);
      toast(`Uploaded "${file.name}". You can restore it from the list.`);
      if (r.missing && r.missing.length) toast(`Uploaded. Not in this backup (kept as they are on a restore): ${r.missing.join(', ')}`);
      renderBackups();
    } catch (e) { toast(e.message, true); $('#bkFile').value = ''; }
  };
  onSubmit($('#bkAuto'), async (x) => {
    const r = await api('/backups/settings', { method: 'PUT', body: { auto: x.auto, keep: Number(x.keep) } });
    toast(r.settings.auto ? `Automatic backups on, keeping the newest ${r.settings.keep}` : 'Automatic backups off');
  });

  view.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = d.backups.find((x) => x.name === btn.closest('tr').dataset.name);
    if (!b) return;
    const action = btn.dataset.act;
    const label = `the backup from ${fmtStamp(b.createdAt)}`;
    const go = () => twoStepChange({
      what: { download: `Download ${label}`, restore: `Restore ${label}`, delete: `Delete ${label}` }[action],
      sec: d.security,
      start: (pin) => api('/backups/verify', { method: 'POST', body: { action, name: b.name, pin } }),
      resend: (challengeId) => api('/backups/verify/resend', { method: 'POST', body: { action, challengeId } }),
      confirm: (challengeId, otp) => (action === 'download'
        ? downloadFile('/backups/download', b.name, null, { method: 'POST', body: { challengeId, otp } }).then((name) => ({ downloaded: name }))
        : api(`/backups/${action}`, { method: 'POST', body: { challengeId, otp } })),
      done: (r) => {
        if (action === 'download') { toast(`Downloaded ${r.downloaded}. Keep it somewhere safe.`); return false; }
        if (action === 'delete') { toast('Backup deleted'); return false; }
        if (r.signedOut) { toast('Restored. Your account is not an admin in that backup, so you are signed out.'); setTimeout(() => signOut(), 2500); return false; }
        openModal('Backup restored', `<p style="margin-top:0;">The data is back as it was on <b>${esc(fmtStamp(b.createdAt))}</b>.</p>
          <ul class="plain-list">${r.restored.map((p) => `<li>${esc(p.label)}: ${p.count.toLocaleString('en-PH')}</li>`).join('')}</ul>
          ${r.missing && r.missing.length ? `<p class="sub">Not in the backup, so left as they were: ${esc(r.missing.join(', '))}.</p>` : ''}
          <p class="sub">The data from just before is saved as "${esc(r.safety.name)}": restore it to undo this. ${r.sessionsEnded} other session${r.sessionsEnded === 1 ? ' was' : 's were'} signed out.
            Passwords and security PINs are now as they were in the backup: if you changed yours since, check it under <a href="#/profile">My account</a>.</p>
          <div class="dlg-foot"><button type="button" class="btn primary" data-close>Close</button></div>`);
        modalBody.onclick = (ev) => { if (ev.target.closest('[data-close]')) closeModal(); };
        return true;
      },
      onClose: () => { if (currentView === 'backups') renderBackups(); },
    });
    if (action !== 'restore') return go();
    // restoring replaces everything: say so plainly before asking for the PIN
    confirmBox('Restore this backup?', `<p style="margin-top:0;">All current data is replaced by the backup from <b>${esc(fmtStamp(b.createdAt))}</b>
        (${b.records.toLocaleString('en-PH')} records): bookings, accounts, payments and settings made after it are gone.</p>
      <p class="sub">Accounts go back too: passwords and security PINs become what they were then, yours included. A safety backup of the data as it is now is made first, so you can undo this. Everyone else is signed out.</p>
      <label class="check"><input type="checkbox" name="sure" required /><span><b>I understand all current data is replaced</b></span></label>`,
      'Continue', async () => { go(); }, { danger: true });
  };
}

/* =====================================================================
   AF-139 Data management: checks and clean-up
   ===================================================================== */
EXTRA.views.datachecks = { label: 'Data checks', perm: 'data', render: renderDataChecks };

async function renderDataChecks() {
  setHead('Data checks', 'Checks that the records agree with each other, and old records you can clean up', '<button class="btn" id="dcRun" type="button">Check again</button>');
  view.innerHTML = '<div class="card"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>';
  $('#dcRun').onclick = () => renderDataChecks();
  const d = await api('/data');
  const problems = d.checks.filter((c) => c.count);
  const total = d.counts.reduce((sum, c) => sum + c.count, 0);
  view.innerHTML = `
    <div class="card ribbon cols3">
      <div class="${problems.length ? 'urgent' : ''}"><div class="k">Problems found</div><div class="v num">${problems.length}</div><div class="s">of ${d.checks.length} checks</div></div>
      <div><div class="k">Records</div><div class="v num">${total.toLocaleString('en-PH')}</div><div class="s">database ${esc(bytesLabel(d.dataSize))}</div></div>
      <div><div class="k">Checked</div><div class="v num" style="font-size:18px;margin-top:8px;">${esc(fmtStamp(d.checkedAt))}</div><div class="s">press Check again to refresh</div></div>
    </div>
    <div class="card" style="margin-bottom:16px;"><div class="pad">
      <h2 style="font-size:15px;margin-top:0;">Checks</h2>
      ${d.checks.map((c) => `<div class="dc-row${c.count ? ' bad' : ''}">
        <div class="dc-main"><b>${c.count ? `<span class="num">${c.count}</span> &middot; ` : ''}${esc(c.title)}</b>
          <span class="sub">${esc(c.why)}</span>
          ${c.examples.length ? `<span class="sub num">For example ${esc(c.examples.join(', '))}${c.count > c.examples.length ? ', ...' : ''}</span>` : ''}</div>
        <div class="dc-act">${!c.count ? pillX('u-active', 'All good') : c.fixLabel ? `<button class="btn small primary" data-fix="${esc(c.id)}">${esc(c.fixLabel)}</button>` : '<span class="muted">Look only</span>'}</div>
      </div>`).join('')}
    </div></div>
    <div class="grid2" style="grid-template-columns:1fr 1fr;">
      <div class="card"><div class="pad">
        <h2 style="font-size:15px;margin-top:0;">Clean up old records</h2>
        ${d.cleanup.map((c) => `<div class="dc-row"><div class="dc-main"><b>${esc(c.title)}</b><span class="sub">${esc(c.why)}</span></div>
          <div class="dc-act">${c.count ? `<button class="btn small danger" data-clean="${esc(c.id)}" data-count="${c.count}">Delete ${c.count.toLocaleString('en-PH')}</button>` : '<span class="muted">Nothing to delete</span>'}</div></div>`).join('')}
        <p class="sub" style="margin:14px 0 4px;">Removed automatically:</p>
        <ul class="plain-list sub">${d.automatic.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      </div></div>
      <div class="card"><div class="pad">
        <h2 style="font-size:15px;margin-top:0;">Records</h2>
        <div class="tablewrap"><table><tbody>${d.counts.map((c) => `<tr><td>${esc(c.label)}</td><td class="r num">${c.count.toLocaleString('en-PH')}</td></tr>`).join('')}</tbody></table></div>
        <p class="sub" style="margin-top:10px;">To keep a copy of everything, use <a href="#/backups">Backup &amp; restore</a>.</p>
      </div></div>
    </div>`;

  view.onclick = (e) => {
    const fixBtn = e.target.closest('[data-fix]');
    if (fixBtn) {
      const c = d.checks.find((x) => x.id === fixBtn.dataset.fix);
      return confirmBox(c.fixLabel, `<p style="margin-top:0;"><b>${esc(c.title)}</b> (${c.count})</p><p class="sub">${esc(c.why)}</p>
        <p class="sub">The change is written to Audit logs. To be safe, make a backup first.</p>`, c.fixLabel, async () => {
        const r = await api(`/data/checks/${c.id}/fix`, { method: 'POST' });
        closeModal(); toast(r.message); renderDataChecks();
      });
    }
    const cleanBtn = e.target.closest('[data-clean]');
    if (cleanBtn) {
      const c = d.cleanup.find((x) => x.id === cleanBtn.dataset.clean);
      return confirmBox('Delete old records?', `<p style="margin-top:0;">${esc(c.title)}: <b>${c.count.toLocaleString('en-PH')}</b> will be deleted for good.</p>
        <p class="sub">${esc(c.why)} A backup made before keeps them.</p>`, `Delete ${c.count.toLocaleString('en-PH')}`, async () => {
        const r = await api(`/data/cleanup/${c.id}`, { method: 'POST' });
        closeModal(); toast(`${r.deleted.toLocaleString('en-PH')} old record${r.deleted === 1 ? '' : 's'} deleted`); renderDataChecks();
      }, { danger: true });
    }
    return undefined;
  };
}

/* =====================================================================
   SF-119 Receipt Generation: a printable payment receipt (walk-in guests
   have no customer page to see theirs)
   ===================================================================== */
function receiptHtml(r) {
  const row = (k, v) => `<div class="rc-row"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="rc-head"><b>${esc(r.facility.name)}</b>${r.facility.address ? `<span>${esc(r.facility.address)}</span>` : ''}<span>Open ${esc(r.facility.hours)}</span></div>
    <div class="rc-title">Payment receipt</div>
    ${row('Receipt no.', `<span class="num">${esc(r.number)}</span>`)}
    ${row('Date', esc(fmtStamp(r.issuedAt)))}
    ${row('Customer', esc(r.customer.name) + (r.customer.phone ? `<br><span class="muted">${esc(r.customer.phone)}</span>` : ''))}
    ${row('Court', esc(r.court) + (r.location ? `<br><span class="muted">${esc(r.location)}</span>` : ''))}
    ${row('Play time', `${esc(fmtDate(`${r.date}T00:00:00+08:00`))}, ${esc(r.startTime)}–${esc(r.endTime)}`)}
    ${r.discount ? row('Court fee', peso(r.fee)) + row(`Discount${r.promoCode ? ` (${esc(r.promoCode)})` : ''}`, `−${peso(r.discount)}`) : ''}
    <div class="rc-row rc-total"><span>Total paid</span><b class="num">${peso(r.total)}</b></div>
    ${r.receivedBy ? row('Received by', esc(r.receivedBy)) : ''}
    ${r.refund ? `<div class="rc-refund">Refunded ${peso(r.refund.amount)}${r.refund.at ? ` on ${esc(fmtStamp(r.refund.at))}` : ''}</div>` : ''}
    <p class="rc-foot">Thank you for playing! Keep this receipt for your records.</p>`;
}

/** Prints only the receipt: it is copied into a print area and everything else is hidden while printing. */
function printReceipt(html) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `<div class="receipt-sheet">${html}</div>`;
  document.body.classList.add('print-receipt');
  const done = () => { document.body.classList.remove('print-receipt'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); // fires when the print dialog closes, in every current browser
  window.print();
}

async function openReceipt(id) {
  let r;
  try { ({ receipt: r } = await api(`/bookings/${id}/receipt`)); } catch (e) { toast(e.message, true); return; }
  const html = receiptHtml(r);
  openModal('Receipt', `<div class="receipt-sheet">${html}</div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn primary" id="rcPrint">Print receipt</button></div>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  $('#rcPrint').onclick = () => printReceipt(html);
}

/* =====================================================================
   SF-123 Court Assignment: move a customer to another free court,
   same time, same fee
   ===================================================================== */
async function assignCourtDialog(b) {
  let d;
  try { d = await api(`/bookings/${b._id}/courts`); } catch (e) { toast(e.message, true); return; }
  const anyFree = d.courts.some((c) => c.free);
  openModal('Assign a court', `
    <p style="margin-top:0;">Booking <b class="num">${esc(b.referenceNumber)}</b> for ${esc(custName(b))}, <b>${esc(fmtDate(b.date))} ${esc(d.startTime)}–${esc(d.endTime)}</b>.
      Pick a free court. The time and the fee (${peso(b.totalFee)}) stay the same, and the customer is told.</p>
    <div class="assign-list">${d.courts.map((c) => `<button type="button" class="assign-court${c.free ? '' : ' off'}" data-court="${esc(c.id)}" ${c.free ? '' : 'disabled'}>
      <b>${esc(c.name)}</b><span>${c.current ? 'Booked here now' : c.free ? 'Free at this time' : esc(c.reason)}</span></button>`).join('')}</div>
    ${anyFree ? '' : '<p class="muted">No other court is free at this time. Use Reschedule to choose another time.</p>'}
    <div class="msg error hidden" role="alert" id="asErr"></div>
    <div class="dlg-foot"><button type="button" class="btn" data-back>Back to the booking</button></div>`);
  modalBody.onclick = async (e) => {
    if (e.target.closest('[data-back]')) { showBooking(b); return; }
    const btn = e.target.closest('[data-court]');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.classList.add('is-busy');
    try {
      const r = await api(`/bookings/${b._id}/reschedule`, { method: 'PATCH', body: { courtId: btn.dataset.court, date: d.date, startTime: d.startTime, keepFee: true }, version: b.writeTS });
      toast(`${custName(b)} is now on ${r.booking.courtName}`);
      refreshView();
      showBooking(r.booking);
    } catch (err) { btn.disabled = false; btn.classList.remove('is-busy'); showErr($('#asErr'), err.message); }
  };
}

/* =====================================================================
   SF-124 Daily Schedule: every reservation on one day, by time
   ===================================================================== */
EXTRA.views.daily = { label: 'Daily schedule', perm: 'schedule.view', render: renderDaily };
const dailyUi = { date: '', all: '' };

async function renderDaily(params) {
  const go = bindState(dailyUi, { date: '', all: '' }, params); // #/daily?date=2026-11-20&all=1
  setHead('Daily schedule', 'Every reservation on one day, by time', '<button class="btn" id="dPrint" type="button">Print</button>');
  $('#dPrint').onclick = () => { document.body.classList.remove('print-receipt'); window.print(); };
  const day = () => dailyUi.date || todayStr();
  view.innerHTML = `<div class="bar">
      <button class="btn" id="dPrev" type="button" aria-label="Previous day">&larr;</button>
      <input type="date" id="dDate" value="${esc(day())}" aria-label="Day" />
      <button class="btn" id="dNext" type="button" aria-label="Next day">&rarr;</button>
      <button class="btn" id="dToday" type="button">Today</button>
      <label class="check" style="margin:0;"><input type="checkbox" id="dAll" ${dailyUi.all ? 'checked' : ''} /><span>Show cancelled and rejected</span></label>
    </div>
    <div class="card" id="dailyCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;
  const checkin = (b) => (b.checkedOutAt ? 'Finished' : b.checkedInAt ? 'On court' : b.status === 'confirmed' ? 'Not arrived' : '-');
  async function load() {
    const d = await api(`/daily?${qsOf({ date: day(), all: dailyUi.all })}`);
    const rows = d.bookings;
    $('#dailyCard').innerHTML = `<div class="pad daily-head"><h2>${esc(fmtLong(d.date))}</h2>
        <span class="muted">${rows.length} reservation${rows.length === 1 ? '' : 's'} on ${d.courts.length} court${d.courts.length === 1 ? '' : 's'}</span></div>
      <div class="tablewrap"><table>
        <thead><tr><th>Time</th><th>Court</th><th>Customer</th><th>Mobile</th><th>Status</th><th>Payment</th><th>Check-in</th></tr></thead>
        <tbody>${rows.length ? rows.map((b) => `<tr class="click" data-id="${esc(b._id)}">
          <td class="num"><b>${esc(b.startTime)}–${esc(b.endTime)}</b></td><td>${esc(b.courtName)}</td>
          <td>${esc(b.customer)}${b.source === 'desk' ? '<span class="sub">at the desk</span>' : ''}</td><td class="num">${esc(b.phone || '-')}</td>
          <td>${pillS(b.status)}</td><td>${pillP(b.paymentStatus)}</td><td class="muted">${checkin(b)}</td></tr>`).join('')
          : emptyRow(7, 'No reservations on this day.')}</tbody></table></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const setDay = (v) => { dailyUi.date = v === todayStr() ? '' : v; $('#dDate').value = v; go(); };
  view.onchange = (e) => {
    if (e.target.id === 'dDate' && e.target.value) setDay(e.target.value);
    if (e.target.id === 'dAll') { dailyUi.all = e.target.checked ? '1' : ''; go(); }
  };
  view.onclick = (e) => {
    if (e.target.closest('#dPrev')) return setDay(addDays(day(), -1));
    if (e.target.closest('#dNext')) return setDay(addDays(day(), 1));
    if (e.target.closest('#dToday')) return setDay(todayStr());
    const tr = e.target.closest('tr[data-id]');
    if (tr && can('bookings')) openBooking(tr.dataset.id);
    return undefined;
  };
}

/* =====================================================================
   SF-122 Maintenance Reporting: staff report problems to the admins
   ===================================================================== */
EXTRA.views.maintenance = { label: 'Maintenance', perm: 'maintenance.report', render: renderMaintenance };
EXTRA.icons.maintenance = '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-2.4z"/>';
const mtUi = { status: 'open' };
const MT_STATUS = { open: 'Open', in_progress: 'Being fixed', fixed: 'Fixed' };
const MT_CATEGORIES = [['court', 'Court surface or lines'], ['net', 'Net or posts'], ['lighting', 'Lights'], ['equipment', 'Equipment (paddles, balls...)'],
  ['facility', 'Facility (restroom, seats, doors...)'], ['cleaning', 'Cleaning'], ['other', 'Something else']];

async function renderMaintenance(params) {
  const go = bindState(mtUi, { status: 'open' }, params); // #/maintenance?status=fixed ("All" is status= )
  setHead('Maintenance', can('maintenance') ? 'Problems staff reported. Set them to being fixed or fixed; the reporter is told.'
    : 'Report damaged equipment or court problems to the administrators', '<button class="btn primary" id="mtNew" type="button">Report a problem</button>');
  $('#mtNew').onclick = () => reportProblemDialog();
  const d = await api(`/maintenance?${qsOf({ status: mtUi.status })}`);
  const label = Object.fromEntries(MT_CATEGORIES);
  view.innerHTML = `<div class="tabs" role="tablist">${[['open', 'Open'], ['in_progress', 'Being fixed'], ['fixed', 'Fixed'], ['', 'All']].map(([k, l]) =>
    `<button type="button" role="tab" class="${mtUi.status === k ? 'on' : ''}" data-tab="${k}" aria-selected="${mtUi.status === k}">${l}${k ? ` <span class="muted">${d.counts[k]}</span>` : ''}</button>`).join('')}</div>
    ${d.reports.length ? d.reports.map((r) => `<div class="card note-card" data-id="${esc(r._id)}"><div class="pad">
      <div class="row-between"><div><b>${r.severity === 'urgent' ? `${pillX('p-failed', 'Urgent')} ` : ''}${esc(r.title)}</b>
        <div class="muted">${esc(r.courtName || 'Not about one court')} &middot; ${esc(label[r.category] || r.category)} &middot; reported by ${esc(r.reportedByName)}, ${esc(fmtStamp(r.createdAt))}</div></div>
        ${pillX(`mt-${r.status}`, MT_STATUS[r.status])}</div>
      ${r.details ? `<p class="pre">${esc(r.details)}</p>` : ''}
      ${r.updates.length > 1 ? `<div class="thread">${r.updates.slice(1).map((u) => `<div class="reply"><b>${esc(u.byName)}</b> <span class="muted">${esc(fmtStamp(u.at))}${u.status ? ` &middot; set to ${esc(MT_STATUS[u.status] || u.status)}` : ''}</span>${u.message ? `<div class="pre">${esc(u.message)}</div>` : ''}</div>`).join('')}</div>` : ''}
      <div class="btnrow" style="margin-top:10px;">
        ${can('maintenance') && r.status === 'open' ? '<button class="btn small" data-act="in_progress">Being fixed</button>' : ''}
        ${can('maintenance') && r.status !== 'fixed' ? '<button class="btn small primary" data-act="fixed">Mark fixed</button>' : ''}
        ${can('maintenance') && r.status === 'fixed' ? '<button class="btn small" data-act="open">Reopen</button>' : ''}
        <button class="btn small" data-act="note">Add a note</button>
      </div></div></div>`).join('')
      : `<div class="card"><div class="empty">${mtUi.status === 'open' ? 'Nothing open. Report a problem when you find one.' : 'Nothing here.'}</div></div>`}`;
  refreshView = () => renderMaintenance(null);
  view.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { mtUi.status = t.dataset.tab; go(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = d.reports.find((x) => x._id === b.closest('[data-id]').dataset.id);
    if (!r) return;
    const note = b.dataset.act === 'note';
    const status = note ? '' : b.dataset.act;
    openModal(note ? 'Add a note' : `Set to "${MT_STATUS[status]}"`, `<form id="mtUpd"><p style="margin-top:0;"><b>${esc(r.title)}</b></p>
      ${field(note ? 'Note' : 'Message for the reporter (optional)', `<textarea name="message" rows="3" maxlength="1000" ${note ? 'required' : ''}></textarea>`)}
      <div class="msg error hidden" role="alert"></div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${note ? 'Add note' : 'Save'}</button></div></form>`);
    modalBody.onclick = (ev) => { if (ev.target.closest('[data-close]')) closeModal(); };
    onSubmit($('#mtUpd'), async (x) => {
      if (note) await api(`/maintenance/${r._id}/note`, { method: 'POST', body: { message: x.message } });
      else await api(`/maintenance/${r._id}`, { method: 'PATCH', body: { status, message: x.message }, version: r.writeTS });
      closeModal();
      toast(note ? 'Note added' : `Set to "${MT_STATUS[status]}". The reporter was told.`);
      refreshView();
    });
  };
}

/** SF-122: the report form (from Maintenance, Courts, or anywhere staff are). */
async function reportProblemDialog(courtId = '') {
  let courts = [];
  try { ({ courts } = await request(`${window.API_ROOT || '/api'}/courts`)); } catch (e) { /* the form still works without a court */ }
  openModal('Report a problem', `<form id="mtForm">
    <p class="sub" style="margin-top:0;">The administrators are told at once. Urgent reports are marked for them.</p>
    <div class="row2">
      ${field('Where', `<select name="courtId"><option value="">Not about one court</option>${optionList(courts.map((c) => [c._id, c.name]), courtId)}</select>`)}
      ${field('What kind of problem', `<select name="category">${optionList(MT_CATEGORIES, 'court')}</select>`)}
    </div>
    ${field('What is wrong', '<input name="title" maxlength="100" required placeholder="e.g. Net torn on the left side" />')}
    ${field('Details (optional)', '<textarea name="details" rows="3" maxlength="2000" placeholder="Where exactly, since when, is it safe to play?"></textarea>')}
    ${field('How urgent', `<select name="severity">${optionList([['normal', 'Normal: fix it soon'], ['urgent', 'Urgent: not safe to play'], ['low', 'Low: when there is time']], 'normal')}</select>`)}
    ${can('courts.status') ? `<label class="check"><input type="checkbox" name="closeCourt" /><span><b>Also set this court to maintenance</b>Customers can't book it until it is set back to available.</span></label>` : ''}
    <div class="msg error hidden" role="alert"></div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Send report</button></div></form>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  onSubmit($('#mtForm'), async (x) => {
    await api('/maintenance', { method: 'POST', body: { courtId: x.courtId, category: x.category, title: x.title, details: x.details, severity: x.severity } });
    let extra = '';
    if (x.closeCourt && x.courtId) {
      const c = courts.find((cc) => cc._id === x.courtId);
      try { await api(`/courts/${x.courtId}/status`, { method: 'PATCH', body: { status: 'maintenance' }, version: c && c.writeTS }); extra = ' The court is now under maintenance.'; }
      catch (err) { extra = ` The court status was not changed: ${err.message}`; }
    }
    closeModal();
    toast(`Report sent to the administrators.${extra}`);
    refreshView();
  });
}

