/* Remindate – email reminders
 *
 * Runs in GitHub Actions every ~10 minutes (see .github/workflows/email-reminders.yml).
 * 1. Reads notes.json from your private data repo.
 * 2. Finds notes with "Send Email Notification" on whose time (or repeat) just passed.
 * 3. Emails them through Gmail and remembers what was sent (remindate-email-state.json
 *    in the data repo), so nothing is sent twice.
 *
 * Note: the logs of a public repo are public, so this script never prints
 * email addresses, note titles or note text.
 */
import nodemailer from 'nodemailer';

const env = (name, fallback = '') => (process.env[name] || fallback).trim();

const CONFIG = {
    token: env('DATA_TOKEN'),
    repo: env('DATA_REPO', 'Vharixce/Remindate-DATA-PRIVATE'),
    path: env('DATA_PATH', 'notes.json'),
    statePath: env('STATE_PATH', 'remindate-email-state.json'),
    apiBase: env('GITHUB_API', 'https://api.github.com'),
    gmailUser: env('GMAIL_USER'),
    gmailPassword: env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''),
    smtpHost: env('SMTP_HOST'),
    smtpPort: Number(env('SMTP_PORT', '465')),
    smtpUser: env('SMTP_USER'),
    smtpPassword: env('SMTP_PASSWORD'),
    from: env('MAIL_FROM'),
    appUrl: env('APP_URL'),
    // also send reminders that are up to this many minutes late (GitHub's timer can lag)
    lookbackMinutes: Number(env('LOOKBACK_MINUTES', '120')),
    dryRun: env('DRY_RUN') === '1',
    now: env('NOW') ? new Date(env('NOW')) : new Date()
};

/* ---------------- GitHub contents API ---------------- */

async function gh(method, path, body, accept = 'application/vnd.github+json') {
    const url = `${CONFIG.apiBase}/repos/${CONFIG.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
        method,
        headers: {
            Accept: accept,
            Authorization: `Bearer ${CONFIG.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'remindate-email-reminders',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        const err = new Error(`GitHub API ${method} ${path} failed with ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return accept.includes('raw') ? res.text() : res.json();
}

async function readFile(path) {
    const meta = await gh('GET', path);
    if (!meta) return null;
    let text;
    if (meta.content && meta.encoding === 'base64') text = Buffer.from(meta.content, 'base64').toString('utf8');
    else text = await gh('GET', path, null, 'application/vnd.github.raw+json'); // files > 1 MB
    return { sha: meta.sha, text };
}

async function writeFile(path, text, sha, message) {
    return gh('PUT', path, {
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        ...(sha ? { sha } : {})
    });
}

/* ---------------- schedule logic (same rules as the app) ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const nthOfMonth = (d) => Math.ceil(d.getDate() / 7);
const isLastWeekdayOfMonth = (d) => d.getDate() + 7 > daysInMonth(d);
const REPEAT_MODES = ['none', 'weekly', 'monthlyDate', 'monthlyWeekday', 'monthlyLastWeekday', 'yearly'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(value) {
    if (!value) return null;
    const d = new Date(value); // "2026-11-10T09:00:00" = local time (TZ from the workflow)
    return Number.isNaN(d.getTime()) ? null : d;
}

function repeatModeOf(note) {
    const weekdays = Array.isArray(note.repeatWeekdays) ? note.repeatWeekdays : [];
    const mode = REPEAT_MODES.includes(note.repeatMode) ? note.repeatMode : 'none';
    if (mode === 'weekly' || mode === 'none') return weekdays.length ? 'weekly' : 'none';
    return mode;
}

function repeatMatches(note, base, day) {
    switch (repeatModeOf(note)) {
        case 'weekly': return note.repeatWeekdays.includes((day.getDay() + 6) % 7);
        case 'monthlyDate': return day.getDate() === Math.min(base.getDate(), daysInMonth(day));
        case 'monthlyWeekday': return day.getDay() === base.getDay() && nthOfMonth(day) === nthOfMonth(base);
        case 'monthlyLastWeekday': return day.getDay() === base.getDay() && isLastWeekdayOfMonth(day);
        case 'yearly': return day.getMonth() === base.getMonth() && day.getDate() === Math.min(base.getDate(), daysInMonth(day));
        default: return false;
    }
}

function occurrenceOn(note, day) {
    const base = parseDate(note.scheduledAt);
    if (!base) return null;
    if (Array.isArray(note.skipDates) && note.skipDates.includes(dayKey(day))) return null;
    const occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());
    if (sameDay(base, day)) return occ;
    if (repeatModeOf(note) === 'none') return null;
    const key = dayKey(day);
    if (key < dayKey(base)) return null;
    if (note.repeatEndDate && key > note.repeatEndDate) return null;
    return repeatMatches(note, base, day) ? occ : null;
}

// All occurrences with from < time <= to
function occurrencesBetween(note, from, to) {
    const out = [];
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (let d = start; d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const occ = occurrenceOn(note, d);
        if (occ && occ > from && occ <= to) out.push(occ);
    }
    return out;
}

/* ---------------- email ---------------- */

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function describe(occ) {
    return `${WEEKDAYS[occ.getDay()]} ${occ.getDate()} ${MONTHS[occ.getMonth()]} ${occ.getFullYear()} at ${pad(occ.getHours())}:${pad(occ.getMinutes())}`;
}

function buildMail(note, occ) {
    const title = (note.title || '').trim() || 'Untitled note';
    let text = (note.content || '').trim();
    if (text.length > 4000) text = `${text.slice(0, 4000)}…`;
    const extras = [];
    if (/<img\b/i.test(note.html || '')) extras.push('images');
    if (/data-voice=/i.test(note.html || '')) extras.push('voice notes');
    if ((note.strokes || []).length) extras.push('a drawing');
    const extraLine = extras.length ? `This note also contains ${extras.join(', ')} – open Remindate to see them.` : '';
    const when = describe(occ);
    const repeating = repeatModeOf(note) !== 'none';

    const lines = [`⏰ ${title}`, `Scheduled for ${when}${repeating ? ' (repeating)' : ''}`, ''];
    if (text) lines.push(text, '');
    if (extraLine) lines.push(extraLine, '');
    if (CONFIG.appUrl) lines.push(`Open Remindate: ${CONFIG.appUrl}`);

    const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;color:#1f2937">
  <div style="font-size:13px;color:#6b7280;margin-bottom:6px">Remindate reminder</div>
  <h2 style="margin:0 0 6px;font-size:20px">⏰ ${escapeHtml(title)}</h2>
  <div style="font-size:14px;color:#4b5563;margin-bottom:16px">${escapeHtml(when)}${repeating ? ' · repeating' : ''}</div>
  ${text ? `<div style="white-space:pre-wrap;font-size:15px;line-height:1.55;padding:14px 16px;background:#f3f4f6;border-radius:10px">${escapeHtml(text)}</div>` : ''}
  ${extraLine ? `<p style="font-size:13px;color:#6b7280">${escapeHtml(extraLine)}</p>` : ''}
  ${CONFIG.appUrl ? `<p style="margin-top:18px"><a href="${escapeHtml(CONFIG.appUrl)}" style="background:#7c6ff0;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open Remindate</a></p>` : ''}
</div>`;

    return {
        to: note.emailTo,
        subject: `⏰ ${title} – ${pad(occ.getHours())}:${pad(occ.getMinutes())}`,
        text: lines.join('\n'),
        html
    };
}

function makeTransport() {
    if (CONFIG.dryRun) return nodemailer.createTransport({ jsonTransport: true });
    if (CONFIG.smtpHost) {
        return nodemailer.createTransport({
            host: CONFIG.smtpHost,
            port: CONFIG.smtpPort,
            secure: CONFIG.smtpPort === 465,
            auth: { user: CONFIG.smtpUser, pass: CONFIG.smtpPassword }
        });
    }
    if (!CONFIG.gmailUser || !CONFIG.gmailPassword) {
        throw new Error('Missing GMAIL_USER / GMAIL_APP_PASSWORD secrets (see EMAIL-SETUP.md)');
    }
    return nodemailer.createTransport({ service: 'gmail', auth: { user: CONFIG.gmailUser, pass: CONFIG.gmailPassword } });
}

/* ---------------- main ---------------- */

async function main() {
    if (!CONFIG.token) throw new Error('Missing DATA_TOKEN secret (see EMAIL-SETUP.md)');
    const now = CONFIG.now;

    const dataFile = await readFile(CONFIG.path);
    if (!dataFile) { console.log('No notes file found in the data repo – nothing to do.'); return; }
    const data = JSON.parse(dataFile.text || '[]');
    const notes = Array.isArray(data) ? data : (data.notes || []);

    const stateFile = await readFile(CONFIG.statePath);
    const state = stateFile ? JSON.parse(stateFile.text || '{}') : {};
    state.sent = state.sent && typeof state.sent === 'object' ? state.sent : {};

    const from = new Date(now.getTime() - CONFIG.lookbackMinutes * 60000);
    const due = [];
    for (const note of notes) {
        if (!note || !note.emailEnabled || !note.scheduledAt || !EMAIL_RE.test(note.emailTo || '')) continue;
        for (const occ of occurrencesBetween(note, from, now)) {
            const key = `${note.id}@${occ.toISOString()}`;
            if (!state.sent[key]) due.push({ note, occ, key });
        }
    }

    console.log(`Checked ${notes.length} notes · ${due.length} reminder(s) due · window ${CONFIG.lookbackMinutes} min${CONFIG.dryRun ? ' · DRY RUN' : ''}`);
    if (!due.length) return;

    const transport = makeTransport();
    const fromAddress = CONFIG.from || (CONFIG.smtpHost ? CONFIG.smtpUser : CONFIG.gmailUser) || 'remindate@example.com';
    let sent = 0, failed = 0;
    for (const { note, occ, key } of due) {
        try {
            const mail = buildMail(note, occ);
            const info = await transport.sendMail({ from: `Remindate <${fromAddress}>`, ...mail });
            if (CONFIG.dryRun && process.env.DRY_RUN_PRINT === '1') console.log(info.message);
            state.sent[key] = now.toISOString();
            sent++;
        } catch (err) {
            failed++;
            console.log(`A reminder could not be sent: ${err.code || err.message}`);
        }
    }

    // forget old entries so the state file stays small
    const cutoff = now.getTime() - 60 * 86400000;
    for (const [k, at] of Object.entries(state.sent)) if (Date.parse(at) < cutoff) delete state.sent[k];
    state.updatedAt = now.toISOString();

    if (sent) {
        await writeFile(CONFIG.statePath, JSON.stringify(state, null, 2), stateFile && stateFile.sha,
            `Remindate: ${sent} email reminder(s) sent`);
    }
    console.log(`Sent ${sent} email(s)${failed ? `, ${failed} failed` : ''}.`);
    if (failed && !sent) process.exitCode = 1;
}

main().catch((err) => {
    console.error(`Email reminders failed: ${err.message}`);
    process.exit(1);
});
