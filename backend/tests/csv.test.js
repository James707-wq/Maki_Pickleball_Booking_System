/**
 * Tests for the CSV export (utils/csv.js), run with: npm test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CSV = require('../utils/csv');

test('cells: numbers stay numbers, text is quoted only when needed, dates in Manila time', () => {
  assert.equal(CSV.cell(400), '400');
  assert.equal(CSV.cell(-50), '-50', 'a real negative number is not treated as a formula');
  assert.equal(CSV.cell(NaN), '');
  assert.equal(CSV.cell(null), '');
  assert.equal(CSV.cell(true), 'Yes');
  assert.equal(CSV.cell('Court 1'), 'Court 1');
  assert.equal(CSV.cell('Dela Cruz, Juan'), '"Dela Cruz, Juan"');
  assert.equal(CSV.cell('He said "hi"'), '"He said ""hi"""');
  assert.equal(CSV.cell('two\nlines'), '"two\nlines"');
  assert.equal(CSV.cell(new Date('2026-11-17T06:30:00Z')), '2026-11-17 14:30');
});

test('text that would start a formula in Excel or Sheets is made safe (CSV injection)', () => {
  assert.equal(CSV.cell('=1+1'), "'=1+1");
  assert.equal(CSV.cell('+639171234567'), "'+639171234567");
  assert.equal(CSV.cell('-2+3'), "'-2+3");
  assert.equal(CSV.cell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(CSV.cell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
});

test('a whole file: BOM, header, Windows line endings; safe file names', () => {
  const text = CSV.toCsv(['Reference', 'Fee (PHP)'], [['MKI-1', 400], ['MKI-2', 350]]);
  assert.equal(text, '﻿Reference,Fee (PHP)\r\nMKI-1,400\r\nMKI-2,350\r\n');
  assert.equal(CSV.fileName('Bookings report 2026-11-01 to 2026-11-17'), 'Bookings-report-2026-11-01-to-2026-11-17.csv');
  assert.equal(CSV.fileName('a/b\\c"d'), 'a_b_c_d.csv');
});
