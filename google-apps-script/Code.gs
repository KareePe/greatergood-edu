/**
 * GGED × Harvard ManageMentor® — enquiry form → Google Sheet
 *
 * SETUP (one time)
 *  1. Create a Google Sheet (e.g. "HMM Khon Kaen – Leads").
 *  2. In the Sheet: Extensions → Apps Script. Delete the sample code and paste this whole file.
 *  3. Save, then Deploy → New deployment → type "Web app":
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Click Deploy and allow the permissions it asks for.
 *  4. Copy the Web app URL (ends in /exec) into the website's .env file:
 *       GOOGLE_SHEET_WEBHOOK=https://script.google.com/macros/s/…/exec
 *     The browser form gets it through assets/js/env.js (built automatically before
 *     `firebase deploy`; on XAMPP run `node scripts/build-env.mjs`). PHP reads .env directly.
 *
 * After changing this code later: Deploy → Manage deployments → edit → Version: "New version"
 * (the /exec URL stays the same).
 */

const SHEET_NAME = 'Leads';
const TIMEZONE = 'Asia/Bangkok';
// E-mail alert on every new lead (optional). One address, or several separated by commas:
//   const NOTIFY_EMAIL = 'team@example.com';
//   const NOTIFY_EMAIL = 'sales@example.com, manager@example.com';
// After setting it: run testNotify once (authorises e-mail), then Deploy → Manage deployments → New version.
const NOTIFY_EMAIL = '';

// [key sent by the website, column header in the Sheet]
const COLUMNS = [
  ['submitted_at',     'วันที่ส่ง / Submitted at'],
  ['name',             'ชื่อ / Name'],
  ['phone',            'เบอร์โทรศัพท์ / Phone'],
  ['status',           'สถานะปัจจุบัน / I am a…'],
  ['email',            'อีเมล / Email'],
  ['marketing_opt_in', 'รับข่าวสาร / Marketing opt-in'],
  ['lang',             'ภาษา / Language'],
  ['lead_source',      'ปุ่มที่กด / Lead source'],
  ['utm_source',       'utm_source'],
  ['utm_medium',       'utm_medium'],
  ['utm_campaign',     'utm_campaign'],
  ['utm_content',      'utm_content'],
  ['utm_term',         'utm_term'],
  ['referrer',         'Referrer'],
  ['landing_page',     'Landing page'],
  ['user_agent',       'User agent']
];

const STATUS_LABEL = {
  student: 'นักศึกษา / Student',
  working_professional: 'คนทำงาน / Working professional',
  business_owner: 'เจ้าของธุรกิจ / Business owner',
  other: 'อื่น ๆ / Other'
};

const MAX_LEN = { name: 120, phone: 20, email: 160, referrer: 500, landing_page: 500, user_agent: 300 };

function doPost(e) {
  try {
    const data = readPayload_(e);

    // spam trap: bots fill the hidden "website" field — answer ok, store nothing
    if (clean_(data.website)) return json_({ ok: true });

    const lead = normalise_(data);
    const errors = validate_(lead);
    if (errors.length) return json_({ ok: false, error: 'validation', fields: errors });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet_();
      sheet.appendRow(COLUMNS.map(([key]) => safeCell_(lead[key])));
    } finally {
      lock.releaseLock();
    }

    // the lead is already saved; an e-mail problem (quota, typo in the address) must not
    // make the website report a failure, or the visitor would submit again and create duplicates
    if (NOTIFY_EMAIL) {
      try { notify_(lead); } catch (mailErr) { console.error('notify failed: ' + mailErr); }
    }
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

// health check: open the /exec URL in a browser to see this
function doGet() {
  return json_({ ok: true, service: 'GGED HMM leads', sheet: SHEET_NAME });
}

/* ---------- helpers ---------- */

// website sends form-encoded fields (e.parameter); submit.php sends JSON
function readPayload_(e) {
  if (e && e.postData && /json/i.test(e.postData.type || '')) {
    return JSON.parse(e.postData.contents || '{}');
  }
  return (e && e.parameter) || {};
}

function clean_(v, max) {
  let s = v == null ? '' : String(v);
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return max ? s.slice(0, max) : s.slice(0, 200);
}

function normalise_(d) {
  const status = clean_(d.status, 40);
  const statusLabel = STATUS_LABEL[status] || (Object.values(STATUS_LABEL).indexOf(status) >= 0 ? status : '');
  return {
    submitted_at: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    name: clean_(d.name, MAX_LEN.name),
    phone: clean_(d.phone, MAX_LEN.phone),
    status: statusLabel,
    email: clean_(d.email, MAX_LEN.email),
    marketing_opt_in: clean_(d.marketing_opt_in) === 'yes' ? 'yes' : 'no',
    lang: clean_(d.lang, 5) === 'en' ? 'en' : 'th',
    lead_source: clean_(d.lead_source, 40) || 'direct',
    utm_source: clean_(d.utm_source, 100),
    utm_medium: clean_(d.utm_medium, 100),
    utm_campaign: clean_(d.utm_campaign, 150),
    utm_content: clean_(d.utm_content, 150),
    utm_term: clean_(d.utm_term, 150),
    referrer: clean_(d.referrer, MAX_LEN.referrer),
    landing_page: clean_(d.landing_page, MAX_LEN.landing_page),
    user_agent: clean_(d.user_agent, MAX_LEN.user_agent)
  };
}

// same rules as the website and submit.php
function validate_(lead) {
  const errors = [];
  if (lead.name.length < 2) errors.push('name');
  const digits = lead.phone.replace(/[\s\-().]/g, '');
  if (!/^(\+?66|0)\d{8,9}$/.test(digits)) errors.push('phone');
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) errors.push('email');
  return errors;
}

// stop values like "=HYPERLINK(...)" from running as formulas; keep phone numbers' leading 0
function safeCell_(v) {
  const s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s) || /^0\d/.test(s)) return "'" + s;
  return s;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(([, header]) => header));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#f1f3f9');
  }
  return sheet;
}

function notify_(lead) {
  const esc = (v) => String(v == null || v === '' ? '-' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rows = COLUMNS.filter(([key]) => key !== 'user_agent');
  const text = rows.map(([key, header]) => header + ': ' + (lead[key] || '-')).join('\n');
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1b2038">' +
    '<p style="font-size:16px;margin:0 0 12px"><b>ลีดใหม่ · Harvard ManageMentor® ที่ Wall Street English ขอนแก่น</b></p>' +
    '<table cellpadding="6" style="border-collapse:collapse">' +
    rows.map(([key, header]) =>
      '<tr><td style="color:#4a5170;border-bottom:1px solid #e3e6ef">' + esc(header) + '</td>' +
      '<td style="border-bottom:1px solid #e3e6ef"><b>' + esc(lead[key]) + '</b></td></tr>').join('') +
    '</table>' +
    '<p style="color:#4a5170;margin:14px 0 0">ดูทั้งหมดในแท็บ "' + esc(SHEET_NAME) + '" ของ Google Sheet นี้: ' +
    '<a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">เปิด Sheet</a></p></div>';

  const msg = {
    to: NOTIFY_EMAIL,
    subject: 'ลีดใหม่ HMM ขอนแก่น: ' + lead.name + ' · ' + lead.phone,
    body: text,
    htmlBody: html,
    name: 'HMM Khon Kaen – Leads'
  };
  if (lead.email) msg.replyTo = lead.email; // "Reply" goes straight to the lead
  MailApp.sendEmail(msg);
}

/**
 * Run this once from the Apps Script editor (select "testNotify" → Run):
 * it asks for permission to send e-mail and sends one sample alert to NOTIFY_EMAIL.
 * Nothing is written to the Sheet.
 */
function testNotify() {
  if (!NOTIFY_EMAIL) throw new Error('Set NOTIFY_EMAIL at the top of the file first.');
  notify_({
    submitted_at: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    name: 'ทดสอบการแจ้งเตือน (Test)', phone: '081 234 5678', status: STATUS_LABEL.working_professional,
    email: '', marketing_opt_in: 'no', lang: 'th', lead_source: 'test',
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    referrer: '', landing_page: 'https://gged-hmm.com/', user_agent: ''
  });
  console.log('Test e-mail sent to ' + NOTIFY_EMAIL + '. Remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
