/**
 * AF-143 Export: CSV files that open cleanly in Excel and Google Sheets.
 * UTF-8 with a BOM (so ₱ and ñ show), quotes where needed, numbers left as numbers (so they can be added up),
 * dates in Philippine time, and text that would start a formula made safe (CSV injection: a customer named
 * "=HYPERLINK(...)" must stay plain text).
 */
const BOM = '﻿';

/** Date -> "2026-11-17 14:30" in Manila time. */
const manila = (d) => new Date(new Date(d).getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : manila(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheets would run it as a formula
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const toCsv = (columns, rows) => `${BOM}${[columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

/** "Bookings report 2026-11-01 to 2026-11-17.csv" -> a safe file name */
const fileName = (name) => `${String(name).replace(/[^\w.() -]+/g, '_').replace(/\s+/g, '-').slice(0, 120)}.csv`;

/** Answers with a CSV download. */
function send(res, name, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(name)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(toCsv(columns, rows));
}

/** The most rows one export may have (more: narrow the filters). */
const MAX_ROWS = 20000;

module.exports = { BOM, cell, toCsv, fileName, send, manila, MAX_ROWS };
