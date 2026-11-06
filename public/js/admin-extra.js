'use strict';
/* =====================================================================
   MAKI's PickleBall Court - admin console, part 2 (AF-121 .. AF-135)
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
    <thead><tr><th>Booking</th><th>Customer</th><th class="r">Amount</th><th>Paid via</th><th>Their reference</th><th>Sent</th><th></th></tr></thead>
    <tbody>${bookings.length ? bookings.map((b) => `<tr>
      <td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">${esc(courtOf(b))} &middot; ${fmtDate(b.date)}</span></td>
      <td>${esc(custName(b))}<span class="sub">${esc(b.user ? b.user.email : '')}</span></td>
      <td class="r num">${money(b.totalFee)}${b.discount ? `<span class="sub">promo ${esc(b.promoCode)} −${money(b.discount)}</span>` : ''}</td>
      <td>${esc(b.paymentMethod || '-')}</td>
      <td class="num"><b>${esc(b.paymentReference || '-')}</b></td>
      <td>${esc(ago(b.paymentSubmittedAt))}</td>
      <td class="r"><div class="btnrow" style="justify-content:flex-end;">
        <button class="btn small primary" data-act="verify" data-id="${esc(b._id)}">Verify</button>
        <button class="btn small danger" data-act="reject" data-id="${esc(b._id)}">Reject</button></div></td></tr>`).join('')
      : emptyRow(7, 'Nothing to verify right now. New payment submissions will show up here.')}</tbody></table></div></div>`;
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
      <span class="muted">${esc(b.paymentMethod)} reference: <b class="num">${esc(b.paymentReference)}</b></span></p>
      ${approve ? '' : field('Reason (the customer will see this)', '<input name="note" maxlength="200" placeholder="e.g. Reference number not found" required />')}
      <div class="dlg-foot"><button type="button" class="btn" id="vCancel">Cancel</button>
      <button type="submit" class="btn ${approve ? 'primary' : 'solid-danger'}">${approve ? 'Mark as paid' : 'Reject payment'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#vCancel').onclick = closeModal;
  onSubmit($('#vForm'), async (data) => {
    await api(`/bookings/${b._id}/verify-payment`, { method: 'POST', body: { approve, note: data.note } });
    toast(approve ? 'Payment verified' : 'Payment rejected');
    closeModal(); refreshView();
  });
}

/* =====================================================================
   AF-122 Refund Management
   ===================================================================== */
EXTRA.views.refunds = { label: 'Refunds', perm: 'payments', render: renderRefunds };

async function renderRefunds() {
  setHead('Refunds', 'Paid bookings that were cancelled can be refunded here');
  const { eligible, done } = await api('/refunds');
  const table = (rows, head, body, empty) => `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.length ? rows.map(body).join('') : emptyRow(head.split('</th>').length - 1, empty)}</tbody></table></div>`;
  view.innerHTML = `
    <div class="card" style="margin-bottom:16px;"><h2>Ready to refund <span class="muted">(${eligible.length})</span></h2>
      ${table(eligible, '<th>Booking</th><th>Customer</th><th>Status</th><th class="r">Paid</th><th></th>',
        (b) => `<tr><td class="num"><b>${esc(b.referenceNumber)}</b><span class="sub">${esc(courtOf(b))} &middot; ${fmtDate(b.date)}</span></td>
          <td>${esc(custName(b))}</td><td>${pillS(b.status)}${b.statusReason ? `<span class="sub">${esc(b.statusReason)}</span>` : ''}</td>
          <td class="r num">${money(b.totalFee)}</td>
          <td class="r"><button class="btn small danger" data-id="${esc(b._id)}">Refund...</button></td></tr>`,
        'No cancelled bookings are waiting for a refund.')}
    </div>
    <div class="card"><h2>Refund history</h2>
      ${table(done, '<th>Booking</th><th>Customer</th><th>Refunded</th><th>Reason</th><th>When</th>',
        (b) => `<tr><td class="num"><b>${esc(b.referenceNumber)}</b></td><td>${esc(custName(b))}</td>
          <td class="num">${money((b.refund && b.refund.amount) || b.totalFee)}<span class="sub">of ${money(b.totalFee)}${b.refund && b.refund.method ? ' &middot; ' + esc(b.refund.method) : ''}</span></td>
          <td>${esc((b.refund && b.refund.reason) || '-')}</td><td>${b.refund && b.refund.at ? esc(ago(b.refund.at)) : '-'}</td></tr>`,
        'No refunds yet.')}
    </div>`;
  refreshView = renderRefunds;
  view.onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) refundDialog(eligible.find((x) => x._id === btn.dataset.id));
  };
}

function refundDialog(b) {
  if (!b) return;
  openModal('Refund payment', `
    <form id="rfForm">
      <p>Booking <b class="num">${esc(b.referenceNumber)}</b> for ${esc(custName(b))}. The customer paid <b class="num">${money(b.totalFee)}</b>.</p>
      ${field('Refund amount (₱)', `<input name="amount" type="number" min="1" max="${b.totalFee}" step="1" value="${b.totalFee}" required />`, 'Lower it for a partial refund.')}
      ${field('Refunded via', `<select name="method">${optionList(['Cash', 'GCash', 'Maya', 'Card', 'Bank transfer', 'Other'].map((m) => [m, m]), b.paymentMethod || 'Cash')}</select>`)}
      ${field('Reason', `<input name="reason" maxlength="200" value="${esc(b.statusReason ? 'Booking ' + b.status + ': ' + b.statusReason : 'Booking ' + b.status)}" required />`)}
      <div class="dlg-foot"><button type="button" class="btn" id="rfCancel">Cancel</button><button type="submit" class="btn solid-danger">Process refund</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#rfCancel').onclick = closeModal;
  onSubmit($('#rfForm'), async (data) => {
    await api(`/bookings/${b._id}/refund`, { method: 'POST', body: { amount: Number(data.amount), method: data.method, reason: data.reason } });
    toast('Refund recorded; the customer was notified');
    closeModal(); renderRefunds(); 
  });
}

/* =====================================================================
   AF-123 Transaction History
   ===================================================================== */
EXTRA.views.transactions = { label: 'Transactions', perm: 'payments', render: renderTransactions };
const tx = { page: 1, type: '', q: '', from: '', to: '' };

async function renderTransactions() {
  setHead('Transactions', 'Every payment, refund and failed payment, newest first');
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
    if (d.page > d.pages) { tx.page = d.pages; return load(); }
    $('#txTotals').innerHTML = `<div><div class="k">Payments received</div><div class="v num">${money(d.totals.payment)}</div></div>
      <div><div class="k">Refunded</div><div class="v num">${money(d.totals.refund)}</div></div>
      <div><div class="k">Net</div><div class="v num">${money(d.totals.payment - d.totals.refund)}</div></div>`;
    const typePill = (t) => pillX(`t-${t}`, { payment: 'Payment', refund: 'Refund', failed: 'Failed' }[t]);
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>When</th><th>Booking</th><th>Customer</th><th>Type</th><th>Method</th><th class="r">Amount</th><th>Recorded by</th></tr></thead>
      <tbody>${d.transactions.length ? d.transactions.map((t) => `<tr>
        <td>${esc(ago(t.createdAt))}</td>
        <td class="num"><b>${esc(t.referenceNumber)}</b><span class="sub">${esc(t.courtName)}</span></td>
        <td>${t.user ? esc(t.user.firstName + ' ' + t.user.lastName) : 'Deleted user'}</td>
        <td>${typePill(t.type)}${t.note ? `<span class="sub">${esc(t.note)}</span>` : ''}</td>
        <td>${esc(t.method || '-')}</td>
        <td class="r num ${t.type === 'refund' ? 'neg' : ''}">${t.type === 'refund' ? '−' : ''}${money(t.amount)}</td>
        <td>${t.recordedBy ? esc(t.recordedBy.firstName + ' ' + t.recordedBy.lastName) : '-'}</td></tr>`).join('')
        : emptyRow(7, 'No transactions match these filters.')}</tbody></table></div>${pager2(d, 'transaction')}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { tx.q = $('#tQ').value.trim(); tx.page = 1; refreshView(); });
  view.oninput = (e) => { if (e.target.id === 'tQ') search(); };
  view.onchange = (e) => {
    if (e.target.id === 'tType') tx.type = e.target.value;
    else if (e.target.id === 'tFrom') tx.from = e.target.value;
    else if (e.target.id === 'tTo') tx.to = e.target.value;
    else return;
    tx.page = 1; refreshView();
  };
  view.onclick = (e) => { const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { tx.page = Number(pg.dataset.page); refreshView(); } };
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
  setHead('Announcements', 'News for customers. Published ones appear on their dashboard.', '<button class="btn primary" id="newAnn" type="button">New announcement</button>');
  const { announcements: list } = await api('/announcements');
  view.innerHTML = list.length ? list.map((a) => `<div class="card note-card" data-id="${esc(a._id)}">
      <div class="pad"><div class="row-between"><b>${esc(a.title)}</b>${pillX(a.published ? 'u-active' : 'u-off', a.published ? 'Published' : 'Draft')}</div>
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
    if (b.dataset.act === 'toggle') api(`/announcements/${a._id}/publish`, { method: 'PATCH', body: { published: !a.published } }).then(() => { toast(a.published ? 'Unpublished' : 'Published'); refreshView(); }).catch((x) => toast(x.message, true));
    if (b.dataset.act === 'del') confirmDelete(`Delete “${a.title}”?`, () => api(`/announcements/${a._id}`, { method: 'DELETE' }).then(() => { toast('Deleted'); refreshView(); }));
  };
}

function announcementForm(a) {
  openModal(a ? 'Edit announcement' : 'New announcement', `
    <form id="aForm">
      ${field('Title', `<input name="title" maxlength="120" value="${esc(a ? a.title : '')}" required />`)}
      ${field('Message', `<textarea name="body" rows="5" maxlength="2000" required>${esc(a ? a.body : '')}</textarea>`)}
      ${a ? '' : '<label class="chk"><input type="checkbox" name="published" checked /> Publish right away</label>'}
      <div class="dlg-foot"><button type="button" class="btn" id="aCancel">Cancel</button><button type="submit" class="btn primary">${a ? 'Save changes' : 'Create'}</button></div>
      <div class="msg error hidden" role="alert"></div>
    </form>`);
  $('#aCancel').onclick = closeModal;
  onSubmit($('#aForm'), async (data) => {
    await api(a ? `/announcements/${a._id}` : '/announcements', { method: a ? 'PUT' : 'POST', body: data });
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
    if (b.dataset.act === 'toggle') api(`/promotions/${p._id}/active`, { method: 'PATCH', body: { active: !p.active } }).then(() => { toast(p.active ? 'Promotion turned off' : 'Promotion turned on'); refreshView(); }).catch((x) => toast(x.message, true));
    if (b.dataset.act === 'del') confirmDelete(`Delete promotion ${p.code}?`, () => api(`/promotions/${p._id}`, { method: 'DELETE' }).then(() => { toast('Deleted'); refreshView(); }));
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
    await api(p ? `/promotions/${p._id}` : '/promotions', { method: p ? 'PUT' : 'POST', body: data });
    toast(p ? 'Promotion saved' : 'Promotion created');
    closeModal(); refreshView();
  });
}

/* =====================================================================
   AF-128 Feedback Management
   ===================================================================== */
EXTRA.views.feedback = { label: 'Feedback', perm: 'feedback', render: renderFeedback };
const fbUi = { page: 1, rating: '', status: '' };
const FB_LABEL = { new: 'New', reviewed: 'Reviewed', hidden: 'Hidden' };
const FB_CLASS = { new: 's-pending', reviewed: 'u-active', hidden: 'u-off' };

async function renderFeedback() {
  setHead('Feedback', 'Ratings and comments from completed bookings');
  view.innerHTML = `<div class="grid2" style="grid-template-columns:1fr 2fr;" id="fbTop"></div>
    <div class="bar"><select id="fRating" aria-label="Rating"><option value="">Any rating</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${String(fbUi.rating) === String(n) ? ' selected' : ''}>${n} star${n > 1 ? 's' : ''}</option>`).join('')}</select>
    <select id="fStatus" aria-label="Status"><option value="">Any status</option>${optionList(Object.entries(FB_LABEL), fbUi.status)}</select></div>
    <div id="fbList"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i></div></div>`;
  let items = [];
  async function load() {
    const d = await api(`/feedback?${qsOf({ page: fbUi.page, limit: 15, rating: fbUi.rating, status: fbUi.status })}`);
    if (d.page > d.pages) { fbUi.page = d.pages; return load(); }
    items = d.feedback;
    const max = Math.max(1, ...Object.values(d.stars));
    $('#fbTop').innerHTML = `<div class="card"><div class="pad center"><div class="big num">${d.count ? d.average.toFixed(1) : '–'}</div>${stars(Math.round(d.average))}<div class="muted">${d.count} visible rating${d.count === 1 ? '' : 's'}</div></div></div>
      <div class="card"><div class="pad"><div class="hbars">${[5, 4, 3, 2, 1].map((n) => `<div class="hb"><span class="hl">${n} ★</span><span class="ht"><i style="width:${Math.round((d.stars[n] / max) * 100)}%"></i></span><b class="num">${d.stars[n]}</b></div>`).join('')}</div></div></div>`;
    $('#fbList').innerHTML = items.length ? `<div class="card">${items.map((f) => `<div class="fb ${f.status === 'hidden' ? 'dim' : ''}" data-id="${esc(f._id)}">
        <div class="row-between"><div>${stars(f.rating)} <b>${esc(f.user ? f.user.firstName + ' ' + f.user.lastName : 'Deleted user')}</b>
          <span class="muted"> &middot; ${esc(f.courtName)}${f.booking ? ' &middot; ' + esc(f.booking.referenceNumber) : ''}</span></div>${pillX(FB_CLASS[f.status], FB_LABEL[f.status])}</div>
        ${f.comment ? `<p class="pre">${esc(f.comment)}</p>` : '<p class="muted">No comment left.</p>'}
        <div class="row-between"><span class="muted">${esc(fmtStamp(f.createdAt))}</span><div class="btnrow">
          ${f.status !== 'reviewed' ? '<button class="btn small" data-set="reviewed">Mark reviewed</button>' : ''}
          ${f.status !== 'hidden' ? '<button class="btn small" data-set="hidden">Hide</button>' : '<button class="btn small" data-set="new">Show again</button>'}</div></div></div>`).join('')}
      ${pager2(d, 'review')}</div>`
      : '<div class="card"><div class="empty">No feedback matches. Customers can rate a booking once it is completed.</div></div>';
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  view.onchange = (e) => { if (e.target.id === 'fRating') fbUi.rating = e.target.value; else if (e.target.id === 'fStatus') fbUi.status = e.target.value; else return; fbUi.page = 1; refreshView(); };
  view.onclick = async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { fbUi.page = Number(pg.dataset.page); return refreshView(); }
    const b = e.target.closest('[data-set]');
    if (!b) return;
    try { await api(`/feedback/${b.closest('[data-id]').dataset.id}`, { method: 'PATCH', body: { status: b.dataset.set } }); refreshView(); } catch (x) { toast(x.message, true); }
  };
}

/* =====================================================================
   AF-129 Complaint / Issue Management
   ===================================================================== */
EXTRA.views.issues = { label: 'Issues', perm: 'issues', render: renderIssues };
const issUi = { status: 'open' };
const ISS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

async function renderIssues(params) {
  setHead('Issues', 'Complaints and problems reported by customers');
  if (params && params.has('status')) issUi.status = params.get('status');
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
  refreshView = () => renderIssues(new URLSearchParams());
  view.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { issUi.status = t.dataset.tab; return renderIssues(new URLSearchParams()); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const issue = d.issues.find((x) => x._id === b.closest('[data-id]').dataset.id);
    if (b.dataset.act === 'reply') return replyDialog(issue);
    const status = b.dataset.act === 'resolve' ? 'resolved' : 'open';
    api(`/issues/${issue._id}`, { method: 'PATCH', body: { status } }).then(() => { toast(status === 'resolved' ? 'Marked resolved' : 'Reopened'); refreshView(); }).catch((x) => toast(x.message, true));
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
  setHead('Check-ins', 'Record when customers arrive and leave');
  if (params && params.get('date')) ciUi.date = params.get('date');
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
  refreshView = () => renderCheckins(new URLSearchParams());
  view.onchange = (e) => { if (e.target.id === 'cDate' && e.target.value) { ciUi.date = e.target.value; refreshView(); } };
  view.onclick = async (e) => {
    if (e.target.closest('#cToday')) { ciUi.date = ''; return refreshView(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    try {
      await api(`/bookings/${b.closest('tr').dataset.id}/checkin`, { method: 'PATCH', body: { action: b.dataset.act } });
      refreshView();
    } catch (x) { toast(x.message, true); }
  };
}

/* =====================================================================
   AF-131 Reports
   ===================================================================== */
EXTRA.views.reports = { label: 'Reports', perm: 'reports', render: renderReports };
const repUi = { type: 'bookings', from: '', to: '' }; // dates filled on first render (admin.js loads after this file)
const REPORT_TYPES = [['bookings', 'Bookings'], ['payments', 'Payments'], ['transactions', 'Transactions'], ['users', 'New customers'], ['courts', 'Courts']];

async function renderReports() {
  if (!repUi.from) Object.assign(repUi, rangeDefaults(30));
  setHead('Reports', 'Pick a report and a date range, then print or save as PDF', '<button class="btn" id="printRep" type="button">Print / save PDF</button>');
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
  view.onchange = (e) => { if (e.target.id === 'rType') repUi.type = e.target.value; else if (e.target.id === 'rFrom') repUi.from = e.target.value; else if (e.target.id === 'rTo') repUi.to = e.target.value; else return; run(); };
  $('#printRep').onclick = () => window.print();
}

/* =====================================================================
   AF-132 / AF-133 / AF-134  Analytics (bookings, revenue, users)
   ===================================================================== */
EXTRA.views.analytics = { label: 'Analytics', perm: 'analytics', render: renderAnalytics };
const anUi = { tab: 'bookings', from: '', to: '' };
const kpi = (k, v, s = '') => `<div><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;

async function renderAnalytics(params) {
  if (!anUi.from) Object.assign(anUi, rangeDefaults(30));
  if (params && params.get('tab')) anUi.tab = ['bookings', 'revenue', 'users'].includes(params.get('tab')) ? params.get('tab') : 'bookings';
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
          <div class="grid2" style="grid-template-columns:1fr 1fr;margin-top:16px;">
            <div class="card"><h2>Income by court</h2><div class="pad">${hbars(d.byCourt.map((c) => ({ label: c.name, v: c.amount })), money, 'No payments in this range.')}</div></div>
            <div class="card"><h2>Income by payment method</h2><div class="pad">${hbars(d.byMethod.map((c) => ({ label: c.name, v: c.amount })), money, 'No payments in this range.')}</div></div></div>`;
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
  view.onchange = (e) => { if (e.target.id === 'rFrom') anUi.from = e.target.value; else if (e.target.id === 'rTo') anUi.to = e.target.value; else return; run(); };
  view.onclick = (e) => {
    const p = e.target.closest('[data-days]');
    if (!p) return;
    Object.assign(anUi, rangeDefaults(Number(p.dataset.days)));
    $('#rFrom').value = anUi.from; $('#rTo').value = anUi.to; run();
  };
}

/* =====================================================================
   AF-135 Audit Logs
   ===================================================================== */
EXTRA.views.audit = { label: 'Audit logs', perm: 'audit', render: renderAudit };
const auUi = { page: 1, q: '', date: '' };

async function renderAudit() {
  setHead('Audit logs', 'A record of what staff and admins changed, newest first');
  view.innerHTML = `<div class="bar"><input class="grow" id="aQ" type="search" placeholder="Search by person, action or detail (press /)" value="${esc(auUi.q)}" aria-label="Search logs" />
    <label class="inl">Day <input type="date" id="aDate" value="${esc(auUi.date)}" /></label></div>
    <div class="card" id="listCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;
  async function load() {
    const d = await api(`/audit?${qsOf({ page: auUi.page, limit: 25, q: auUi.q, date: auUi.date })}`);
    if (d.page > d.pages) { auUi.page = d.pages; return load(); }
    $('#listCard').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>What they did</th><th>Details</th></tr></thead>
      <tbody>${d.logs.length ? d.logs.map((l) => `<tr><td>${esc(fmtStamp(l.createdAt))}</td>
        <td><b>${esc(l.actorName || 'Unknown')}</b><span class="sub">${esc(ROLE_LABEL[l.actorRole] || l.actorRole)}</span></td>
        <td>${esc(l.action)}</td><td class="muted" title="${esc(l.userAgent || '')}">${esc(l.detail || '-')}<span class="sub">${l.ip ? `IP ${esc(l.ip)}` : ''}</span></td></tr>`).join('') : emptyRow(4, 'No activity recorded for these filters.')}</tbody></table></div>${pager2(d, 'entry')}`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { auUi.q = $('#aQ').value.trim(); auUi.page = 1; refreshView(); });
  view.oninput = (e) => { if (e.target.id === 'aQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'aDate') { auUi.date = e.target.value; auUi.page = 1; refreshView(); } };
  view.onclick = (e) => { const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { auUi.page = Number(pg.dataset.page); refreshView(); } };
}
