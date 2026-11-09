/**
 * Remindate – email reminders (Google Apps Script)
 *
 * Every minute this script reads remindate.json from your private GitHub data repo,
 * finds notes with "Send Email Notification" on whose time (or repeat) has come,
 * and emails them from your Gmail. What was sent is remembered, so nothing is sent twice.
 *
 * Setup (once):
 *  1. Project Settings → Script properties → add  GITHUB_TOKEN = <your GitHub token>
 *     (the same fine-grained token Remindate uses for GitHub Sync).
 *  2. Choose the function "setup" at the top and press Run, then allow the permissions.
 *  3. Optional: run "sendTestEmail" to get a test email.
 */

var CONFIG = {
  dataRepo: 'Vharixce/Remindate-DATA-PRIVATE',
  dataPath: 'remindate.json',
  appUrl: 'https://vharixce.github.io/Remindate/',
  lookbackMinutes: 30,   // also send reminders up to 30 min late (e.g. after a Google hiccup)
  keepSentDays: 21
};

/* ---------------- entry points ---------------- */

/** Run once: makes the script check every minute. */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(1).create();
  // remember "now" so old reminders are not all sent at once
  PropertiesService.getScriptProperties().setProperty('LAST_RUN', new Date().toISOString());
  var notes = loadNotes_();
  Logger.log('Setup done. Found ' + notes.length + ' notes, ' +
    notes.filter(function (n) { return n && n.emailEnabled; }).length + ' with email on. Checking every minute.');
}

/** Sends one test email to the address used in your notes (or your own Gmail). */
function sendTestEmail() {
  var notes = loadNotes_();
  var withEmail = notes.filter(function (n) { return n && n.emailEnabled && EMAIL_RE.test(n.emailTo || ''); });
  var to = withEmail.length ? withEmail[0].emailTo : Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: '✅ Remindate email test',
    name: 'Remindate',
    body: 'Email reminders work! Notes found: ' + notes.length + ', with email on: ' + withEmail.length + '.',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:15px">✅ <b>Remindate email reminders work!</b><br>' +
      'Notes found: ' + notes.length + ', with email on: ' + withEmail.length + '.</div>'
  });
  Logger.log('Test email sent to ' + to);
}

/** Called every minute by the trigger. */
function checkReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // a previous run is still busy
  try {
    var props = PropertiesService.getScriptProperties();
    var now = new Date();
    var sent = JSON.parse(props.getProperty('SENT') || '{}');
    var lastRun = props.getProperty('LAST_RUN');
    var from = new Date(now.getTime() - CONFIG.lookbackMinutes * 60000);
    if (lastRun && new Date(lastRun) > from) from = new Date(new Date(lastRun).getTime() - 2 * 60000);

    var notes = loadNotes_();
    var count = 0;
    notes.forEach(function (note) {
      if (!note || !note.emailEnabled || !note.scheduledAt || !EMAIL_RE.test(note.emailTo || '')) return;
      occurrencesBetween_(note, from, now).forEach(function (occ) {
        var key = note.id + '@' + occ.toISOString();
        if (sent[key]) return;
        MailApp.sendEmail(buildMail_(note, occ));
        sent[key] = now.toISOString();
        count++;
      });
    });

    var cutoff = now.getTime() - CONFIG.keepSentDays * 86400000;
    Object.keys(sent).forEach(function (k) { if (new Date(sent[k]).getTime() < cutoff) delete sent[k]; });
    props.setProperty('SENT', JSON.stringify(sent));
    props.setProperty('LAST_RUN', now.toISOString());
    if (count) Logger.log('Sent ' + count + ' reminder(s)');
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- GitHub ---------------- */

function loadNotes_() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Add the script property GITHUB_TOKEN first (Project Settings → Script properties).');
  // remindate.json is the data file; notes.json is its old name (used until the app has switched over)
  var paths = [CONFIG.dataPath, 'remindate.json', 'notes.json'].filter(function (p, i, a) { return a.indexOf(p) === i; });
  var res, code;
  for (var i = 0; i < paths.length; i++) {
    var url = 'https://api.github.com/repos/' + CONFIG.dataRepo + '/contents/' +
      paths[i].split('/').map(encodeURIComponent).join('/');
    res = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    if (code !== 404) break;
  }
  if (code === 404) throw new Error('remindate.json not found in ' + CONFIG.dataRepo + ' (is GitHub Sync on in Remindate?), or the token has no access to that repo.');
  if (code === 401 || code === 403) throw new Error('GitHub refused the token (' + code + '). Check GITHUB_TOKEN and that it can read ' + CONFIG.dataRepo + '.');
  if (code !== 200) throw new Error('GitHub error ' + code);
  var text = res.getContentText('UTF-8');
  var data = text && text.trim() ? JSON.parse(text) : [];
  return Array.isArray(data) ? data : (data.notes || []);
}

/* ---------------- schedule rules (same as the app) ---------------- */

var EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
var REPEAT_MODES = ['none', 'weekly', 'monthlyDate', 'monthlyWeekday', 'monthlyLastWeekday', 'yearly'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad_(n) { return (n < 10 ? '0' : '') + n; }
function dayKey_(d) { return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()); }
function sameDay_(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function daysInMonth_(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function nthOfMonth_(d) { return Math.ceil(d.getDate() / 7); }

// "2026-11-10T09:00:00" = local time (the project's time zone, Europe/Amsterdam)
function parseLocal_(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value || '');
  if (!m) { var d = new Date(value); return isNaN(d.getTime()) ? null : d; }
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function repeatModeOf_(note) {
  var weekdays = Array.isArray(note.repeatWeekdays) ? note.repeatWeekdays : [];
  var mode = REPEAT_MODES.indexOf(note.repeatMode) >= 0 ? note.repeatMode : 'none';
  if (mode === 'weekly' || mode === 'none') return weekdays.length ? 'weekly' : 'none';
  return mode;
}

function repeatMatches_(note, base, day) {
  switch (repeatModeOf_(note)) {
    case 'weekly': return note.repeatWeekdays.indexOf((day.getDay() + 6) % 7) >= 0;
    case 'monthlyDate': return day.getDate() === Math.min(base.getDate(), daysInMonth_(day));
    case 'monthlyWeekday': return day.getDay() === base.getDay() && nthOfMonth_(day) === nthOfMonth_(base);
    case 'monthlyLastWeekday': return day.getDay() === base.getDay() && day.getDate() + 7 > daysInMonth_(day);
    case 'yearly': return day.getMonth() === base.getMonth() && day.getDate() === Math.min(base.getDate(), daysInMonth_(day));
    default: return false;
  }
}

function occurrenceOn_(note, day) {
  var base = parseLocal_(note.scheduledAt);
  if (!base) return null;
  if (Array.isArray(note.skipDates) && note.skipDates.indexOf(dayKey_(day)) >= 0) return null;
  var occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());
  if (sameDay_(base, day)) return occ;
  if (repeatModeOf_(note) === 'none') return null;
  var key = dayKey_(day);
  if (key < dayKey_(base)) return null;
  if (note.repeatEndDate && key > note.repeatEndDate) return null;
  return repeatMatches_(note, base, day) ? occ : null;
}

function occurrencesBetween_(note, from, to) {
  var out = [];
  for (var d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to;
       d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    var occ = occurrenceOn_(note, d);
    if (occ && occ > from && occ <= to) out.push(occ);
  }
  return out;
}

/* ---------------- the email ---------------- */

function escapeHtml_(t) {
  return String(t).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function buildMail_(note, occ) {
  var title = (note.title || '').trim() || 'Untitled note';
  // private notes: never put what is inside the note in the email
  var text = note.private ? '' : (note.content || '').trim();
  if (text.length > 4000) text = text.slice(0, 4000) + '…';
  var extras = [];
  if (!note.private) {
    if (/<img\b/i.test(note.html || '')) extras.push('images');
    if (/data-voice=/i.test(note.html || '')) extras.push('voice notes');
    if ((note.strokes || []).length) extras.push('a drawing');
  }
  var extraLine = note.private ? '🔒 This is a private note – open Remindate and enter your pass to read it.'
    : extras.length ? 'This note also contains ' + extras.join(', ') + ' – open Remindate to see them.' : '';
  var time = pad_(occ.getHours()) + ':' + pad_(occ.getMinutes());
  var when = WEEKDAYS[occ.getDay()] + ' ' + occ.getDate() + ' ' + MONTHS[occ.getMonth()] + ' ' + occ.getFullYear() + ' at ' + time;
  var repeating = repeatModeOf_(note) !== 'none';

  var body = '⏰ ' + title + '\n' + when + (repeating ? ' (repeating)' : '') + '\n\n' +
    (text ? text + '\n\n' : '') + (extraLine ? extraLine + '\n\n' : '') + 'Open Remindate: ' + CONFIG.appUrl;
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;padding:20px;color:#1f2937">' +
    '<div style="font-size:13px;color:#6b7280;margin-bottom:6px">Remindate reminder</div>' +
    '<h2 style="margin:0 0 6px;font-size:20px">⏰ ' + escapeHtml_(title) + '</h2>' +
    '<div style="font-size:14px;color:#4b5563;margin-bottom:16px">' + escapeHtml_(when) + (repeating ? ' · repeating' : '') + '</div>' +
    (text ? '<div style="white-space:pre-wrap;font-size:15px;line-height:1.55;padding:14px 16px;background:#f3f4f6;border-radius:10px">' + escapeHtml_(text) + '</div>' : '') +
    (extraLine ? '<p style="font-size:13px;color:#6b7280">' + escapeHtml_(extraLine) + '</p>' : '') +
    '<p style="margin-top:18px"><a href="' + CONFIG.appUrl + '" style="background:#7c6ff0;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open Remindate</a></p>' +
    '</div>';
  return { to: note.emailTo, subject: '⏰ ' + title + ' – ' + time, name: 'Remindate', body: body, htmlBody: html };
}
