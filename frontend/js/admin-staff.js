/* MAKI's PickleBall Court - admin console: staff desk screens (SF-128..SF-136).
   Loaded after admin-extra.js and before admin.js; the shared helpers (api, esc, openModal, ...) are used at run time. */

const pct = (u) => (u === null || u === undefined ? '–' : `${Math.round(u * 100)}%`);
const usageBar = (u) => `<div class="ubar-row"><div class="ubar"><i style="width:${Math.round((u || 0) * 100)}%"></i></div><span class="num">${pct(u)}</span></div>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dayLabel = (str) => (str === todayStr() ? 'Today' : str === addDays(todayStr(), 1) ? 'Tomorrow' : str === addDays(todayStr(), -1) ? 'Yesterday' : fmtLong(str));

/** Previous / day / next / Today buttons for the screens that show one day. */
const dayBar = (value, extra = '') => `<div class="bar">
    <button class="btn" data-day="-1" type="button" aria-label="Previous day">&larr;</button>
    <input type="date" id="dayPick" value="${esc(value)}" aria-label="Day" />
    <button class="btn" data-day="1" type="button" aria-label="Next day">&rarr;</button>
    <button class="btn" data-day="0" type="button">Today</button>${extra}</div>`;
/** Wires dayBar: ui.date ('' = today) changes, then go(). Returns a click handler for the caller's view.onclick. */
function dayBarClicks(ui, go) {
  const set = (v) => { ui.date = v === todayStr() ? '' : v; const p = $('#dayPick'); if (p) p.value = v; go(); };
  view.onchange = (e) => { if (e.target.id === 'dayPick' && e.target.value) set(e.target.value); };
  return (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return false;
    const n = Number(b.dataset.day);
    set(n ? addDays(ui.date || todayStr(), n) : todayStr());
    return true;
  };
}

/* =====================================================================
   SF-128 Announcements and staff instructions (read only for staff)
   ===================================================================== */
EXTRA.views.board = { label: 'Announcements', perm: 'announcements.view', render: renderBoard };
const boardUi = { for: '' };
const AUDIENCE_LABEL = { customers: 'Told to customers', staff: 'For staff', everyone: 'For everyone' };
const AUDIENCE_CLASS = { customers: 'r-user', staff: 'r-staff', everyone: 'r-admin' };

async function renderBoard(params) {
  const go = bindState(boardUi, { for: '' }, params); // #/board?for=staff
  setHead('Announcements', 'Instructions from the administrators, and what customers have been told');
  const d = await api(`/board?${qsOf({ for: boardUi.for })}`);
  view.innerHTML = `<div class="tabs" role="tablist">${[['', 'All'], ['staff', 'For staff'], ['customers', 'Told to customers']].map(([k, l]) =>
    `<button type="button" role="tab" class="${boardUi.for === k ? 'on' : ''}" data-tab="${k}" aria-selected="${boardUi.for === k}">${l}</button>`).join('')}</div>
    ${d.announcements.length ? d.announcements.map((a) => `<div class="card note-card"><div class="pad">
      <div class="row-between"><b>${esc(a.title)}</b>${pillX(AUDIENCE_CLASS[a.audience] || 'r-user', AUDIENCE_LABEL[a.audience] || a.audience)}</div>
      <p class="pre">${esc(a.body)}</p>
      <span class="muted">${esc(a.by)} &middot; ${esc(fmtStamp(a.publishedAt))}</span></div></div>`).join('')
    : `<div class="card"><div class="empty">${boardUi.for === 'staff' ? 'No instructions for staff yet.' : 'Nothing published yet.'}</div></div>`}`;
  refreshView = () => renderBoard(null);
  view.onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { boardUi.for = t.dataset.tab; go(); } };
}

/* =====================================================================
   SF-130 Incident Reporting
   ===================================================================== */
EXTRA.views.incidents = { label: 'Incidents', perm: 'incidents.report', render: renderIncidents };
const incUi = { status: 'open', q: '' };
const INC_CATEGORIES = [['injury', 'Injury or first aid'], ['dispute', 'Argument or complaint'], ['damage', 'Damage by a player'], ['rules', 'Facility rules broken'],
  ['no_show', 'No-show or very late'], ['lost_item', 'Lost or found item'], ['safety', 'Safety hazard'], ['other', 'Something else']];
const INC_LABEL = Object.fromEntries(INC_CATEGORIES);

async function renderIncidents(params) {
  const go = bindState(incUi, { status: 'open', q: '' }, params); // #/incidents?status=resolved&q=ankle
  setHead('Incidents', can('incidents') ? 'What happened during customer sessions. Resolve them once handled; whoever recorded it is told.'
    : 'Record what happens during customer sessions: injuries, arguments, damage, lost items...', '<button class="btn primary" id="incNew" type="button">Record an incident</button>');
  $('#incNew').onclick = () => incidentDialog();
  view.innerHTML = `<div class="bar"><div class="tabs" role="tablist" id="incTabs" style="margin:0;"></div>
      <input class="grow" id="incQ" type="search" placeholder="Search what happened, customer, court or reference (press /)" value="${esc(incUi.q)}" aria-label="Search incidents" /></div>
    <div id="incList"><div class="card"><div class="skeleton"><i></i><i></i><i></i></div></div></div>`;
  let list = [];
  async function load() {
    const d = await api(`/incidents?${qsOf({ status: incUi.status, q: incUi.q })}`);
    list = d.incidents;
    $('#incTabs').innerHTML = [['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']].map(([k, l]) =>
      `<button type="button" role="tab" class="${incUi.status === k ? 'on' : ''}" data-tab="${k}" aria-selected="${incUi.status === k}">${l}${k ? ` <span class="muted">${d.counts[k]}</span>` : ''}</button>`).join('');
    $('#incList').innerHTML = list.length ? list.map((r) => `<div class="card note-card" data-id="${esc(r._id)}"><div class="pad">
      <div class="row-between"><div><b>${r.severity === 'serious' ? `${pillX('p-failed', 'Serious')} ` : ''}${esc(r.title)}</b>
        <div class="muted">${esc(INC_LABEL[r.category] || r.category)} &middot; ${esc(fmtStamp(r.occurredAt))}${r.courtName ? ` &middot; ${esc(r.courtName)}` : ''}${r.customerName ? ` &middot; ${esc(r.customerName)}` : ''}${r.referenceNumber ? ` &middot; ${can('bookings') ? `<a href="#" data-booking="${esc(r.booking)}">${esc(r.referenceNumber)}</a>` : esc(r.referenceNumber)}` : ''}</div>
        <div class="muted">Recorded by ${esc(r.reportedByName)}</div></div>
        ${pillX(r.status === 'open' ? 'mt-open' : 'mt-fixed', r.status === 'open' ? 'Open' : 'Resolved')}</div>
      ${r.details ? `<p class="pre">${esc(r.details)}</p>` : ''}
      ${r.actionTaken ? `<p class="pre"><b>What was done:</b> ${esc(r.actionTaken)}</p>` : ''}
      ${r.updates.length > 1 ? `<div class="thread">${r.updates.slice(1).map((u) => `<div class="reply"><b>${esc(u.byName)}</b> <span class="muted">${esc(fmtStamp(u.at))}${u.status ? ` &middot; ${u.status === 'resolved' ? 'resolved it' : 'reopened it'}` : ''}</span>${u.message ? `<div class="pre">${esc(u.message)}</div>` : ''}</div>`).join('')}</div>` : ''}
      <div class="btnrow" style="margin-top:10px;">
        ${can('incidents') ? (r.status === 'open' ? '<button class="btn small primary" data-act="resolved">Mark resolved</button>' : '<button class="btn small" data-act="open">Reopen</button>') : ''}
        <button class="btn small" data-act="note">Add a note</button></div></div></div>`).join('')
      : `<div class="card"><div class="empty">${incUi.status === 'open' && !incUi.q ? 'No open incidents.' : 'Nothing matches.'}</div></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { incUi.q = $('#incQ').value.trim(); go(false); });
  view.oninput = (e) => { if (e.target.id === 'incQ') search(); };
  view.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { incUi.status = t.dataset.tab; go(); return; }
    const bk = e.target.closest('[data-booking]');
    if (bk) { e.preventDefault(); openBooking(bk.dataset.booking); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = list.find((x) => x._id === b.closest('[data-id]').dataset.id);
    if (!r) return;
    const note = b.dataset.act === 'note';
    const status = note ? '' : b.dataset.act;
    openModal(note ? 'Add a note' : status === 'resolved' ? 'Mark resolved' : 'Reopen', `<form id="incUpd"><p style="margin-top:0;"><b>${esc(r.title)}</b></p>
      ${field(note ? 'Note' : 'Message for whoever recorded it (optional)', `<textarea name="message" rows="3" maxlength="1000" ${note ? 'required' : ''}></textarea>`)}
      <div class="msg error hidden" role="alert"></div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${note ? 'Add note' : 'Save'}</button></div></form>`);
    modalBody.onclick = (ev) => { if (ev.target.closest('[data-close]')) closeModal(); };
    onSubmit($('#incUpd'), async (x) => {
      if (note) await api(`/incidents/${r._id}/note`, { method: 'POST', body: { message: x.message } });
      else await api(`/incidents/${r._id}`, { method: 'PATCH', body: { status, message: x.message }, version: r.writeTS });
      closeModal();
      toast(note ? 'Note added' : status === 'resolved' ? 'Marked resolved' : 'Reopened');
      refreshView();
    });
  };
}

/** SF-130: the incident form, from Incidents or from a booking (then the booking, customer and court are filled in). */
async function incidentDialog(b = null) {
  let courts = [];
  if (!b) { try { ({ courts } = await request(`${window.API_ROOT || '/api'}/courts`)); } catch (e) { /* the form works without a court */ } }
  const nowLocal = new Date(Date.now() + MANILA_MS).toISOString().slice(0, 16); // Manila time, as <input type=datetime-local> wants it
  openModal(b ? `Record an incident: ${b.referenceNumber}` : 'Record an incident', `<form id="incForm">
    ${b ? `<p class="sub" style="margin-top:0;">${esc(custName(b))} &middot; ${esc(courtOf(b))} &middot; ${esc(fmtDate(b.date))}, ${esc(b.startTime)}–${esc(b.endTime)}</p>`
      : `<div class="row2">${field('Court', `<select name="courtId"><option value="">Not about one court</option>${optionList(courts.map((c) => [c._id, c.name]), '')}</select>`)}
        ${field('Customer (optional)', '<input name="customerName" maxlength="120" placeholder="Name, if it involves someone" />')}</div>`}
    <div class="row2">${field('What kind', `<select name="category">${optionList(INC_CATEGORIES, 'injury')}</select>`)}
      ${field('When', `<input type="datetime-local" name="occurredAt" value="${nowLocal}" max="${nowLocal}" required />`)}</div>
    ${field('What happened', '<input name="title" maxlength="100" required placeholder="e.g. Player twisted an ankle near the net" />')}
    ${field('Details (optional)', '<textarea name="details" rows="3" maxlength="2000" placeholder="Who was involved, what was seen or said, witnesses"></textarea>')}
    ${field('What was done (optional)', '<textarea name="actionTaken" rows="2" maxlength="1000" placeholder="e.g. First aid, ice pack; the customer went home"></textarea>')}
    <label class="check"><input type="checkbox" name="serious" /><span><b>Serious</b>Someone was badly hurt, medical help or the police were called, or there was major damage. The administrators are alerted as urgent.</span></label>
    <div class="msg error hidden" role="alert"></div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save incident</button></div></form>`);
  modalBody.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  onSubmit($('#incForm'), async (x) => {
    const occurredAt = new Date(`${x.occurredAt}:00+08:00`).toISOString(); // typed in Manila time
    await api('/incidents', { method: 'POST', body: { bookingId: b ? b._id : undefined, courtId: x.courtId, customerName: x.customerName, category: x.category,
      severity: x.serious ? 'serious' : 'minor', title: x.title, details: x.details, actionTaken: x.actionTaken, occurredAt } });
    closeModal();
    toast('Incident recorded. The administrators were told.');
    if (currentView === 'incidents') refreshView();
  });
}

/* =====================================================================
   SF-131 Daily booking report
   ===================================================================== */
EXTRA.views.dayreport = { label: 'Daily report', perm: 'reports.daily', render: renderDayReport };
const drUi = { date: '' };

async function renderDayReport(params) {
  const go = bindState(drUi, { date: '' }, params); // #/dayreport?date=2026-11-20
  const day = () => drUi.date || todayStr();
  setHead('Daily report', "The day's reservations, arrivals and court usage",
    '<button class="btn" id="drCsv" type="button" title="The day\'s reservations as a spreadsheet">Export CSV</button><button class="btn" id="drPrint" type="button">Print</button>');
  $('#drCsv').onclick = () => downloadFile(`/day-report?${qsOf({ date: day(), format: 'csv' })}`, `daily-report-${day()}.csv`, $('#drCsv')).catch((e) => toast(e.message, true));
  $('#drPrint').onclick = () => { document.body.classList.remove('print-receipt'); window.print(); };
  view.innerHTML = `${dayBar(day())}<div id="drBody"><div class="card"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div></div>`;
  const checkin = (b) => (b.checkedOutAt ? 'Finished' : b.checkedInAt ? 'On court' : ['cancelled', 'rejected', 'pending'].includes(b.status) ? '-' : 'Not arrived');
  async function load() {
    const d = await api(`/day-report?${qsOf({ date: day() })}`);
    const t = d.totals;
    const facts = (rows) => `<ul class="facts">${rows.map(([k, v]) => `<li><span>${k}</span><b class="num">${v}</b></li>`).join('')}</ul>`;
    $('#drBody').innerHTML = `<div class="report-title"><h2>${esc(fmtLong(d.date))}</h2>
        <span class="muted">${d.now ? `As of ${esc(d.now)}` : `Generated ${esc(fmtStamp(d.generatedAt))}`} &middot; ${esc(state.me.firstName)} ${esc(state.me.lastName)}</span></div>
      <div class="card ribbon">
        <div><div class="k">Reservations</div><div class="v num">${t.bookings}</div><div class="s">${t.online} online &middot; ${t.desk} at the desk</div></div>
        <div><div class="k">Court hours booked</div><div class="v num">${t.hoursBooked}</div><div class="s">${d.usage.overall === null ? 'no court open' : `${pct(d.usage.overall)} of ${d.usage.hoursOpen} open court hours`}</div></div>
        <div><div class="k">Checked in</div><div class="v num">${t.checkedIn}</div><div class="s">${t.onCourt} on court &middot; ${t.finished} finished</div></div>
        ${d.money ? `<div><div class="k">Paid</div><div class="v num">${peso(d.money.paid)}</div><div class="s">${peso(d.money.due)} still to collect</div></div>`
    : `<div><div class="k">Cancelled</div><div class="v num">${t.cancelled}</div><div class="s">${t.rejected} rejected</div></div>`}
      </div>
      <div class="grid2 even">
        <div class="card"><div class="pad"><h3>Reservations</h3>${facts([['Confirmed', t.confirmed], ['Completed', t.completed], ['Waiting for approval', t.pending], ['Cancelled', t.cancelled], ['Rejected', t.rejected]])}</div></div>
        <div class="card"><div class="pad"><h3>Arrivals</h3>${facts([['Still to arrive', t.waiting], ['On court now', t.onCourt], ['Finished (checked out)', t.finished], ['Ended without a check-in', t.notArrived]])}</div></div>
      </div>
      <div class="card mb"><div class="pad"><h3>Court usage</h3></div><div class="tablewrap"><table>
        <thead><tr><th>Court</th><th>Status</th><th class="r">Reservations</th><th class="r">Hours booked</th><th class="r">Hours open</th><th style="width:30%;">Usage</th></tr></thead>
        <tbody>${d.courts.map((c) => `<tr><td><b>${esc(c.name)}</b><span class="sub">${esc(c.openTime)}–${esc(c.closeTime)}</span></td><td>${pillC(c.status)}</td>
          <td class="r num">${c.bookings}</td><td class="r num">${c.hoursBooked}</td><td class="r num">${c.hoursOpen}</td>
          <td>${c.usage === null ? '<span class="muted">Not open</span>' : usageBar(c.usage)}</td></tr>`).join('') || emptyRow(6, 'No courts yet.')}</tbody></table></div>
        ${d.busiest.length ? `<div class="pad muted">Busiest: ${d.busiest.map((b) => `${esc(b.hour)} (${plural(b.booked, 'court')} booked)`).join(', ')}</div>` : ''}</div>
      <div class="card"><div class="pad"><h3>Reservations by time</h3></div><div class="tablewrap"><table>
        <thead><tr><th>Time</th><th>Court</th><th>Customer</th><th>Status</th><th>Payment</th><th>Check-in</th></tr></thead>
        <tbody>${d.bookings.length ? d.bookings.map((b) => `<tr class="click" data-id="${esc(b._id)}"><td class="num"><b>${esc(b.startTime)}–${esc(b.endTime)}</b></td>
          <td>${esc(b.courtName)}</td><td>${esc(b.customer)}${b.source === 'desk' ? '<span class="sub">at the desk</span>' : ''}</td>
          <td>${pillS(b.status)}</td><td>${pillP(b.paymentStatus)}</td><td class="muted">${checkin(b)}</td></tr>`).join('') : emptyRow(6, 'No reservations on this day.')}</tbody></table></div></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const dayClick = dayBarClicks(drUi, go);
  view.onclick = (e) => {
    if (dayClick(e)) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr && can('bookings')) openBooking(tr.dataset.id);
  };
}

/* =====================================================================
   SF-133 Court utilization: which courts are used, hour by hour
   ===================================================================== */
EXTRA.views.usage = { label: 'Court usage', perm: 'reports.daily', render: renderUsage };
const usUi = { date: '' };
let usageTimer = null;

async function renderUsage(params) {
  const go = bindState(usUi, { date: '' }, params); // #/usage?date=2026-11-20
  const day = () => usUi.date || todayStr();
  setHead('Court usage', 'How much each court is used through the day. Today updates every minute.');
  view.innerHTML = `${dayBar(day())}<div id="usBody"><div class="card"><div class="skeleton"><i></i><i></i><i></i></div></div></div>`;
  const STATE = { closed: 'Closed', free: 'Free', past: 'Not booked', blocked: 'Blocked' };
  const cell = (x, isNow) => {
    const now = isNow ? ' nowcol' : '';
    if (x.state !== 'booked') return `<td class="us-${x.state}${now}" title="${esc(x.state === 'blocked' && x.reason ? `Blocked: ${x.reason}` : STATE[x.state])}"></td>`;
    const cls = x.status === 'pending' ? 'pend' : x.finished ? 'done' : x.checkedIn ? 'on' : '';
    return `<td class="us-booked ${cls}${now}" data-id="${esc(x.id)}" title="${esc(`${x.start}–${x.end} · ${x.customer} · ${x.ref}${x.status === 'pending' ? ' (waiting for approval)' : x.checkedIn ? ' (on court)' : x.finished ? ' (finished)' : ''}`)}"></td>`;
  };
  async function load() {
    const d = await api(`/day-report?${qsOf({ date: day() })}`);
    const nowIdx = d.now ? d.hours.findIndex((h) => h.slice(0, 2) === d.now.slice(0, 2)) : -1;
    const inUse = nowIdx >= 0 ? d.byHour[nowIdx] : null;
    $('#usBody').innerHTML = `<div class="card ribbon cols3">
        <div><div class="k">${inUse ? `Courts in use now (${esc(d.now)})` : 'Court hours booked'}</div><div class="v num">${inUse ? `${inUse.booked} of ${inUse.open}` : d.usage.hoursBooked}</div>
          <div class="s">${inUse ? `${d.courts.filter((c) => c.cells[nowIdx] && c.cells[nowIdx].checkedIn).length} checked in` : `of ${d.usage.hoursOpen} open court hours`}</div></div>
        <div><div class="k">Usage for the day</div><div class="v num">${pct(d.usage.overall)}</div><div class="s">${d.usage.hoursBooked} of ${d.usage.hoursOpen} court hours booked</div></div>
        <div><div class="k">Busiest time</div><div class="v num">${d.busiest.length ? esc(d.busiest[0].hour) : '–'}</div><div class="s">${d.busiest.length ? `${plural(d.busiest[0].booked, 'court')} booked` : 'no bookings'}</div></div>
      </div>
      <div class="card"><div class="tablewrap"><table class="usage-grid">
        <thead><tr><th>Court</th>${d.hours.map((h, i) => `<th class="${i === nowIdx ? 'nowcol' : ''}">${esc(h.slice(0, 2))}</th>`).join('')}<th class="r">Usage</th></tr></thead>
        <tbody>${d.courts.map((c) => `<tr><th scope="row">${esc(c.name)}${c.status !== 'available' ? `<span class="sub">${esc(c.status === 'maintenance' ? 'Under maintenance' : c.status)}</span>` : ''}</th>
          ${c.cells.map((x, i) => cell(x, i === nowIdx)).join('')}<td class="r num">${pct(c.usage)}</td></tr>`).join('')}
          <tr class="totals"><th scope="row">Courts booked</th>${d.byHour.map((h, i) => `<td class="num${i === nowIdx ? ' nowcol' : ''}">${h.open ? `${h.booked}/${h.open}` : ''}</td>`).join('')}<td></td></tr></tbody></table></div>
        <div class="legend usage-legend"><span><i class="us-booked"></i>Booked</span><span><i class="us-booked on"></i>On court</span><span><i class="us-booked done"></i>Finished</span>
          <span><i class="us-booked pend"></i>Waiting for approval</span><span><i class="us-blocked"></i>Blocked</span><span><i class="us-free"></i>Free</span><span><i class="us-closed"></i>Closed</span></div></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  clearInterval(usageTimer);
  usageTimer = setInterval(() => {
    if (currentView !== 'usage') { clearInterval(usageTimer); return; }
    if (!usUi.date && !document.hidden) refreshView();
  }, 60000);
  const dayClick = dayBarClicks(usUi, go);
  view.onclick = (e) => {
    if (dayClick(e)) return;
    const td = e.target.closest('td[data-id]');
    if (td && can('bookings')) openBooking(td.dataset.id);
  };
}

/* =====================================================================
   SF-132 Payment report for a shift
   ===================================================================== */
EXTRA.views.shiftpay = { label: 'Shift payments', perm: 'payments', render: renderShiftPay };
const SP_DEFAULTS = { date: '', from: '', to: '', mine: '' };
const spUi = { ...SP_DEFAULTS };

async function renderShiftPay(params) {
  const go = bindState(spUi, SP_DEFAULTS, params); // #/shiftpay?from=08:00&to=16:00&mine=1
  setHead('Shift payments', 'What was taken during a shift, by payment method. Print it for the handover.', '<button class="btn" id="spPrint" type="button">Print</button>');
  $('#spPrint').onclick = () => { document.body.classList.remove('print-receipt'); window.print(); };
  view.innerHTML = `<div class="bar">
      <input type="date" id="spDate" value="${esc(spUi.date || todayStr())}" aria-label="Day" />
      <label class="inl">From <input type="time" id="spFrom" value="${esc(spUi.from)}" /></label>
      <label class="inl">To <input type="time" id="spTo" value="${esc(spUi.to)}" /></label>
      <button class="btn" id="spShift" type="button" title="Use your shift on this day">My shift</button>
      <label class="check"><input type="checkbox" id="spMine" ${spUi.mine ? 'checked' : ''} /><span>Only what I recorded</span></label></div>
    <div id="spBody"><div class="card"><div class="skeleton"><i></i><i></i><i></i></div></div></div>`;
  const groupList = (rows, key) => (rows.length ? `<ul class="facts">${rows.map((g) => `<li><span>${esc(g[key])} <span class="muted">(${g.count} ${g.count === 1 ? 'entry' : 'entries'})</span></span>
      <b class="num">${peso(g.net)}</b></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>');
  async function load() {
    const d = await api(`/shift-payments?${qsOf(spUi)}`);
    if (!spUi.from && !spUi.to) { $('#spFrom').value = d.from; $('#spTo').value = d.to === '24:00' ? '' : d.to; }
    const span = `${d.from}–${d.to}`;
    const which = d.shift ? `Your shift${d.shift.note ? `: ${d.shift.note}` : ''}` : d.from === '00:00' && d.to === '24:00' ? 'The whole day' : 'The times chosen';
    $('#spBody').innerHTML = `<div class="card mb"><div class="pad daily-head"><h2>${esc(fmtLong(d.date))}, ${esc(span)}</h2>
        <span class="muted">${esc(which)} &middot; ${d.mine ? 'only what you recorded' : 'everyone at the desk'}</span></div>
        <div class="ribbon cols3 inner">
          <div><div class="k">Received</div><div class="v num">${peso(d.totals.received)}</div><div class="s">${plural(d.totals.payments, 'payment')}</div></div>
          <div><div class="k">Refunded</div><div class="v num">${peso(d.totals.refunded)}</div><div class="s">${plural(d.totals.refunds, 'refund')}</div></div>
          <div><div class="k">Net</div><div class="v num">${peso(d.totals.net)}</div><div class="s">${d.totals.failed ? `${plural(d.totals.failed, 'failed payment')} (no money)` : 'received minus refunded'}</div></div></div></div>
      <div class="grid2 even">
        <div class="card"><div class="pad"><h3>By payment method</h3>${groupList(d.byMethod, 'method')}<p class="muted" style="margin-bottom:0;">The Cash line is what should be in the drawer (after refunds).</p></div></div>
        <div class="card"><div class="pad"><h3>By staff member</h3>${groupList(d.byStaff, 'name')}</div></div></div>
      <div class="card"><div class="tablewrap"><table>
        <thead><tr><th>Time</th><th>Booking</th><th>Customer</th><th>Type</th><th>Method</th><th class="r">Amount</th><th>Recorded by</th></tr></thead>
        <tbody>${d.transactions.length ? d.transactions.map((x) => `<tr><td class="num">${esc(new Date(x.at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }))}</td>
          <td class="num"><b>${esc(x.referenceNumber)}</b><span class="sub">${esc(x.courtName)}</span></td><td>${esc(x.customer)}</td>
          <td>${pillX(`t-${x.type}`, { payment: 'Payment', refund: 'Refund', failed: 'Failed' }[x.type])}${x.note ? `<span class="sub">${esc(x.note)}</span>` : ''}</td>
          <td>${esc(x.method || '-')}</td><td class="r num ${x.type === 'refund' ? 'neg' : ''}">${x.type === 'refund' ? '−' : ''}${peso(x.amount)}</td><td>${esc(x.recordedBy || 'Online (automatic)')}</td></tr>`).join('')
          : emptyRow(7, 'No payments or refunds in this time.')}</tbody></table></div></div>`;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  view.onchange = (e) => {
    if (e.target.id === 'spDate') spUi.date = e.target.value === todayStr() ? '' : e.target.value;
    else if (e.target.id === 'spFrom') spUi.from = e.target.value;
    else if (e.target.id === 'spTo') spUi.to = e.target.value;
    else if (e.target.id === 'spMine') spUi.mine = e.target.checked ? '1' : '';
    else return;
    go();
  };
  view.onclick = (e) => {
    if (!e.target.closest('#spShift')) return;
    spUi.from = ''; spUi.to = ''; $('#spFrom').value = ''; $('#spTo').value = ''; go();
  };
}

/* =====================================================================
   SF-134 Shift information: admins assign shifts, staff see their own
   ===================================================================== */
EXTRA.views.shifts = { label: 'Shifts', perm: 'shifts', render: renderShifts };
const shUi = { week: '' }; // Monday of the week shown ('' = this week)

async function renderShifts(params) {
  const go = bindState(shUi, { week: '' }, params); // #/shifts?week=2026-11-23
  setHead('Shifts', 'Who works when. Staff see their own shifts and are told when one is added or changed.', '<button class="btn primary" id="shNew" type="button">Add shift</button>');
  const d = await api(`/shifts?${qsOf({ from: shUi.week })}`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(d.from, i));
  const cells = {};
  d.shifts.forEach((s) => { (cells[`${s.user}|${s.date}`] = cells[`${s.user}|${s.date}`] || []).push(s); });
  const head = (x) => new Date(`${x}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short' });
  view.innerHTML = `<div class="bar"><button class="btn" data-week="-7" type="button">&larr; Previous week</button><button class="btn" data-week="0" type="button">This week</button>
      <button class="btn" data-week="7" type="button">Next week &rarr;</button><span class="muted" style="align-self:center;">${esc(head(d.from))} – ${esc(head(d.to))}</span></div>
    <div class="card"><div class="tablewrap"><table class="shift-grid">
      <thead><tr><th>Team member</th>${days.map((x) => `<th class="${x === d.today ? 'today' : ''}">${esc(head(x))}</th>`).join('')}</tr></thead>
      <tbody>${d.team.length ? d.team.map((u) => `<tr><th scope="row">${esc(u.name)}<span class="sub">${esc(ROLE_LABEL[u.role] || u.role)}</span></th>
        ${days.map((x) => `<td class="${x === d.today ? 'today' : ''}">${(cells[`${u.id}|${x}`] || []).map((s) => `<button type="button" class="shift-chip" data-shift="${esc(s._id)}">${esc(s.startTime)}–${esc(s.endTime)}${s.note ? `<span>${esc(s.note)}</span>` : ''}</button>`).join('')}
          <button type="button" class="shift-add" data-add="${esc(u.id)}|${x}" title="Add a shift" aria-label="Add a shift for ${esc(u.name)} on ${esc(head(x))}">+</button></td>`).join('')}</tr>`).join('')
        : emptyRow(8, 'No staff yet. Add them under People -> Staff.')}</tbody></table></div></div>`;
  refreshView = () => renderShifts(null);
  $('#shNew').onclick = () => shiftDialog(null, { team: d.team, date: d.today >= d.from && d.today <= d.to ? d.today : d.from });
  view.onclick = (e) => {
    const w = e.target.closest('[data-week]');
    if (w) { const n = Number(w.dataset.week); shUi.week = n ? addDays(d.from, n) : ''; go(); return; }
    const a = e.target.closest('[data-add]');
    if (a) { const [userId, date] = a.dataset.add.split('|'); shiftDialog(null, { team: d.team, userId, date }); return; }
    const c = e.target.closest('[data-shift]');
    if (c) shiftDialog(d.shifts.find((s) => s._id === c.dataset.shift), { team: d.team });
  };
}

function shiftDialog(s, { team, userId = '', date = '' }) {
  openModal(s ? 'Change shift' : 'Add a shift', `<form id="shForm">
    ${field('Team member', `<select name="userId" required>${optionList(team.map((u) => [u.id, `${u.name} (${ROLE_LABEL[u.role] || u.role})`]), s ? s.user : userId)}</select>`)}
    <div class="row2">${field('Day', `<input type="date" name="date" value="${esc(s ? s.date : date)}" required />`)}
      ${field('Note (optional)', `<input name="note" maxlength="100" value="${esc(s ? s.note : '')}" placeholder="e.g. Front desk, Opening" />`)}</div>
    <div class="row2">${field('Starts', `<input type="time" name="startTime" value="${esc(s ? s.startTime : '08:00')}" required />`)}
      ${field('Ends', `<input type="time" name="endTime" value="${esc(s ? (s.endTime === '24:00' ? '23:59' : s.endTime) : '16:00')}" required />`, 'Same day; for a shift until midnight use 23:59.')}</div>
    <div class="msg error hidden" role="alert"></div>
    <div class="dlg-foot">${s ? '<button type="button" class="btn danger" data-del>Remove shift</button>' : ''}<button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">${s ? 'Save' : 'Add shift'}</button></div></form>`);
  modalBody.onclick = async (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    if (!e.target.closest('[data-del]')) return;
    try {
      await api(`/shifts/${s._id}`, { method: 'DELETE', version: s.writeTS });
      closeModal(); toast('Shift removed. They were told.'); refreshView();
    } catch (x) { showErr($('#shForm .msg'), x.message); }
  };
  onSubmit($('#shForm'), async (x) => {
    await api(s ? `/shifts/${s._id}` : '/shifts', { method: s ? 'PUT' : 'POST', body: x, version: s ? s.writeTS : undefined });
    closeModal();
    toast(s ? 'Shift saved. They were told.' : 'Shift added. They were told.');
    refreshView();
  });
}

EXTRA.views.myshifts = { label: 'My shifts', perm: 'shifts.view', render: renderMyShifts };
const untilText = (end, now) => { const m = U2min(end) - U2min(now); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
const U2min = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

async function renderMyShifts() {
  setHead('My shifts', 'When you work. You are told when an administrator adds or changes one of your shifts.');
  const d = await api('/shifts/mine');
  const line = (s) => `<li><span><b>${esc(dayLabel(s.date))}</b>${s.note ? ` <span class="muted">${esc(s.note)}</span>` : ''}</span><b class="num">${esc(s.startTime)}–${esc(s.endTime)}</b></li>`;
  view.innerHTML = `<div class="card mb"><div class="pad">${d.current
    ? `<h2>On shift now: ${esc(d.current.startTime)}–${esc(d.current.endTime)}</h2><p class="muted" style="margin-bottom:0;">${d.current.note ? `${esc(d.current.note)} &middot; ` : ''}ends in ${esc(untilText(d.current.endTime, d.now))}</p>`
    : d.next ? `<h2>Next shift: ${esc(dayLabel(d.next.date))}, ${esc(d.next.startTime)}–${esc(d.next.endTime)}</h2>${d.next.note ? `<p class="muted" style="margin-bottom:0;">${esc(d.next.note)}</p>` : ''}`
      : '<h2>No shifts coming up</h2><p class="muted" style="margin-bottom:0;">Ask an administrator if you expected one (Help &amp; support).</p>'}</div></div>
    <div class="grid2 even"><div class="card"><div class="pad"><h3>Coming up</h3>${d.upcoming.length ? `<ul class="facts">${d.upcoming.map(line).join('')}</ul>` : '<p class="muted">None yet.</p>'}</div></div>
      <div class="card"><div class="pad"><h3>Last 7 days</h3>${d.recent.length ? `<ul class="facts">${d.recent.map(line).join('')}</ul>` : '<p class="muted">None.</p>'}</div></div></div>`;
  refreshView = renderMyShifts;
}

/** Dashboard subtitle: "Your shift: 08:00–16:00 (Front desk)". Staff always see a line; admins only when they have shifts. */
async function shiftLine() {
  if (!can('shifts.view')) return;
  let d;
  try { d = await api('/shifts/mine'); } catch (e) { return; }
  let text = '';
  if (d.current) text = `On shift until ${d.current.endTime}${d.current.note ? ` (${d.current.note})` : ''}`;
  else if (d.next && d.next.date === d.today) text = `Your shift today: ${d.next.startTime}–${d.next.endTime}${d.next.note ? ` (${d.next.note})` : ''}`;
  else if (d.next) text = `No shift today · next: ${dayLabel(d.next.date)}, ${d.next.startTime}`;
  else if (!can('shifts')) text = 'No shifts scheduled';
  const sub = $('#subtitle');
  if (text && sub && currentView === 'dashboard') sub.textContent = `${sub.textContent} · ${text}`;
}

/* =====================================================================
   SF-135 My activity
   ===================================================================== */
EXTRA.views.activity = { label: 'My activity', perm: 'dashboard', render: renderActivity };
const ACT_DEFAULTS = { page: 1, q: '', date: '' };
const actUi = { ...ACT_DEFAULTS };

async function renderActivity(params) {
  const go = bindState(actUi, ACT_DEFAULTS, params); // #/activity?page=2
  setHead('My activity', `What you did in the console, newest first. ${can('audit') ? "Everyone's activity is under Security -> Audit logs." : 'Administrators can see this for every account.'}`);
  view.innerHTML = `<div class="bar"><input class="grow" id="acQ" type="search" placeholder="Search what you did (press /)" value="${esc(actUi.q)}" aria-label="Search my activity" />
    <label class="inl">Day <input type="date" id="acDate" value="${esc(actUi.date)}" /></label></div>
    <div class="card" id="listCard"><div class="skeleton"><i></i><i></i><i></i><i></i></div></div>`;
  async function load() {
    const d = await api(`/activity?${qsOf({ page: actUi.page, limit: 25, q: actUi.q, date: actUi.date })}`);
    if (d.page > d.pages) { actUi.page = d.pages; stateTo(actUi, ACT_DEFAULTS, { push: false }); return load(); }
    $('#listCard').innerHTML = `<div class="tablewrap"><table><thead><tr><th>When</th><th>What you did</th><th>Details</th></tr></thead>
      <tbody>${d.logs.length ? d.logs.map((l) => `<tr><td class="num">${esc(fmtStamp(l.createdAt))}</td><td>${esc(l.action)}</td>
        <td class="muted">${esc(l.detail || '-')}${l.ip ? `<span class="sub">IP ${esc(l.ip)}</span>` : ''}</td></tr>`).join('')
        : emptyRow(3, actUi.q || actUi.date ? 'Nothing matches.' : 'Nothing recorded yet.')}</tbody></table></div>${pager2(d, 'action')}`;
    return undefined;
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  const search = debounce(() => { actUi.q = $('#acQ').value.trim(); actUi.page = 1; go(false); });
  view.oninput = (e) => { if (e.target.id === 'acQ') search(); };
  view.onchange = (e) => { if (e.target.id === 'acDate') { actUi.date = e.target.value; actUi.page = 1; go(); } };
  view.onclick = (e) => { const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { actUi.page = Number(pg.dataset.page); go(); } };
}

/* =====================================================================
   SF-136 Help & support
   ===================================================================== */
EXTRA.views.help = { label: 'Help & support', perm: 'dashboard', render: renderHelp };
const HELP_TOPIC = { how_to: 'How do I...?', problem: 'Something is not working', account: 'My account or access', schedule: 'My shift or schedule', other: 'Something else' };
const HELP_STATUS = { open: 'Waiting for an answer', answered: 'Answered', closed: 'Closed' };
const HELP_CLASS = { open: 'mt-open', answered: 'mt-fixed', closed: 'u-off' };
const GUIDES = [
  { perm: 'bookings', title: 'Find a booking', steps: ['Bookings: type a reference, a name (first, last or full), an email, a mobile number or a payment reference. A date like 2026-11-20 finds that day.',
    'Narrow it down with status, payment, court, date and <b>time</b>: morning, afternoon, evening, or who is playing at a given hour.'] },
  { perm: 'bookings', title: 'Book a walk-in customer', steps: ['Press <b>Walk-in booking</b> on the Dashboard or Bookings.', 'Choose a guest (name and mobile) or find a customer\'s account.',
    'Pick the court, day and start time. Only open slots are listed.', 'If they pay now, choose how. The receipt opens by itself so you can print it.'] },
  { perm: 'checkins', title: 'Check a customer in and out', steps: ['Press <b>Verify booking</b> (Dashboard or Check-ins), then scan their QR code or type the reference (MKI-...).',
    'Green: good to play now. Amber: valid, but not now. Red: do not let them play.', 'Press <b>Check in now</b>. When they leave, open the booking and press <b>Check out</b>.'] },
  { perm: 'bookings', title: 'Move a booking to another time or court', steps: ['Open the booking. <b>Reschedule...</b> changes the day, time or court.',
    '<b>Assign court...</b> keeps the time and the fee and only changes the court, even while they are playing.', 'The customer is told either way.'] },
  { perm: 'payments', title: 'Take a payment and print a receipt', steps: ['Open the booking, choose the method under Payment and press <b>Mark paid</b>.',
    'Press <b>Receipt</b>, then <b>Print receipt</b>. Only the receipt prints.', 'GCash or bank references customers sent wait under Payments -> <b>Verification</b>.'] },
  { perm: 'payments', title: 'Refund a customer', steps: ['Payments -> <b>Refunds</b> lists paid bookings that were cancelled, with what the cancellation policy says to give back.',
    'Record the amount, how it was returned and why. The customer is told.'] },
  { perm: 'payments', title: 'End of shift: count the payments', steps: ['Payments -> <b>Shift payments</b> shows what was taken during your shift, by method. The Cash line is what should be in the drawer.',
    'Tick <b>Only what I recorded</b> for just your payments, then <b>Print</b> for the handover.'] },
  { perm: 'maintenance.report', title: 'Report broken equipment or a court problem', steps: ['Courts -> Maintenance -> <b>Report a problem</b>. Mark it urgent if it is not safe to play.',
    'You can also set the court to maintenance so customers can\'t book it. You are told when it is fixed.'] },
  { perm: 'incidents.report', title: 'Record an incident', steps: ['Customer care -> Incidents -> <b>Record an incident</b>, or open the booking and press <b>Record an incident...</b>.',
    'Say what happened, when, and what you did. Tick <b>Serious</b> if someone was badly hurt or help was called.'] },
  { perm: 'reports.daily', title: 'Daily report and court usage', steps: ['Insights -> <b>Daily report</b>: reservations, arrivals and payments for one day. Print it or export it as CSV.',
    'Courts -> <b>Court usage</b>: which courts are booked, hour by hour. Today updates every minute.'] },
  { perm: 'shifts.view', title: 'Your shifts', steps: ['My account -> <b>My shifts</b> lists your shifts for the coming weeks; today\'s shift is also on the Dashboard.', 'You are told when an administrator adds or changes one.'] },
  { perm: 'dashboard', title: 'Notifications', steps: ['The bell (top right) shows how many alerts are unread and opens <b>My notifications</b>: new bookings, cancellations, schedule changes, payments to verify and more. <b>Open</b> takes you to what an alert is about.',
    'A message pops up when a new alert arrives while you work.'] },
  { perm: 'dashboard', title: 'Sign out safely', steps: ['Press <b>Sign out</b> at the bottom of the menu. It ends your session on the server, so nobody can reopen the console with Back.',
    'Always sign out on a shared computer. My account shows the other devices you are signed in on, and can sign them out.'] },
];

function helpThread(r, admin) {
  return `<div class="help-req" data-id="${esc(r._id)}">
    <div class="row-between"><div><b>${r.urgent && r.status === 'open' ? `${pillX('p-failed', 'Urgent')} ` : ''}${esc(r.subject)}</b>
      <div class="muted">${admin ? `${esc(r.userName)} (${esc(ROLE_LABEL[r.userRole] || r.userRole)}) &middot; ` : ''}${esc(HELP_TOPIC[r.topic] || r.topic)} &middot; ${esc(fmtStamp(r.createdAt))}</div></div>
      ${pillX(HELP_CLASS[r.status], HELP_STATUS[r.status])}</div>
    <p class="pre">${esc(r.message)}</p>
    ${r.replies.length ? `<div class="thread">${r.replies.map((x) => `<div class="reply${x.byRole === 'admin' ? ' cust' : ''}"><b>${esc(x.byName)}</b> <span class="muted">${esc(fmtStamp(x.at))}</span><div class="pre">${esc(x.message)}</div></div>`).join('')}</div>` : ''}
    ${r.status !== 'closed' ? `<form class="help-reply"><textarea name="message" rows="2" maxlength="2000" required placeholder="${admin ? 'Your answer' : 'Add details or reply'}" aria-label="Reply"></textarea>
      <div class="msg error hidden" role="alert"></div>
      <div class="btnrow"><button class="btn small primary" type="submit">${admin ? 'Send answer' : 'Send'}</button>${admin ? '<button class="btn small" type="submit" name="close" value="1">Send and close</button>' : ''}
        <button class="btn small" type="button" data-status="closed">Close</button></div></form>`
    : '<div class="btnrow"><button class="btn small" type="button" data-status="open">Reopen</button></div>'}</div>`;
}

/** Reply / close / reopen in a list of help threads (the Help page and the admins' Help requests). */
function wireHelpThreads(list, admin) {
  view.onsubmit = async (e) => {
    const form = e.target.closest('.help-reply');
    if (!form) return;
    e.preventDefault();
    const btns = form.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });
    try {
      const close = Boolean(e.submitter && e.submitter.name === 'close');
      await api(`/help/${form.closest('[data-id]').dataset.id}/reply`, { method: 'POST', body: { message: form.message.value, status: close ? 'closed' : undefined } });
      toast(admin ? `Answer sent${close ? ' and closed' : ''}. They were told.` : 'Sent. The administrators were told.');
      refreshView();
    } catch (x) { showErr(form.querySelector('.msg'), x.message); btns.forEach((b) => { b.disabled = false; }); }
  };
  return async (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return false;
    const r = list().find((x) => x._id === b.closest('[data-id]').dataset.id);
    try { await api(`/help/${r._id}`, { method: 'PATCH', body: { status: b.dataset.status }, version: r.writeTS }); toast(b.dataset.status === 'closed' ? 'Closed' : 'Reopened'); refreshView(); } catch (x) { toast(x.message, true); }
    return true;
  };
}

async function renderHelp() {
  setHead('Help & support', 'How to do things in the console, and a direct line to the administrators');
  const d = await api('/help/mine');
  const guides = GUIDES.filter((g) => can(g.perm));
  view.innerHTML = `<div class="grid2 even help-grid">
    <div class="card"><div class="pad"><h2>How to...</h2><p class="muted" style="margin:4px 0 0;">Only what your account can do is listed. Press Ctrl+K to search the menu.</p></div>
      ${guides.map((g) => `<details class="guide"><summary>${esc(g.title)}</summary><ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol></details>`).join('')}</div>
    <div>
      <div class="card"><div class="pad"><h2>Ask the administrators</h2>
        <form id="helpForm">
          ${field('About', `<select name="topic">${optionList(d.topics.map((t) => [t.id, t.label]), 'how_to')}</select>`)}
          ${field('Subject', '<input name="subject" maxlength="120" required placeholder="e.g. Receipt printer not working" />')}
          ${field('Message', '<textarea name="message" rows="4" maxlength="2000" required placeholder="What happened, what you tried, which booking or court"></textarea>')}
          <label class="check"><input type="checkbox" name="urgent" /><span><b>Urgent</b>It stops you from working right now.</span></label>
          <div class="msg error hidden" role="alert"></div>
          <div class="btnrow" style="margin-top:12px;"><button class="btn primary" type="submit">Send to the administrators</button></div></form>
        ${d.contacts.length ? `<h3 style="margin-top:18px;">Administrators</h3><ul class="contact-list">${d.contacts.map((c) => `<li><b>${esc(c.name)}</b><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? `<span class="num">${esc(c.phone)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div></div>
      <div class="card"><div class="pad"><h2>Your requests</h2>${d.requests.length ? d.requests.map((r) => helpThread(r, false)).join('') : '<p class="muted">None yet. Answers show here, and you are told in Notifications.</p>'}</div></div>
    </div></div>`;
  refreshView = renderHelp;
  onSubmit($('#helpForm'), async (x) => {
    await api('/help', { method: 'POST', body: { topic: x.topic, subject: x.subject, message: x.message, urgent: x.urgent } });
    toast('Sent. The administrators were told; their answer will show here.');
    refreshView();
  });
  const statusClick = wireHelpThreads(() => d.requests, false);
  view.onclick = (e) => { statusClick(e); };
}

EXTRA.views.helpdesk = { label: 'Help requests', perm: 'help', render: renderHelpdesk };
const hdUi = { status: 'open' };

async function renderHelpdesk(params) {
  const go = bindState(hdUi, { status: 'open' }, params); // #/helpdesk?status=answered
  setHead('Help requests', 'Questions from staff. Answer here; they are told at once.');
  const d = await api(`/help?${qsOf({ status: hdUi.status })}`);
  view.innerHTML = `<div class="tabs" role="tablist">${[['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed'], ['', 'All']].map(([k, l]) =>
    `<button type="button" role="tab" class="${hdUi.status === k ? 'on' : ''}" data-tab="${k}" aria-selected="${hdUi.status === k}">${l}${k ? ` <span class="muted">${d.counts[k]}</span>` : ''}</button>`).join('')}</div>
    ${d.requests.length ? `<div class="card"><div class="pad">${d.requests.map((r) => helpThread(r, true)).join('')}</div></div>`
    : `<div class="card"><div class="empty">${hdUi.status === 'open' ? 'Nothing waiting for an answer.' : 'Nothing here.'}</div></div>`}`;
  refreshView = () => renderHelpdesk(null);
  const statusClick = wireHelpThreads(() => d.requests, true);
  view.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { hdUi.status = t.dataset.tab; go(); return; }
    await statusClick(e);
  };
}

/* =====================================================================
   SF-127 My notifications: this account's alerts on their own page
   (the bell opens it; they are not on the dashboard)
   ===================================================================== */
EXTRA.views.alerts = { label: 'My notifications', perm: 'dashboard', render: renderMyAlerts };
const alUi = { filter: '' };
const notesApi = (p, opts) => request(`${window.API_ROOT || '/api'}/notifications${p}`, opts);
const ALERT_REF = /\bMKI-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/; // a booking reference in the message

async function renderMyAlerts(params) {
  const go = bindState(alUi, { filter: '' }, params); // #/alerts?filter=unread
  setHead('My notifications', 'Alerts for your account: new bookings, cancellations, payments to verify, schedule changes and more.',
    '<button class="btn" id="alReadAll" type="button" hidden>Mark all as read</button>');
  view.innerHTML = `<div class="tabs" role="tablist" id="alTabs"></div>
    <div class="card" id="alList"><div class="skeleton" aria-label="Loading"><i></i><i></i><i></i></div></div>
    <div class="al-more" id="alMoreWrap" hidden><button class="btn" id="alMore" type="button">Show older notifications</button></div>`;
  let items = [];
  let more = false;
  let unread = 0;
  const dayTitle = (k) => (k === todayStr() ? 'Today' : k === addDays(todayStr(), -1) ? 'Yesterday' : fmtLong(k));
  const clock = (d) => new Date(d).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  function paint() {
    $('#alTabs').innerHTML = [['', 'All'], ['unread', 'Unread']].map(([k, l]) => `<button type="button" role="tab" class="${alUi.filter === k ? 'on' : ''}" data-tab="${k}"
      aria-selected="${alUi.filter === k}">${l}${k === 'unread' && unread ? ` <span class="muted">${unread}</span>` : ''}</button>`).join('');
    $('#alReadAll').hidden = !unread;
    $('#alMoreWrap').hidden = !more;
    if (!items.length) {
      $('#alList').innerHTML = `<div class="empty">${alUi.filter ? "You're all caught up: nothing unread."
        : 'No notifications yet. You will be told here about new bookings, cancellations, schedule changes, payments to verify and more.'}</div>`;
      return;
    }
    let last = '';
    $('#alList').innerHTML = items.map((n) => {
      const k = toDateStr(n.createdAt);
      const head = k !== last ? `<div class="al-day">${esc(dayTitle(k))}</div>` : '';
      last = k;
      const ref = (String(n.message).match(ALERT_REF) || [])[0];
      const link = n.link && /^#\//.test(n.link) ? n.link : ref && can('bookings') ? `#/bookings?q=${encodeURIComponent(ref)}` : '';
      return `${head}<div class="al-item ${n.read ? 'read' : 'unread'}" data-id="${esc(n._id)}"${n.read ? '' : ' tabindex="0" role="button" title="Mark as read"'}>
        <i class="al-dot" aria-hidden="true"></i>
        <div class="al-body"><div class="al-msg">${esc(n.message)}</div>
          <div class="al-meta"><span class="num">${esc(clock(n.createdAt))}</span>${link ? `<a href="${esc(link)}" data-open>${n.link ? 'Open' : 'Find the booking'} &rarr;</a>` : ''}${n.read ? '' : pillX('al-new', 'New')}</div></div></div>`;
    }).join('');
  }
  async function load(append = false) {
    const qs = new URLSearchParams({ limit: 25 });
    if (alUi.filter) qs.set('filter', 'unread');
    if (append && items.length) qs.set('before', items[items.length - 1]._id);
    const d = await notesApi(`?${qs}`);
    items = append ? items.concat(d.notifications) : d.notifications;
    more = Boolean(d.more);
    unread = Number(d.unread) || 0;
    paint();
  }
  async function markRead(id) {
    const n = items.find((x) => x._id === id);
    if (!n || n.read) return;
    try {
      await notesApi(`/${id}/read`, { method: 'PATCH' });
      n.read = true;
      unread = Math.max(unread - 1, 0);
      paint();
      refreshBell();
    } catch (e) { toast(e.message, true); }
  }
  refreshView = () => load().catch((e) => toast(e.message, true));
  refreshView();
  $('#alReadAll').onclick = async () => {
    try {
      await notesApi('/read-all', { method: 'PATCH' });
      items.forEach((n) => { n.read = true; });
      unread = 0;
      paint();
      refreshBell();
      toast('All marked as read');
    } catch (e) { toast(e.message, true); }
  };
  view.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { alUi.filter = t.dataset.tab; go(); return; }
    if (e.target.closest('#alMore')) { load(true).catch((x) => toast(x.message, true)); return; }
    const row = e.target.closest('.al-item[data-id]');
    if (!row) return;
    const open = e.target.closest('a[data-open]');
    if (open) { // open what it is about; that counts as read
      e.preventDefault();
      await markRead(row.dataset.id);
      location.hash = open.getAttribute('href');
      return;
    }
    markRead(row.dataset.id);
  };
  $('#alList').addEventListener('keydown', (e) => {
    const row = e.target.closest('.al-item.unread');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); markRead(row.dataset.id); }
  });
}
