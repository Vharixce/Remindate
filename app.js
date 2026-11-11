/* Remindate Web
 * Notes, folders, calendar and drawing. All data is stored locally in the browser
 * (local storage), so no server or account is required.
 */
(() => {
    'use strict';

    const STORAGE = {
        notes: 'remindate.notes.v1',
        privatePass: 'remindate.privatePass.v1',
        folders: 'remindate.folders.v1',
        prefs: 'remindate.prefs.v1',
        alarms: 'remindate.alarms.v1',
        deleted: 'remindate.deleted.v1',
        trash: 'remindate.trash.v1',
        updatedAt: 'remindate.updatedAt.v1',
        github: 'remindate.github.v1',
        server: 'remindate.server.v1'
    };


    // [color, name] in display order
    // colours in the order of the light spectrum (red → violet), then magenta / pink, then the greys
    const PALETTE_NAMED = [
        ['#fca5a5', 'Light red'], ['#e11d1d', 'Bright red'], ['#991b1b', 'Dark red'],
        ['#fdba74', 'Light orange'], ['#f97316', 'Bright orange'], ['#c2410c', 'Dark orange'],
        ['#facc15', 'Yellow'],
        ['#86efac', 'Light green'], ['#22c55e', 'Bright green'], ['#166534', 'Dark green'],
        ['#14b8a6', 'Turquoise'], ['#22d3ee', 'Cyan'],
        ['#3b82f6', 'Blue'], ['#1e3a8a', 'Dark blue'], ['#6366f1', 'Blue-purple'],
        ['#c4b5fd', 'Light purple'], ['#8b5cf6', 'Purple'], ['#d946ef', 'Magenta'], ['#f472b6', 'Pink'],
        ['#000000', 'Black'], ['#4b5563', 'Dark grey'], ['#d1d5db', 'Light grey'], ['#ffffff', 'White']
    ];
    const OLD_BRIGHT_RED = '#ef4444'; // the earlier, paler "Bright red"
    const NEW_BRIGHT_RED = '#e11d1d';
    const PALETTE = PALETTE_NAMED.map(([c]) => c);
    const DEFAULT_PEN_COLOR = '#d1d5db';   // light grey
    const DEFAULT_CANVAS_BG = '#000000';   // black

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const state = {
        notes: [],
        folders: [],
        prefs: {
            sidebarWidth: 260,
            sidebarSide: 'left',
            sidebarCollapsed: false,
            activeTab: 'note',
            expandedFolders: [],
            scheduleCollapsed: false,
            mode: 'text'
        },
        alarms: {},
        // Deleted note/folder ids with the time they were deleted, so a sync
        // knows an item was removed instead of "missing on this device".
        deleted: { notes: {}, folders: {} },
        // Time of the last local change (ISO); compared with GitHub's version.
        updatedAt: null,
        // Recently deleted notes on this device: [{ note, deletedAt }]
        trash: [],
        currentNoteId: null,
        currentFolderId: null,
        calendarCursor: new Date(),
        calendarDay: null,
        draw: {
            tool: 'pen',
            color: DEFAULT_PEN_COLOR,
            size: 6,
            strokes: [],
            drawing: false,
            current: null
        }
    };
//test
    const $ = (id) => document.getElementById(id);
    const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

    /* ---------------- opslag ---------------- */

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            console.warn('Could not read data:', key, err);
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.error('Save failed:', err);
            toast('Save failed: your browser storage is full or unavailable.');
        }
    }

    function load() {
        state.notes = readJSON(STORAGE.notes, []);
        state.folders = readJSON(STORAGE.folders, []);
        state.prefs = Object.assign(state.prefs, readJSON(STORAGE.prefs, {}));
        state.alarms = readJSON(STORAGE.alarms, {});

        if (!Array.isArray(state.notes)) state.notes = [];
        if (!Array.isArray(state.folders)) state.folders = [];
        if (!Array.isArray(state.prefs.expandedFolders)) state.prefs.expandedFolders = [];
        if (!state.alarms || typeof state.alarms !== 'object') state.alarms = {};
        state.deleted = normalizeDeleted(readJSON(STORAGE.deleted, null));
        state.updatedAt = readJSON(STORAGE.updatedAt, null);
        state.trash = readJSON(STORAGE.trash, []);
        if (!Array.isArray(state.trash)) state.trash = [];

        state.notes.forEach(migrateNote);
        state.folders.forEach(migrateFolder);
    }

    function normalizeDeleted(d) {
        return {
            notes: (d && typeof d.notes === 'object' && d.notes) || {},
            folders: (d && typeof d.folders === 'object' && d.folders) || {}
        };
    }

    function migrateFolder(folder) {
        folder.id = folder.id || uid();
        folder.name = folder.name || 'Folder';
        folder.modifiedAt = folder.modifiedAt || '2000-01-01T00:00:00.000Z';
        folder.parentId = folder.parentId || null; // null = top level
        if (folder.bgColor && OLD_BG_COLORS[folder.bgColor]) folder.bgColor = OLD_BG_COLORS[folder.bgColor];
    }

    // The folder a folder sits in (null = top level). A missing parent or a loop counts as top level.
    function parentOf(folder) {
        const pid = folder.parentId;
        if (!pid) return null;
        const seen = new Set([folder.id]);
        let cur = state.folders.find((f) => f.id === pid);
        if (!cur) return null;
        let walk = cur;
        while (walk) {
            if (seen.has(walk.id)) return null; // loop (e.g. after syncing two devices): show at top level
            seen.add(walk.id);
            walk = walk.parentId ? state.folders.find((f) => f.id === walk.parentId) : null;
        }
        return cur.id;
    }
    const childFolders = (parentId) => sortedFolders().filter((f) => parentOf(f) === (parentId || null));
    // true if folder `id` is `ancestorId` or somewhere inside it
    function isInside(id, ancestorId) {
        let f = state.folders.find((x) => x.id === id);
        const seen = new Set();
        while (f && !seen.has(f.id)) {
            if (f.id === ancestorId) return true;
            seen.add(f.id);
            const pid = parentOf(f);
            f = pid ? state.folders.find((x) => x.id === pid) : null;
        }
        return false;
    }
    // folders depth-first, with how deep they are
    function folderTree(parentId = null, depth = 0, out = []) {
        childFolders(parentId).forEach((f) => { out.push({ folder: f, depth }); folderTree(f.id, depth + 1, out); });
        return out;
    }
    function folderPath(id) {
        const names = [];
        let f = state.folders.find((x) => x.id === id);
        const seen = new Set();
        while (f && !seen.has(f.id)) {
            seen.add(f.id);
            names.unshift(f.name);
            const pid = parentOf(f);
            f = pid ? state.folders.find((x) => x.id === pid) : null;
        }
        return names.join(' / ');
    }
    function expandFolderPath(id) {
        let f = state.folders.find((x) => x.id === id);
        const seen = new Set();
        while (f && !seen.has(f.id)) {
            seen.add(f.id);
            if (!state.prefs.expandedFolders.includes(f.id)) state.prefs.expandedFolders.push(f.id);
            const pid = parentOf(f);
            f = pid ? state.folders.find((x) => x.id === pid) : null;
        }
    }

    // the pastel colours became 10% less white: update text that used the old ones
    const OLD_BG_COLORS = { '#ff9494': '#372020', '#ffca8c': '#372b20', '#fcff9c': '#373420', '#b5ffa6': '#203722',
        '#86b4ff': '#202937', '#c59cff': '#2b2037', '#2b2b2b': '#000000' };
    const OLD_PASTELS = [[/#ffadad|rgb\(255,\s*173,\s*173\)/gi, '#ff9494'], [/#ffd6a5|rgb\(255,\s*214,\s*165\)/gi, '#ffca8c'], [/#fdffb6|rgb\(253,\s*255,\s*182\)/gi, '#fcff9c'], [/#caffbf|rgb\(202,\s*255,\s*191\)/gi, '#b5ffa6'], [/#a0c4ff|rgb\(160,\s*196,\s*255\)/gi, '#86b4ff'], [/#d4b5ff|rgb\(212,\s*181,\s*255\)/gi, '#c59cff']];
    function migrateNote(note) {
        note.id = note.id || uid();
        note.title = note.title || '';
        note.content = note.content || '';
        note.createdAt = note.createdAt || new Date().toISOString();
        note.modifiedAt = note.modifiedAt || note.createdAt;
        note.scheduledAt = note.scheduledAt || null;
        note.folderId = note.folderId || null;
        if (note.color === OLD_BRIGHT_RED) note.color = NEW_BRIGHT_RED;
        if (note.bgColor && OLD_BG_COLORS[note.bgColor]) note.bgColor = OLD_BG_COLORS[note.bgColor];
        if (typeof note.html === 'string' && /#(ffadad|ffd6a5|fdffb6|caffbf|a0c4ff|d4b5ff)|rgb\(\s*(255,\s*173|255,\s*214|253,\s*255|202,\s*255|160,\s*196|212,\s*181)/i.test(note.html)) {
            OLD_PASTELS.forEach(([re, color]) => { note.html = note.html.replace(re, color); });
        }
        note.alarmEnabled = !!note.alarmEnabled;
        note.emailEnabled = !!note.emailEnabled;
        note.emailTo = typeof note.emailTo === 'string' ? note.emailTo : '';
        note.color = /^#[0-9a-f]{6}$/i.test(note.color || '') ? note.color : '';
        note.alarmRepeatCount = Number(note.alarmRepeatCount) || 0;
        note.alarmSnoozeMinutes = Number(note.alarmSnoozeMinutes) || 5;
        note.repeatWeekdays = Array.isArray(note.repeatWeekdays) ? note.repeatWeekdays : [];
        if (!REPEAT_MODES.includes(note.repeatMode)) note.repeatMode = note.repeatWeekdays.length ? 'weekly' : 'none';
        note.repeatEndDate = note.repeatEndDate || '';
        note.canvasBackground = note.canvasBackground || DEFAULT_CANVAS_BG;
        note.strokes = Array.isArray(note.strokes) ? note.strokes : [];
        note.skipDates = Array.isArray(note.skipDates) ? note.skipDates : [];
        if (typeof note.html !== 'string') note.html = textToHtml(note.content);
        note.gridType = note.gridType || 'square';
        note.grids = note.grids && typeof note.grids === 'object' ? note.grids : {};
        note.private = !!note.private;
    }

    let syncReady = false; // set once the sync code below has loaded
    // Every local change records "now" as the time of the latest local version
    function markChanged() {
        state.updatedAt = new Date().toISOString();
        writeJSON(STORAGE.updatedAt, state.updatedAt);
        writeJSON(STORAGE.deleted, state.deleted);
        if (syncReady && !githubBusy) updateGithubStatus();
    }
    const saveNotes = () => {
        writeJSON(STORAGE.notes, state.notes);
        markChanged();
        scheduleGithubSave();
    };
    const saveFolders = () => {
        writeJSON(STORAGE.folders, state.folders);
        markChanged();
        scheduleGithubSave();
    };
    const savePrefs = () => writeJSON(STORAGE.prefs, state.prefs);
    const saveAlarms = () => writeJSON(STORAGE.alarms, state.alarms);

    /* ---------------- hulpfuncties ---------------- */

    function uid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    const pad = (n) => String(n).padStart(2, '0');

    function toLocalIso(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
            `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function parseDate(value) {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatDateTime(value) {
        const d = parseDate(value);
        if (!d) return '';
        return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatTime(value) {
        const d = parseDate(value);
        if (!d) return '';
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function sameDay(a, b) {
        return !!a && !!b && a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function dayKey(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function keyToDate(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /* ---------------- recurrence ----------------
     * scheduledAt = first occurrence (date + time).
     * repeatWeekdays = [0..6] (0 = Monday) on which the note repeats,
     * from the start date up to and including repeatEndDate (empty = no end).
     */
    // none | weekly (on repeatWeekdays) | monthlyDate (e.g. every 15th) |
    // monthlyWeekday (e.g. every 2nd Tuesday) | monthlyLastWeekday (e.g. last Friday) | yearly
    const REPEAT_MODES = ['none', 'weekly', 'monthlyDate', 'monthlyWeekday', 'monthlyLastWeekday', 'yearly'];

    function repeatModeOf(note) {
        const mode = REPEAT_MODES.includes(note.repeatMode) ? note.repeatMode : 'none';
        if (mode === 'weekly' || mode === 'none') {
            return Array.isArray(note.repeatWeekdays) && note.repeatWeekdays.length ? 'weekly' : 'none';
        }
        return mode;
    }

    function isRecurring(note) {
        return repeatModeOf(note) !== 'none';
    }

    const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const nthOfMonth = (d) => Math.ceil(d.getDate() / 7);              // 1..5
    const isLastWeekdayOfMonth = (d) => d.getDate() + 7 > daysInMonth(d);

    // Does a repeating note (started on `base`) fall on `day`?
    function repeatMatches(note, base, day) {
        switch (repeatModeOf(note)) {
            case 'weekly':
                return note.repeatWeekdays.includes((day.getDay() + 6) % 7);
            case 'monthlyDate': // the 31st becomes the last day in shorter months
                return day.getDate() === Math.min(base.getDate(), daysInMonth(day));
            case 'monthlyWeekday':
                return day.getDay() === base.getDay() && nthOfMonth(day) === nthOfMonth(base);
            case 'monthlyLastWeekday':
                return day.getDay() === base.getDay() && isLastWeekdayOfMonth(day);
            case 'yearly': // 29 February becomes 28 February in other years
                return day.getMonth() === base.getMonth() && day.getDate() === Math.min(base.getDate(), daysInMonth(day));
            default:
                return false;
        }
    }

    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // Human readable label for a repeat mode, based on the start date
    function repeatLabel(mode, base, weekdays) {
        const wd = WEEKDAY_FULL[(base.getDay() + 6) % 7];
        switch (mode) {
            case 'weekly':
                return weekdays && weekdays.length
                    ? `Weekly on ${weekdays.slice().sort().map((i) => WEEKDAY_FULL[i].slice(0, 3)).join(', ')}`
                    : 'Weekly on selected days';
            case 'monthlyDate': return `Monthly on the ${ordinal(base.getDate())}`;
            case 'monthlyWeekday': return `Monthly on the ${ordinal(nthOfMonth(base))} ${wd}`;
            case 'monthlyLastWeekday': return `Monthly on the last ${wd}`;
            case 'yearly': return `Every year on ${base.getDate()} ${MONTHS[base.getMonth()]}`;
            default: return 'Does not repeat';
        }
    }

    // Returns the occurrence (Date with the note's time) on `day`, or null.
    function occurrenceOn(note, day) {
        const base = parseDate(note.scheduledAt);
        if (!base) return null;
        if (note.skipDates && note.skipDates.length && note.skipDates.includes(dayKey(day))) return null;
        const occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
            base.getHours(), base.getMinutes(), base.getSeconds());
        if (sameDay(base, day)) return occ;
        if (!isRecurring(note)) return null;
        const key = dayKey(day);
        if (key < dayKey(base)) return null;
        if (note.repeatEndDate && key > note.repeatEndDate) return null;
        if (!repeatMatches(note, base, day)) return null;
        return occ;
    }

    // Most recent occurrence at or before `time` (ms).
    function latestOccurrence(note, time) {
        const base = parseDate(note.scheduledAt);
        if (!base) return null;
        if (!isRecurring(note)) return base.getTime() <= time ? base : null;
        const now = new Date(time);
        for (let i = 0; i < 8; i++) {
            const occ = occurrenceOn(note, new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
            if (occ && occ.getTime() <= time) return occ;
        }
        return null;
    }

    // First occurrence after `time` (ms).
    function nextOccurrence(note, time) {
        const base = parseDate(note.scheduledAt);
        if (!base) return null;
        if (!isRecurring(note)) return base.getTime() > time ? base : null;
        const from = new Date(Math.max(time, base.getTime() - 1));
        for (let i = 0; i < 800; i++) {
            const occ = occurrenceOn(note, new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
            if (occ && occ.getTime() > time) return occ;
        }
        return null;
    }

    const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    function repeatSummary(note) {
        if (!isRecurring(note)) return '';
        const base = parseDate(note.scheduledAt);
        if (!base) return '';
        const mode = repeatModeOf(note);
        const what = mode === 'weekly'
            ? `repeats ${note.repeatWeekdays.slice().sort().map((i) => WEEKDAY_FULL[i].slice(0, 2)).join(' ')}`
            : repeatLabel(mode, base).replace(/^Monthly/, 'monthly').replace(/^Every year/, 'every year');
        return `${what}${note.repeatEndDate ? ` until ${formatDateTime(note.repeatEndDate + 'T00:00:00').slice(0, -6)}` : ''}`;
    }

    const noteById = (id) => state.notes.find((n) => n.id === id) || null;

    function touch(note) {
        note.modifiedAt = new Date().toISOString();
        saveNotes();
    }

    /* ---------------- sidebar / folder tree ---------------- */

    const treeEl = $('tree');
    const emptyEl = $('emptyExplorer');

    function byModifiedDesc(a, b) {
        return (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0);
    }

    // Manual order (drag & drop in the explorer). Notes without an order
    // (older data) get one based on their last-modified date.
    function ensureNoteOrder() {
        const missing = state.notes.filter((n) => typeof n.order !== 'number');
        if (!missing.length) return;
        const max = state.notes.reduce((m, n) => (typeof n.order === 'number' ? Math.max(m, n.order) : m), -1);
        missing.sort(byModifiedDesc).forEach((n, i) => { n.order = max + 1 + i; });
        saveNotes();
    }

    function sortedNotes(notes) {
        return notes.slice().sort((a, b) => {
            const ao = typeof a.order === 'number' ? a.order : Infinity;
            const bo = typeof b.order === 'number' ? b.order : Infinity;
            if (ao !== bo) return ao - bo;
            return byModifiedDesc(a, b);
        });
    }

    function topOrder() {
        return state.notes.reduce((m, n) => (typeof n.order === 'number' ? Math.min(m, n.order) : m), 0) - 1;
    }

    function noteItemHtml(note) {
        const preview = note.private ? '🔒 Private note' : note.content.trim()
            ? note.content.replace(/\s+/g, ' ').trim().slice(0, 60)
            : (hasImages(note) ? 'Image' : hasVoice(note) ? 'Voice note' : note.strokes.length ? 'Drawing'
                : Object.values(note.grids || {}).some((g) => g && Object.keys(g).length) ? 'Grid' : 'Empty note');
        let meta = '';
        if (note.scheduledAt) {
            const next = isRecurring(note) ? nextOccurrence(note, Date.now()) : null;
            meta = isRecurring(note)
                ? ` · ↻ ${next ? formatDateTime(toLocalIso(next)) : 'ended'}`
                : ` · ${formatDateTime(note.scheduledAt)}`;
        }
        const bg = note.bgColor ? ` style="${bgStyle(note.bgColor)}"` : '';
        return `<div class="note-item ${note.id === state.currentNoteId ? 'active' : ''}${note.bgColor ? ' has-bg' : ''}" data-note-id="${note.id}"${bg}>
            <button class="more-btn tree-menu-btn note-more" data-note-id="${note.id}" type="button" title="Menu" aria-label="Menu" aria-haspopup="menu">☰</button>
            <div class="note-item-title">${escapeHtml(note.title.trim() || 'Untitled')}</div>
            <div class="note-item-meta">${escapeHtml(preview)}${meta}</div>
        </div>`;
    }

    function sortedFolders() {
        return state.folders
            .map((f, i) => ({ f, i }))
            .sort((a, b) => {
                const ao = typeof a.f.order === 'number' ? a.f.order : a.i;
                const bo = typeof b.f.order === 'number' ? b.f.order : b.i;
                return ao - bo || a.i - b.i;
            })
            .map((x) => x.f);
    }

    function renderTree() {
        ensureNoteOrder();
        treeEl.innerHTML = '';
        const unfiled = sortedNotes(state.notes.filter((n) => !n.folderId));

        const folderHtml = (folder) => {
            const notes = sortedNotes(state.notes.filter((n) => n.folderId === folder.id));
            const subs = childFolders(folder.id);
            const expanded = state.prefs.expandedFolders.includes(folder.id);
            const inner = subs.map(folderHtml).join('') + notes.map(noteItemHtml).join('');
            return `<div class="folder">
                <div class="folder-header${folder.bgColor ? ' has-bg' : ''}" data-folder-id="${folder.id}" draggable="true" title="Drag to reorder, or onto another folder to put it inside"${folder.bgColor ? ` style="${bgStyle(folder.bgColor)}"` : ''}>
                    <span class="folder-chevron">${expanded ? '&#9662;' : '&#9656;'}</span>
                    <span class="folder-name">${escapeHtml(folder.name || 'Folder')}</span>
                    <button class="more-btn tree-menu-btn folder-more" data-folder-id="${folder.id}" type="button" title="Menu" aria-label="Menu" aria-haspopup="menu">☰</button>
                    <button class="folder-add" data-folder-id="${folder.id}" title="New note in this folder">+</button>
                </div>
                ${expanded ? `<div class="folder-items">${inner || '<div class="folder-empty">Empty</div>'}</div>` : ''}
            </div>`;
        };
        treeEl.innerHTML = childFolders(null).map(folderHtml).join('');

        if (unfiled.length) {
            const expanded = state.prefs.expandedFolders.includes('__none');
            const group = document.createElement('div');
            group.className = 'folder';
            group.innerHTML = `
                <div class="folder-header" data-folder-id="__none">
                    <span class="folder-chevron">${expanded ? '&#9662;' : '&#9656;'}</span>
                    <span class="folder-name">No folder</span>
                    <button class="folder-add" data-folder-id="__none" title="New note without a folder">+</button>
                </div>
                ${expanded ? `<div class="folder-items">${unfiled.map(noteItemHtml).join('')}</div>` : ''}
            `;
            treeEl.appendChild(group);
        }

        emptyEl.style.display = state.notes.length ? 'none' : 'block';
        makeTreeNotesDraggable();
        updateTrashButton();
    }

    /* ---- folder drag & drop (reorder) ---- */
    let draggedFolderId = null;

    treeEl.addEventListener('dragstart', (e) => {
        const header = e.target.closest && e.target.closest('.folder-header[draggable="true"]');
        if (!header || e.target.closest('.note-item')) return;
        draggedFolderId = header.dataset.folderId;
        e.dataTransfer.setData('application/x-remindate-folder', draggedFolderId);
        e.dataTransfer.effectAllowed = 'move';
        header.classList.add('dragging');
    });
    treeEl.addEventListener('dragend', () => {
        draggedFolderId = null;
        treeEl.querySelectorAll('.folder-header.dragging').forEach((el) => el.classList.remove('dragging'));
        clearTreeDropMarkers();
    });

    // Put a folder before/after another folder (in that folder's parent), or on "No folder" = top level, at the end
    function moveFolderNextTo(folderId, targetId, after) {
        if (folderId === targetId) return;
        const folder = state.folders.find((f) => f.id === folderId);
        const target = state.folders.find((f) => f.id === targetId);
        if (!folder || (target && isInside(target.id, folder.id))) return;
        const parentId = target ? parentOf(target) : null;
        const siblings = childFolders(parentId).filter((f) => f.id !== folderId);
        let index = target ? siblings.indexOf(target) + (after ? 1 : 0) : siblings.length;
        if (index < 0) index = siblings.length;
        siblings.splice(index, 0, folder);
        const now = new Date().toISOString();
        if ((folder.parentId || null) !== parentId) { folder.parentId = parentId; folder.modifiedAt = now; }
        siblings.forEach((f, i) => { if (f.order !== i) { f.order = i; f.modifiedAt = now; } });
        saveFolders();
        renderTree();
        refreshFolderSelect();
    }

    // Put a folder inside another folder (as its last sub-folder)
    function moveFolderInto(folderId, parentId) {
        const folder = state.folders.find((f) => f.id === folderId);
        if (!folder || folderId === parentId || isInside(parentId, folderId)) {
            if (folder && folderId !== parentId) toast("A folder can't go inside one of its own sub-folders");
            return;
        }
        const now = new Date().toISOString();
        const siblings = childFolders(parentId).filter((f) => f.id !== folderId);
        folder.parentId = parentId;
        folder.order = siblings.reduce((m, f) => Math.max(m, typeof f.order === 'number' ? f.order : 0), -1) + 1;
        folder.modifiedAt = now;
        expandFolderPath(parentId);
        savePrefs();
        saveFolders();
        renderTree();
        refreshFolderSelect();
    }
    // Phone-friendly: pick where a folder should go
    function chooseFolderDestination(folder) {
        const options = folderTree()
            .filter(({ folder: f }) => !isInside(f.id, folder.id) && f.id !== parentOf(folder))
            .map(({ folder: f, depth }) => ({ label: `${'\u00a0\u00a0'.repeat(depth)}📁 ${f.name}`, run: () => moveFolderInto(folder.id, f.id) }));
        if (parentOf(folder)) options.unshift({ label: '⬆ Top level', run: () => moveFolderNextTo(folder.id, '__none') });
        if (!options.length) { toast('There is no other folder to move it into'); return; }
        showActionSheet(`Move "${folder.name}" to`, options);
    }
    /* ---------- ☰ menus in the explorer ---------- */
    // Background colours for folders / notes: dark and greyish so they blend with the dark theme
    // (same lightness and greyness for every colour, red ≈ #361F1F)
    const BG_COLORS = [
        ['', 'No colour'],
        ['#372020', 'Red'], ['#372b20', 'Orange'], ['#373420', 'Yellow'],
        ['#203722', 'Green'], ['#202937', 'Blue'], ['#2b2037', 'Purple'],
        ['#000000', 'Black'], ['#c9c9ce', 'Light grey']
    ];

    // background colour of a tree item; dark text on light colours, light text on dark ones
    function bgStyle(color) {
        const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
        const light = (0.299 * r + 0.587 * g + 0.114 * b) > 140;
        return `--item-bg:${color};--item-fg:${light ? '#14141c' : '#f5f5ff'};--item-dim:${light ? 'rgba(20,20,28,.65)' : 'rgba(245,245,255,.7)'};--item-hover:${light ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.07)'}`;
    }
    function setItemBg(item, color, isFolder) {
        if ((item.bgColor || '') === (color || '')) return;
        if (color) item.bgColor = color; else delete item.bgColor;
        if (isFolder) { item.modifiedAt = new Date().toISOString(); saveFolders(); renderTree(); }
        else { touch(item); renderTree(); }
    }

    const menuEl = document.createElement('div');
    menuEl.className = 'tree-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.hidden = true;
    document.body.appendChild(menuEl);
    let menuActions = [];
    let menuAnchor = null;

    function placeMenu(anchor) {
        const r = anchor.getBoundingClientRect();
        menuEl.style.left = '0px';
        menuEl.style.top = '0px';
        const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
        let left = Math.min(r.right - w, window.innerWidth - w - 8);
        left = Math.max(8, left);
        let top = r.bottom + 4;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;
    }
    function closeMenu() {
        if (menuEl.hidden) return;
        menuEl.hidden = true;
        if (menuAnchor) menuAnchor.classList.remove('open');
        menuAnchor = null;
    }
    // Desktop: small drop-down under the ☰ button. Phone: the big action sheet.
    function showMenu(anchor, title, actions) {
        if (isMobile() || window.matchMedia('(hover: none)').matches) { showActionSheet(title, actions); return; }
        if (menuAnchor === anchor && !menuEl.hidden) { closeMenu(); return; }
        closeMenu();
        menuActions = actions;
        menuEl.innerHTML = actions.map((a, i) =>
            `<button type="button" role="menuitem" class="tree-menu-item${a.danger ? ' danger' : ''}" data-i="${i}"><span class="tree-menu-icon">${a.icon || ''}</span>${escapeHtml(a.label)}</button>`).join('');
        menuEl.hidden = false;
        menuAnchor = anchor;
        anchor.classList.add('open');
        placeMenu(anchor);
        menuEl.querySelector('button').focus({ preventScroll: true });
    }
    // Colour swatches (same colours as the text colours in notes)
    function pickBgColor(anchor, current, onPick) {
        closeMenu();
        menuActions = [];
        menuEl.innerHTML = `<div class="tree-menu-title">Background colour</div><div class="tree-menu-colors">${BG_COLORS.map(([c, name]) =>
            `<button type="button" class="text-color${c ? '' : ' reset'}${(current || '') === c ? ' selected' : ''}" data-bg="${c}" title="${c ? name : 'No colour'}" aria-label="${c ? name : 'No colour'}" style="${c ? `background:${c}` : ''}">${c ? '' : '∅'}</button>`).join('')}</div>`;
        menuEl._onPick = onPick;
        menuEl.hidden = false;
        // on a phone the button may be hidden behind the sheet: put the colours in the middle
        if (!anchor.isConnected || anchor.offsetParent === null) {
            menuEl.style.left = `${Math.max(8, (window.innerWidth - menuEl.offsetWidth) / 2)}px`;
            menuEl.style.top = `${Math.max(8, (window.innerHeight - menuEl.offsetHeight) / 2)}px`;
        } else {
            menuAnchor = anchor;
            anchor.classList.add('open');
            placeMenu(anchor);
        }
    }
    menuEl.addEventListener('click', (e) => {
        const color = e.target.closest('[data-bg]');
        if (color) {
            const onPick = menuEl._onPick;
            closeMenu();
            if (onPick) onPick(color.dataset.bg);
            return;
        }
        const item = e.target.closest('.tree-menu-item');
        if (!item) return;
        const action = menuActions[Number(item.dataset.i)];
        const anchor = menuAnchor;
        closeMenu();
        if (action) {
            // keep the anchor so a follow-up (the colour picker) can open next to it
            if (anchor) anchor.isConnected && anchor.classList.remove('open');
            action.run();
        }
    });
    document.addEventListener('pointerdown', (e) => {
        if (menuEl.hidden || menuEl.contains(e.target) || (menuAnchor && menuAnchor.contains(e.target))) return;
        closeMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (menuEl.hidden) return;
        if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const items = [...menuEl.querySelectorAll('button')];
            const i = items.indexOf(document.activeElement);
            const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            if (next) { e.preventDefault(); next.focus(); }
        }
    }, true);
    window.addEventListener('resize', closeMenu);
    treeEl.addEventListener('scroll', closeMenu, { passive: true });

    function refreshFolderSelect() {
        if (state.currentNoteId) $('noteFolder').innerHTML = folderOptions(noteById(state.currentNoteId)?.folderId);
    }

    function makeTreeNotesDraggable() {
        treeEl.querySelectorAll('.note-item').forEach((item) => {
            item.setAttribute('draggable', 'true');
            item.addEventListener('dragstart', onTreeNoteDragStart);
            item.addEventListener('dragend', onTreeNoteDragEnd);
        });
    }

    let draggedTreeNoteId = null;

    function onTreeNoteDragStart(e) {
        const item = e.currentTarget;
        draggedTreeNoteId = item.dataset.noteId;
        e.dataTransfer.setData('text/plain', draggedTreeNoteId);
        e.dataTransfer.effectAllowed = 'copyMove';
        try {
            e.dataTransfer.setDragImage(item, 10, 10);
        } catch (err) {
            /* ignore */
        }
    }

    function clearTreeDropMarkers() {
        treeEl.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    }

    function onTreeNoteDragEnd() {
        draggedTreeNoteId = null;
        clearTreeDropMarkers();
        document.querySelectorAll('.calendar-day.drag-over').forEach((el) => el.classList.remove('drag-over'));
    }

    // Move a note so it sits before/after another note (and in that note's folder).
    function moveNoteNextTo(noteId, targetId, after) {
        const note = noteById(noteId);
        const target = noteById(targetId);
        if (!note || !target || note.id === target.id) return;
        const folderId = target.folderId || null;
        const siblings = sortedNotes(state.notes.filter((n) => (n.folderId || null) === folderId && n.id !== note.id));
        const index = siblings.indexOf(target) + (after ? 1 : 0);
        siblings.splice(index, 0, note);
        const now = new Date().toISOString();
        siblings.forEach((n, i) => {
            if (n.order !== i) { n.order = i; n.modifiedAt = now; }
        });
        note.folderId = folderId;
        note.modifiedAt = now;
        if (note.id === state.currentNoteId) state.currentFolderId = folderId;
        saveNotes();
        renderTree();
        renderEditor();
    }

    treeEl.addEventListener('click', (e) => {
        const noteMore = e.target.closest('.note-more');
        if (noteMore) {
            e.stopPropagation();
            const note = noteById(noteMore.dataset.noteId);
            if (!note) return;
            showMenu(noteMore, note.title.trim() || 'Untitled', [
                ...(isMobile() ? [{ label: 'Open', icon: '📄', run: () => { selectNote(note.id); app.classList.remove('mobile-open'); } }] : []),
                { label: 'Rename', icon: '✏️', run: () => renameNote(note.id) },
                { label: 'Background colour', icon: '🎨', run: () => pickBgColor(noteMore, note.bgColor, (c) => setItemBg(note, c)) },
                { label: 'Delete', icon: '🗑', danger: true, run: () => deleteNote(note.id) }
            ]);
            return;
        }
        const folderMore = e.target.closest('.folder-more');
        if (folderMore) {
            e.stopPropagation();
            const folder = state.folders.find((f) => f.id === folderMore.dataset.folderId);
            if (!folder) return;
            showMenu(folderMore, folder.name, [
                { label: 'New note in this folder', icon: '📝', run: () => newNote({ folderId: folder.id }) },
                { label: '+ Folder (inside this one)', icon: '📁', run: () => createFolder(folder.id) },
                { label: 'Move to…', icon: '↪', run: () => chooseFolderDestination(folder) },
                { label: 'Rename', icon: '✏️', run: () => renameFolder(folder.id) },
                { label: 'Background colour', icon: '🎨', run: () => pickBgColor(folderMore, folder.bgColor, (c) => setItemBg(folder, c, true)) },
                { label: 'Delete', icon: '🗑', danger: true, run: () => deleteFolder(folder.id) }
            ]);
            return;
        }
        const noteRename = e.target.closest('.note-rename');
        if (noteRename) {
            e.stopPropagation();
            renameNote(noteRename.dataset.noteId);
            return;
        }
        const noteDelete = e.target.closest('.note-delete');
        if (noteDelete) {
            e.stopPropagation();
            deleteNote(noteDelete.dataset.noteId);
            return;
        }
        const noteEl = e.target.closest('.note-item');
        if (noteEl) {
            selectNote(noteEl.dataset.noteId);
            if (isMobile()) app.classList.remove('mobile-open');
            return;
        }
        const add = e.target.closest('.folder-add');
        if (add) {
            e.stopPropagation();
            newNote({ folderId: add.dataset.folderId === '__none' ? null : add.dataset.folderId });
            return;
        }
        const sub = e.target.closest('.folder-sub');
        if (sub) {
            e.stopPropagation();
            createFolder(sub.dataset.folderId);
            return;
        }
        const rename = e.target.closest('.folder-rename');
        if (rename) {
            e.stopPropagation();
            renameFolder(rename.dataset.folderId);
            return;
        }
        const del = e.target.closest('.folder-delete');
        if (del) {
            e.stopPropagation();
            deleteFolder(del.dataset.folderId);
            return;
        }
        const header = e.target.closest('.folder-header');
        if (header) {
            const id = header.dataset.folderId;
            const list = state.prefs.expandedFolders;
            const index = list.indexOf(id);
            if (index >= 0) list.splice(index, 1);
            else list.push(id);
            savePrefs();
            renderTree();
        }
    });

    // Double-click a note or folder name to rename it
    treeEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        const title = e.target.closest('.note-item-title');
        if (title) { renameNote(title.closest('.note-item').dataset.noteId); return; }
        const name = e.target.closest('.folder-name');
        const header = name && name.closest('.folder-header');
        if (header && header.dataset.folderId !== '__none') renameFolder(header.dataset.folderId);
    });

    treeEl.addEventListener('dragover', (e) => {
        if (draggedFolderId) {
            const target = e.target.closest('.folder-header');
            clearTreeDropMarkers();
            if (!target) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const tid = target.dataset.folderId;
            if (tid === draggedFolderId || (tid !== '__none' && isInside(tid, draggedFolderId))) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }
            if (tid === '__none') { target.classList.add('drop-before'); return; }
            // top quarter = before, bottom quarter = after, middle = inside
            const rect = target.getBoundingClientRect();
            const y = (e.clientY - rect.top) / rect.height;
            target.classList.add(y < 0.25 ? 'drop-before' : y > 0.75 ? 'drop-after' : 'drop-inside');
            return;
        }
        const item = e.target.closest('.note-item');
        if (item && draggedTreeNoteId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            clearTreeDropMarkers();
            if (item.dataset.noteId === draggedTreeNoteId) return;
            const rect = item.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            item.classList.add(after ? 'drop-after' : 'drop-before');
            return;
        }
        const header = e.target.closest('.folder-header');
        if (!header) return;
        if (!draggedTreeNoteId && !Array.from(e.dataTransfer.types || []).includes('text/plain')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        header.classList.add('drag-over');
    });
    treeEl.addEventListener('dragleave', (e) => {
        if (!treeEl.contains(e.relatedTarget)) clearTreeDropMarkers();
        const header = e.target.closest('.folder-header');
        if (header && !header.contains(e.relatedTarget)) header.classList.remove('drag-over');
    });
    treeEl.addEventListener('drop', (e) => {
        if (draggedFolderId) {
            const target = e.target.closest('.folder-header');
            const after = !!target && target.classList.contains('drop-after');
            const inside = !!target && target.classList.contains('drop-inside');
            const before = !!target && target.classList.contains('drop-before');
            const id = draggedFolderId;
            draggedFolderId = null;
            clearTreeDropMarkers();
            if (!target) return;
            e.preventDefault();
            if (inside) moveFolderInto(id, target.dataset.folderId);
            else if (before || after || target.dataset.folderId === '__none') {
                moveFolderNextTo(id, target.dataset.folderId, after);
            }
            return;
        }
        const item = e.target.closest('.note-item');
        if (item && draggedTreeNoteId) {
            e.preventDefault();
            const after = item.classList.contains('drop-after');
            clearTreeDropMarkers();
            moveNoteNextTo(draggedTreeNoteId, item.dataset.noteId, after);
            return;
        }
        const header = e.target.closest('.folder-header');
        if (!header) return;
        e.preventDefault();
        header.classList.remove('drag-over');
        const note = noteById(e.dataTransfer.getData('text/plain') || draggedTreeNoteId);
        if (!note) return;
        note.folderId = header.dataset.folderId === '__none' ? null : header.dataset.folderId;
        state.currentFolderId = note.folderId;
        touch(note);
        renderTree();
        renderEditor();
    });

    /* ---------------- notes ---------------- */

    function selectNote(id) {
        flushEditor();
        if (state.prefs.scheduleCollapsed) {
            state.prefs.scheduleCollapsed = false;   // always show when/how the note is scheduled
            savePrefs();
        }
        state.currentNoteId = id;
        state.currentFolderId = noteById(id)?.folderId || null;
        renderTree();
        renderEditor();
    }

    // opts: { folderId, scheduledAt }
    function newNote(opts = {}) {
        flushEditor();
        setTab('note');
        const now = new Date().toISOString();
        const folderId = opts.folderId && state.folders.some((f) => f.id === opts.folderId) ? opts.folderId : null;
        state.currentFolderId = folderId;
        if (folderId) expandFolderPath(folderId);
        const expandId = folderId || '__none';
        if (!state.prefs.expandedFolders.includes(expandId)) state.prefs.expandedFolders.push(expandId);
        state.draw.strokes = [];
        state.draw.tool = 'pen';
        state.draw.drawing = false;
        state.draw.current = null;
        state.prefs.mode = 'text';
        const note = {
            id: uid(),
            title: '',
            content: '',
            createdAt: now,
            modifiedAt: now,
            scheduledAt: opts.scheduledAt || null,
            folderId,
            alarmEnabled: false,
            emailEnabled: false,
            emailTo: '',
            color: '',
            alarmRepeatCount: 0,
            alarmSnoozeMinutes: 5,
            repeatWeekdays: [],
            repeatMode: 'none',
            repeatEndDate: '',
            canvasBackground: DEFAULT_CANVAS_BG,
            html: '',
            gridType: 'square',
            grids: {},
            strokes: [],
            order: topOrder()
        };
        state.notes.push(note);
        saveNotes();
        state.currentNoteId = note.id;
        renderTree();
        renderEditor();
        $('noteTitle').focus();
        if (isMobile()) app.classList.remove('mobile-open');
    }

    async function deleteNote(id = state.currentNoteId) {
        flushEditor();
        const note = noteById(id);
        if (!note) return;
        const ok = await askConfirm('Delete note', `Delete "${note.title.trim() || 'Untitled'}"? This cannot be undone.`, 'Delete');
        if (!ok || !noteById(id)) return;
        state.notes = state.notes.filter((n) => n.id !== note.id);
        state.deleted.notes[note.id] = new Date().toISOString();
        addToTrash(note);
        delete state.alarms[note.id];
        saveNotes();
        saveAlarms();
        if (state.currentNoteId === note.id) {
            state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
            state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
            renderEditor();
        }
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
        toast('Note moved to trash', { label: 'Undo', onClick: () => restoreFromTrash(note.id) });
    }

    /* ---------------- trash ---------------- */

    const TRASH_DAYS = 30;

    function saveTrash() {
        const cutoff = Date.now() - TRASH_DAYS * 86400000;
        state.trash = state.trash.filter((t) => (Date.parse(t.deletedAt) || 0) > cutoff).slice(0, 100);
        writeJSON(STORAGE.trash, state.trash);
        updateTrashButton();
    }

    function addToTrash(note) {
        state.trash = state.trash.filter((t) => t.note.id !== note.id);
        state.trash.unshift({ note: JSON.parse(JSON.stringify(note)), deletedAt: new Date().toISOString() });
        saveTrash();
    }

    function updateTrashButton() {
        const btn = $('trashBtn');
        if (btn) btn.textContent = `🗑 Trash${state.trash.length ? ` (${state.trash.length})` : ''}`;
    }

    function restoreFromTrash(id) {
        const entry = state.trash.find((t) => t.note.id === id);
        if (!entry) return;
        const note = entry.note;
        migrateNote(note);
        note.modifiedAt = new Date().toISOString(); // newer than the delete, so sync keeps it
        if (note.folderId && !state.folders.some((f) => f.id === note.folderId)) note.folderId = null;
        delete state.deleted.notes[id];
        state.notes = state.notes.filter((n) => n.id !== id);
        state.notes.push(note);
        state.trash = state.trash.filter((t) => t.note.id !== id);
        saveTrash();
        resetAlarmRuntime(note);
        saveNotes();
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
        renderTrash();
        toast(`Restored "${note.title.trim() || 'Untitled'}"`);
    }

    function renderTrash() {
        const host = $('trashList');
        if (!host) return;
        $('emptyTrashBtn').disabled = !state.trash.length;
        if (!state.trash.length) {
            host.innerHTML = '<div class="calendar-hint">Trash is empty.</div>';
            return;
        }
        host.innerHTML = state.trash.map((t) => {
            const preview = t.note.private ? '🔒 Private note' : (t.note.content || '').replace(/\s+/g, ' ').trim().slice(0, 70) ||
                ((t.note.strokes || []).length ? 'Drawing' : 'Empty note');
            return `<div class="trash-item">
                <div class="trash-text">
                    <div class="trash-title">${escapeHtml((t.note.title || '').trim() || 'Untitled')}</div>
                    <div class="trash-meta">Deleted ${formatDateTime(toLocalIso(new Date(t.deletedAt)))} · ${escapeHtml(preview)}</div>
                </div>
                <button class="folder-action-btn trash-restore" data-note-id="${t.note.id}">Restore</button>
                <button class="folder-action-btn folder-delete trash-forever" data-note-id="${t.note.id}">Delete forever</button>
            </div>`;
        }).join('');
    }

    $('trashBtn').addEventListener('click', () => {
        saveTrash();
        renderTrash();
        openModal('trashModal');
    });
    $('trashClose').addEventListener('click', closeModals);
    $('trashBackdrop').addEventListener('click', closeModals);
    $('trashList').addEventListener('click', async (e) => {
        const restore = e.target.closest('.trash-restore');
        if (restore) { restoreFromTrash(restore.dataset.noteId); return; }
        const forever = e.target.closest('.trash-forever');
        if (forever) {
            const ok = await askConfirm('Delete forever', 'This note will be gone for good. Continue?', 'Delete');
            if (!ok) return;
            state.trash = state.trash.filter((t) => t.note.id !== forever.dataset.noteId);
            saveTrash();
            renderTrash();
            openModal('trashModal');
        }
    });
    $('emptyTrashBtn').addEventListener('click', async () => {
        if (!state.trash.length) return;
        const ok = await askConfirm('Empty trash', `Permanently delete ${state.trash.length} note(s)?`, 'Delete');
        if (!ok) { openModal('trashModal'); return; }
        state.trash = [];
        saveTrash();
        renderTrash();
        openModal('trashModal');
    });

    async function renameNote(id) {
        flushEditor();
        const note = noteById(id);
        if (!note) return;
        const name = await askText('Rename note', note.title, 'Rename');
        if (name === null || !noteById(id)) return;
        note.title = name.trim();
        touch(note);
        if (note.id === state.currentNoteId) $('noteTitle').value = note.title;
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    function folderOptions(selected) {
        return '<option value="">No folder</option>' + folderTree().map(({ folder: f, depth }) =>
            `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${'\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(f.name)}</option>`
        ).join('');
    }

    $('noteFolder').addEventListener('change', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.folderId = $('noteFolder').value || null;
        state.currentFolderId = note.folderId;
        touch(note);
        renderTree();
    });

    function renderEditor() {
        const note = noteById(state.currentNoteId);
        const empty = !note;
        // opening another note locks a private note again
        if ((note ? note.id : null) !== lastEditorNoteId) unlockedNoteId = null;
        lastEditorNoteId = note ? note.id : null;
        if (showPrivateLock(note)) return;

        $('noteTitle').disabled = empty;
        editorEl.contentEditable = empty ? 'false' : 'true';
        $('saveNoteBtn').disabled = empty;
        $('deleteNoteBtn').disabled = empty;
        $('noteFolder').disabled = empty;
        $('noteTitle').placeholder = empty ? 'No note selected' : 'Title';
        editorEl.dataset.placeholder = empty
            ? 'Create a note to get started.'
            : 'Write your note here... (you can paste or drag images in)';
        selectImage(null);
        textDirty = false;
        gridHistory = [];
        gridRedo = [];
        drawRedo = [];
        drawUndo = [];
        drawPick = [];
        gridPick = [];
        gridCopyMode = false;

        if (empty) {
            updatePrivateBtn(null);
            $('noteTitle').value = '';
            editorEl.innerHTML = '';
            $('noteFolder').innerHTML = folderOptions('');
            state.draw.strokes = [];
            updateScheduleUi(null);
            setMode('text');
            return;
        }

        $('noteTitle').value = note.title;
        updatePrivateBtn(note);
        stopVoicePlayback();
        editorEl.innerHTML = sanitizeHtml(note.html);   // (also turns web addresses into links)
        resetTextHistory();
        decorateVoiceChips();
        $('gridType').value = currentGridType(note);
        updateGridControls(note);
        $('noteFolder').innerHTML = folderOptions(note.folderId);
        updateScheduleUi(note);

        drawSel = null;
        state.draw.strokes = note.strokes.map(copyStroke);

        setMode(state.prefs.mode);
        fitCanvas();
        renderStrokes();
    }

    // A drawing item is a pen line, or a picture ({ image, x, y, w, h } as parts of the canvas size)
    function copyStroke(s) {
        if (s.image) return { image: s.image, x: s.x, y: s.y, w: s.w, h: s.h, points: [], ...(s.fill ? { fill: true } : {}) };
        return {
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: (s.points || []).map((p) => ({ x: p.x, y: p.y }))
        };
    }

    /* ---------------- private notes ----------------
     * A private note asks for the "Private Note Pass" every time it is opened.
     * The pass is kept on this device as a salted hash (never as plain text).
     * Note: this locks the note in the app; the note itself is not encrypted. */
    let privatePass = readJSON(STORAGE.privatePass, null);
    let unlockedNoteId = null;
    let lastEditorNoteId = null;
    const isPrivateLocked = (note) => !!(note && note.private && unlockedNoteId !== note.id);

    const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    async function hashPass(pass, salt, iterations) {
        if (window.crypto && crypto.subtle) {
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits(
                { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, key, 256);
            return 'pbkdf2:' + toHex(bits);
        }
        // very old browsers / file:// without crypto.subtle: a simple repeated hash
        let h = salt + pass;
        for (let i = 0; i < 2000; i++) {
            let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
            for (let j = 0; j < h.length; j++) {
                const c = h.charCodeAt(j);
                h1 = Math.imul(h1 ^ c, 2654435761);
                h2 = Math.imul(h2 ^ c, 1597334677);
            }
            h = (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + pass;
        }
        return 'simple:' + h.slice(0, 16);
    }
    async function checkPass(pass) {
        if (!privatePass) return false;
        return (await hashPass(pass, privatePass.salt, privatePass.iterations)) === privatePass.hash;
    }
    async function setPass(pass) {
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        const iterations = 150000;
        privatePass = { salt, iterations, hash: await hashPass(pass, salt, iterations) };
        writeJSON(STORAGE.privatePass, privatePass);
    }

    // Shows the lock screen for a private note; returns true when the note stays locked
    function showPrivateLock(note) {
        const locked = isPrivateLocked(note);
        const lock = $('privateLock');
        lock.hidden = !locked;
        [...$('viewNote').children].forEach((el) => {
            if (el === lock) return;
            if (locked) el.setAttribute('inert', ''); else el.removeAttribute('inert');
        });
        if (!locked) return false;
        // keep nothing of the note in the editor while it is locked
        stopVoicePlayback();
        editorEl.innerHTML = '';
        $('noteTitle').value = '';
        state.draw.strokes = [];
        drawSel = null;
        gridHistory = []; gridRedo = []; drawRedo = []; drawUndo = []; drawPick = [];
        textDirty = false;
        $('privateLockTitle').textContent = note.title.trim() || 'Untitled';
        $('privateLockInput').value = '';
        $('privateLockError').textContent = '';
        $('privateLockForm').hidden = !privatePass;
        $('privateLockNoPass').hidden = !!privatePass;
        if (privatePass && !isMobile()) setTimeout(() => $('privateLockInput').focus(), 30);
        return true;
    }

    async function unlockCurrent() {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const pass = $('privateLockInput').value;
        if (!pass) { $('privateLockError').textContent = 'Enter your Private Note Pass'; return; }
        if (await checkPass(pass)) {
            unlockedNoteId = note.id;
            renderEditor();
        } else {
            $('privateLockError').textContent = 'Wrong pass, try again';
            $('privateLockInput').select();
            const box = $('privateLock').querySelector('.private-lock-box');
            box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        }
    }
    $('privateLockBtn').addEventListener('click', unlockCurrent);
    $('privateLockInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); unlockCurrent(); } });
    $('privateLockNoPass').addEventListener('click', () => openSettings('pass'));

    function updatePrivateBtn(note) {
        const btn = $('privateBtn');
        btn.disabled = !note;
        const on = !!(note && note.private);
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '🔒 Private' : '🔓 Make Private';
        btn.title = on ? 'This note asks for your Private Note Pass. Click to make it normal again.' : 'Ask for a pass every time this note is opened';
    }
    $('privateBtn').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        if (!note || isPrivateLocked(note)) return;
        if (!note.private && !privatePass) {
            toast("Set your 'Private Note Pass' in Settings (Top right)", { label: 'Open Settings', onClick: () => openSettings('pass') });
            return;
        }
        flushEditor();
        note.private = !note.private;
        if (note.private) unlockedNoteId = note.id; // stays open until you open it again
        touch(note);
        updatePrivateBtn(note);
        renderTree();
        toast(note.private ? 'Private: this note now asks for your pass when opened' : 'This note is no longer private');
    });

    // Settings → Private Note Pass
    function updatePassPanel() {
        $('passStatus').textContent = privatePass
            ? 'A pass is set on this device. To change it, enter the current pass first.'
            : 'No pass yet. Choose a short pass you can remember.';
        $('passCurrentRow').hidden = !privatePass;
        ['passCurrent', 'passNew', 'passRepeat'].forEach((id) => { $(id).value = ''; });
        $('passError').textContent = '';
        $('passSave').textContent = privatePass ? 'Change pass' : 'Set pass';
    }
    $('passSave').addEventListener('click', async () => {
        const err = $('passError');
        const next = $('passNew').value;
        if (privatePass && !(await checkPass($('passCurrent').value))) { err.textContent = 'The current pass is not right'; return; }
        if (next.length < 3) { err.textContent = 'Use at least 3 characters'; return; }
        if (next !== $('passRepeat').value) { err.textContent = 'The two new passes are not the same'; return; }
        await setPass(next);
        updatePassPanel();
        toast('Private Note Pass saved');
        if (isPrivateLocked(noteById(state.currentNoteId))) renderEditor();
    });
    $('passRepeat').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('passSave').click(); });

    let editorTimer = null;
    function queueSave() {
        clearTimeout(editorTimer);
        editorTimer = setTimeout(flushEditor, 600);
    }

    function flushEditor() {
        clearTimeout(editorTimer);
        const note = noteById(state.currentNoteId);
        if (!note || isPrivateLocked(note)) return;
        const title = $('noteTitle').value;
        let html = note.html;
        let content = note.content;
        if (textDirty) {
            html = sanitizeHtml(editorEl.innerHTML);
            content = htmlToText(html);
        }
        const folderId = $('noteFolder').value || null;
        const strokes = state.draw.strokes.map(copyStroke);
        textDirty = false;
        const changed = note.title !== title || note.html !== html || note.folderId !== folderId ||
            JSON.stringify(note.strokes) !== JSON.stringify(strokes);
        if (!changed) return;
        note.title = title;
        note.html = html;
        note.content = content;
        note.folderId = folderId;
        note.strokes = strokes;
        note.modifiedAt = new Date().toISOString();
        saveNotes();
        renderTree();
    }

    $('noteTitle').addEventListener('input', queueSave);
    /* ---------------- rich text (text + images) ---------------- */

    const editorEl = $('noteContent');
    let textDirty = false;   // true once the user changed the text since it was loaded
    let selectedImg = null;

    const RICH_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI',
        'IMG', 'SPAN', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'S', 'STRIKE', 'DEL', 'A', 'FONT']);
    const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
    const SAFE_LINK_RE = /^(https?:\/\/|mailto:)/i;

    function cssColorToHex(value) {
        const v = String(value || '').trim();
        if (HEX_COLOR_RE.test(v)) return v.toLowerCase();
        const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
        return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '';
    }
    const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'META', 'LINK', 'TITLE', 'svg', 'SVG']);

    // Keep only safe, simple formatting + embedded (data:) images
    function sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
        const root = doc.body.firstElementChild || doc.body;
        (function clean(node) {
            [...node.childNodes].forEach((child) => {
                if (child.nodeType === 3) return;
                if (child.nodeType !== 1 || DROP_TAGS.has(child.tagName)) { child.remove(); return; }
                clean(child);
                if (!RICH_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
                if (child.tagName === 'SPAN' && child.hasAttribute('data-voice')) {
                    const src = child.getAttribute('data-voice') || '';
                    if (!VOICE_SRC_RE.test(src)) { child.remove(); return; }
                    const name = (child.getAttribute('data-name') || 'Voice note').slice(0, 200);
                    const dur = String(Math.max(0, Math.round(Number(child.getAttribute('data-duration')) || 0)));
                    [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
                    child.setAttribute('data-voice', src);
                    child.setAttribute('data-name', name);
                    child.setAttribute('data-duration', dur);
                    child.textContent = `🎤 ${name}`;
                    return;
                }
                // <font color> / <span style="color"> → <span style="color:#..."> (text colour)
                if (child.tagName === 'FONT' || child.tagName === 'SPAN') {
                    const styleColor = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(child.getAttribute('style') || '');
                    const color = cssColorToHex(child.tagName === 'FONT' ? child.getAttribute('color') : (styleColor && styleColor[1]));
                    if (!color) { child.replaceWith(...child.childNodes); return; }
                    const span = doc.createElement('span');
                    span.setAttribute('style', `color:${color}`);
                    span.append(...child.childNodes);
                    child.replaceWith(span);
                    return;
                }
                // strikethrough
                if (child.tagName === 'STRIKE' || child.tagName === 'DEL') {
                    const s = doc.createElement('s');
                    s.append(...child.childNodes);
                    child.replaceWith(s);
                    return;
                }
                // links: only web and mail links, always opened in a new tab
                if (child.tagName === 'A') {
                    const href = (child.getAttribute('href') || '').trim();
                    if (!SAFE_LINK_RE.test(href)) { child.replaceWith(...child.childNodes); return; }
                    [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
                    child.setAttribute('href', href);
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                    return;
                }
                [...child.attributes].forEach((attr) => {
                    const keep = child.tagName === 'IMG' && (attr.name === 'style' || attr.name === 'alt' ||
                        (attr.name === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(attr.value)));
                    if (!keep) child.removeAttribute(attr.name);
                });
                if (child.tagName === 'IMG') {
                    if (!child.getAttribute('src')) { child.remove(); return; }
                    const m = /width:\s*(\d{1,3})%/.exec(child.getAttribute('style') || '');
                    if (m) child.setAttribute('style', `width:${Math.min(100, Number(m[1]))}%`);
                    else child.removeAttribute('style');
                }
            });
        })(root);
        linkifyNode(root);
        return root.innerHTML;
    }

    /* ---- clickable links ---- */
    const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

    function trimUrl(url) {
        // "see https://x.nl." → leave the final dot/bracket out of the link
        let u = url.replace(/[.,;:!?'"]+$/, '');
        if (u.endsWith(')') && !u.includes('(')) u = u.slice(0, -1);
        return u;
    }

    // Turn plain-text web addresses inside `root` into <a> links
    function linkifyNode(root, skipNode) {
        const doc = root.ownerDocument;
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets = [];
        while (walker.nextNode()) {
            const t = walker.currentNode;
            if (t === skipNode || t.parentElement.closest('a, .voice-chip, span[data-voice]')) continue;
            URL_RE.lastIndex = 0;
            if (URL_RE.test(t.data)) targets.push(t);
        }
        targets.forEach((t) => {
            const frag = doc.createDocumentFragment();
            let last = 0;
            t.data.replace(URL_RE, (match, _g, offset) => {
                const url = trimUrl(match);
                frag.append(t.data.slice(last, offset));
                const a = doc.createElement('a');
                a.href = /^www\./i.test(url) ? `https://${url}` : url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = url;
                frag.append(a);
                last = offset + url.length;
                return match;
            });
            frag.append(t.data.slice(last));
            t.replaceWith(frag);
        });
    }

    function textToHtml(text) {
        return escapeHtml(text || '').replace(/\n/g, '<br>');
    }

    // Plain text version (for previews, alarms and search)
    function htmlToText(html) {
        const body = new DOMParser().parseFromString(html || '', 'text/html').body;
        let out = '';
        (function walk(node) {
            node.childNodes.forEach((ch) => {
                if (ch.nodeType === 3) { out += ch.nodeValue; return; }
                if (ch.nodeType !== 1) return;
                if (ch.tagName === 'BR') { out += '\n'; return; }
                if (ch.tagName === 'IMG') { if (out && !out.endsWith('\n')) out += '\n'; return; }
                if (ch.tagName === 'SPAN' && ch.hasAttribute('data-voice')) { out += `🎤 ${ch.getAttribute('data-name') || 'Voice note'}`; return; }
                const block = /^(DIV|P|LI|H1|H2|H3|BLOCKQUOTE|UL|OL)$/.test(ch.tagName);
                if (block && out && !out.endsWith('\n')) out += '\n';
                walk(ch);
                if (block && out && !out.endsWith('\n')) out += '\n';
            });
        })(body);
        return out.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    function hasVoice(note) {
        return /data-voice=/i.test(note.html || '');
    }

    function hasImages(note) {
        return /<img\b/i.test(note.html || '');
    }

    function markTextChanged() {
        textDirty = true;
        queueSave();
        updateTextUndoButtons();
    }

    /* ---------------- undo / redo in the text ----------------
     * Our own history (the browser's undo can't undo pictures that were added, moved
     * or removed). Typing is grouped per word / pause; every button action is one step. */
    let textUndo = [], textRedo = [];
    let lastTypeAt = 0, lastTypeKind = '';
    function caretOffset() {
        const sel = window.getSelection();
        if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) return null;
        const r = document.createRange();
        r.selectNodeContents(editorEl);
        r.setEnd(sel.anchorNode, sel.anchorOffset);
        return r.toString().length;
    }
    function setCaretOffset(n) {
        if (n === null || n === undefined) return;
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
        let node, left = n;
        while ((node = walker.nextNode())) {
            if (left <= node.length) {
                const r = document.createRange();
                r.setStart(node, left);
                r.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(r);
                return;
            }
            left -= node.length;
        }
    }
    const textSnap = () => ({ html: editorEl.innerHTML, caret: caretOffset() });
    // call BEFORE changing the text
    function recordText() {
        if (!noteById(state.currentNoteId)) return;
        const snap = textSnap();
        const top = textUndo[textUndo.length - 1];
        if (top && top.html === snap.html) return;
        textUndo.push(snap);
        if (textUndo.length > 200) textUndo.shift();
        textRedo = [];
        updateTextUndoButtons();
    }
    function applyTextSnap(snap) {
        editorEl.innerHTML = snap.html;
        decorateVoiceChips();
        selectImage(null);
        editorEl.focus({ preventScroll: true });
        setCaretOffset(snap.caret);
        lastTypeKind = '';
        markTextChanged();
    }
    function undoText() {
        const prev = textUndo.pop();
        if (!prev) return;
        textRedo.push(textSnap());
        applyTextSnap(prev);
    }
    function redoText() {
        const next = textRedo.pop();
        if (!next) return;
        textUndo.push(textSnap());
        applyTextSnap(next);
    }
    function resetTextHistory() { textUndo = []; textRedo = []; lastTypeKind = ''; updateTextUndoButtons(); }
    function updateTextUndoButtons() {
        if (!$('textUndo')) return;
        $('textUndo').disabled = !textUndo.length;
        $('textRedo').disabled = !textRedo.length;
    }
    editorEl.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
            e.preventDefault();
            if (e.inputType === 'historyUndo') undoText(); else redoText();
            return;
        }
        // a new step when you start deleting after typing (or the other way round),
        // after a pause, at a new word or a new line
        const kind = e.inputType.startsWith('delete') ? 'delete' : e.inputType === 'insertText' ? 'type' : e.inputType;
        const now = Date.now();
        if (kind !== lastTypeKind || now - lastTypeAt > 1500 || e.data === ' ' || kind === 'insertParagraph') recordText();
        lastTypeAt = now;
        lastTypeKind = kind;
    });
    editorEl.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); undoText(); }
        else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redoText(); }
    });

    editorEl.addEventListener('input', markTextChanged);

    // A web address becomes a link as soon as you type a space or Enter after it
    editorEl.addEventListener('input', (e) => {
        if (!((e.inputType === 'insertText' && e.data === ' ') || e.inputType === 'insertParagraph')) return;
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        let node = sel.anchorNode;
        // after Enter the caret is on the new line: look at the end of the previous line
        if (e.inputType === 'insertParagraph') {
            const block = (node.nodeType === 1 ? node : node.parentElement).closest('div, p, li');
            const prev = block && block.previousSibling;
            if (!prev) return;
            linkifyNode(prev.nodeType === 3 ? prev.parentNode : prev);
            return;
        }
        if (!node || node.nodeType !== 3 || node.parentElement.closest('a')) return;
        const offset = sel.anchorOffset;
        const before = node.data.slice(0, offset - 1);
        const m = /((?:https?:\/\/|www\.)[^\s<>"']+)$/i.exec(before);
        if (!m) return;
        const url = trimUrl(m[1]);
        const start = before.length - m[1].length;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + url.length);
        const a = document.createElement('a');
        a.href = /^www\./i.test(url) ? `https://${url}` : url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        range.surroundContents(a);
        // keep typing after the link, not inside it
        const after = a.nextSibling;
        const caret = document.createRange();
        if (after && after.nodeType === 3) caret.setStart(after, Math.min(after.length, 1 + (m[1].length - url.length)));
        else caret.setStartAfter(a);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        markTextChanged();
    });
    editorEl.addEventListener('blur', () => {
        const before = editorEl.innerHTML;
        linkifyNode(editorEl);
        if (editorEl.innerHTML !== before) markTextChanged();
    });

    /* ---- text colours ---- */
    const TEXT_COLORS = [
        ['', 'Default colour'],
        ['#ff9494', 'Pastel red'], ['#ffca8c', 'Pastel orange'], ['#fcff9c', 'Pastel yellow'],
        ['#b5ffa6', 'Pastel green'], ['#86b4ff', 'Pastel blue'], ['#c59cff', 'Pastel purple'],
        ['#000000', 'Black']
    ];
    $('textColors').innerHTML = TEXT_COLORS.map(([c, name]) =>
        `<button type="button" class="text-color${c ? '' : ' reset'}" data-text-color="${c}" title="${name}" style="${c ? `background:${c}` : ''}">${c ? '' : 'A'}</button>`
    ).join('');

    function applyTextColor(color) {
        if (!noteById(state.currentNoteId)) return;
        editorEl.focus();
        try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
        if (color) {
            document.execCommand('foreColor', false, color);
        } else {
            // back to the normal colour: colour with a marker, then remove those colour tags
            const MARK = '#010203';
            document.execCommand('foreColor', false, MARK);
            editorEl.querySelectorAll('font[color], span[style*="color"]').forEach((el) => {
                const c = el.tagName === 'FONT' ? el.getAttribute('color') : cssColorToHex(el.style.color);
                if (cssColorToHex(c) !== MARK) return;
                el.querySelectorAll('font[color], span[style*="color"]').forEach((inner) => inner.replaceWith(...inner.childNodes));
                el.replaceWith(...el.childNodes);
            });
        }
        markTextChanged();
    }

    /* ---- heading (subkopje) ---- */
    function currentBlockTag() {
        const sel = window.getSelection();
        const node = sel.rangeCount ? sel.anchorNode : null;
        if (!node || !editorEl.contains(node)) return '';
        const el = (node.nodeType === 1 ? node : node.parentElement).closest('h1, h2, h3, li');
        return el && editorEl.contains(el) ? el.tagName : '';
    }

    function toggleHeading() {
        if (!noteById(state.currentNoteId)) return;
        editorEl.focus();
        const inHeading = /^H[123]$/.test(currentBlockTag());
        document.execCommand('formatBlock', false, inHeading ? '<div>' : '<h2>');
        markTextChanged();
        updateToolbarState();
    }

    $('headingBtn').addEventListener('click', toggleHeading);
    editorEl.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === '2') { e.preventDefault(); toggleHeading(); }
    });

    // Light up the buttons for the formatting where the cursor is (bold, list, heading, ...)
    function updateToolbarState() {
        const sel = window.getSelection();
        const inside = sel.rangeCount && editorEl.contains(sel.anchorNode);
        $('textToolbar').querySelectorAll('[data-cmd]').forEach((btn) => {
            let on = false;
            try { on = inside && document.queryCommandState(btn.dataset.cmd); } catch (_) { /* ignore */ }
            btn.classList.toggle('active', !!on);
        });
        $('headingBtn').classList.toggle('active', !!inside && /^H[123]$/.test(currentBlockTag()));
    }
    document.addEventListener('selectionchange', () => {
        if (state.prefs.mode === 'text') updateToolbarState();
    });

    $('textColors').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-text-color]');
        if (btn) applyTextColor(btn.dataset.textColor);
    });
    editorEl.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            document.execCommand('strikeThrough', false, null);
            markTextChanged();
        }
    });

    // Typing "1. " or "- " / "* " at the start of a line turns it into a list (like Word)
    editorEl.addEventListener('input', (e) => {
        if (e.inputType !== 'insertText' || e.data !== ' ') return;
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !editorEl.contains(node)) return;
        if (node.parentElement.closest('li')) return; // already in a list
        const before = node.data.slice(0, sel.anchorOffset).replace(/\u00a0/g, ' ');
        const lineStart = !node.previousSibling || node.previousSibling.nodeName === 'BR';
        if (!lineStart) return;
        let cmd = null;
        if (/^\s*1[.)] $/.test(before)) cmd = 'insertOrderedList';
        else if (/^\s*[-*•] $/.test(before)) cmd = 'insertUnorderedList';
        if (!cmd) return;
        // remove the typed "1. " and start the list on this line
        const rest = node.data.slice(sel.anchorOffset);
        const range = document.createRange();
        if (rest) {
            node.data = rest;
            range.setStart(node, 0);
        } else {
            // keep the (now empty) line alive so the list starts here, not on the line above
            const br = document.createElement('br');
            node.replaceWith(br);
            range.setStartBefore(br);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand(cmd, false, null);
        markTextChanged();
    });

    // Shrink big photos so they fit in browser storage (and sync quickly)
    const IMAGE_MAX_SIDE = 1400;
    function imageFileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const original = reader.result;
                if (file.type === 'image/gif' && file.size < 1.5e6) { resolve(original); return; } // keep animation
                const img = new Image();
                img.onerror = () => reject(new Error('not an image'));
                img.onload = () => {
                    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
                    if (scale === 1 && file.size < 350000 && /^data:image\/(png|jpe?g|webp)/.test(original)) {
                        resolve(original);
                        return;
                    }
                    const c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(img.width * scale));
                    c.height = Math.max(1, Math.round(img.height * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    let out = c.toDataURL('image/webp', 0.85);
                    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.85);
                    resolve(out);
                };
                img.src = original;
            };
            reader.readAsDataURL(file);
        });
    }

    function placeCaretAtPoint(x, y) {
        let range = null;
        if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
        else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (range && editorEl.contains(range.startContainer)) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    function ensureCaretInEditor() {
        const sel = window.getSelection();
        const inside = sel.rangeCount && editorEl.contains(sel.getRangeAt(0).commonAncestorContainer);
        editorEl.focus();
        if (inside) {
            // don't let a new image inherit bold/italic/underline
            ['bold', 'italic', 'underline'].forEach((cmd) => {
                if (document.queryCommandState(cmd)) document.execCommand(cmd, false, null);
            });
            return;
        }
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function insertNodeAtCaret(node) {
        const sel = window.getSelection();
        let range = sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range || !editorEl.contains(range.commonAncestorContainer)) {
            range = document.createRange();
            range.selectNodeContents(editorEl);
            range.collapse(false);
        }
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // The top-level lines (blocks) of the text, with where they are on screen
    function textBlocks() {
        const out = [];
        editorEl.childNodes.forEach((n) => {
            if (n.nodeType === 3 && !n.textContent.trim()) return;
            let rect;
            if (n.nodeType === 1) rect = n.getBoundingClientRect();
            else { const r = document.createRange(); r.selectNodeContents(n); rect = r.getBoundingClientRect(); }
            if (rect.height || rect.width) out.push({ node: n, rect });
        });
        return out;
    }
    // a line with only pictures in it (pictures can stand side by side there)
    function isPictureLine(n) {
        return !!n && n.nodeType === 1 && (n.nodeName === 'DIV' || n.nodeName === 'P') && !!n.querySelector(':scope > img')
            && [...n.childNodes].every((c) => c.nodeName === 'IMG' || c.nodeName === 'BR' || (c.nodeType === 3 && !c.textContent.trim()));
    }
    // all picture lines (also ones nested in another line), after giving loose pictures a line of their own
    function pictureLines() {
        [...editorEl.childNodes].forEach((n) => {
            if (n.nodeName !== 'IMG') return;
            const line = document.createElement('div');
            editorEl.insertBefore(line, n);
            line.appendChild(n);
        });
        return [...editorEl.querySelectorAll('div, p')].filter(isPictureLine);
    }
    // Pointer at the height of a picture line (anywhere left/right): next to the pictures on it
    function sideBySidePoint(x, y) {
        for (const line of pictureLines()) {
            const imgs = [...line.querySelectorAll(':scope > img')];
            const rects = imgs.map((i) => i.getBoundingClientRect());
            const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
            if (y < top - 4 || y > bottom + 4) continue;
            // the picture whose middle is right of the pointer: the new one goes before it; else at the end
            const i = rects.findIndex((r) => y >= r.top - 4 && y <= r.bottom + 4 && x < r.left + r.width / 2);
            const last = rects[rects.length - 1];
            return {
                inline: true, line, beforeImg: i < 0 ? null : imgs[i],
                x: i < 0 ? last.right + 6 : rects[i].left - 6, y: i < 0 ? last.top : rects[i].top,
                h: i < 0 ? last.height : rects[i].height, end: i < 0
            };
        }
        return null;
    }
    // Where a picture lands: next to another picture, or between two lines (the nearest one)
    function dropTarget(x, y) { return sideBySidePoint(x, y) || dropPoint(y); }
    function dropPoint(y) {
        const blocks = textBlocks();
        for (const b of blocks) {
            if (y < b.rect.top + b.rect.height / 2) return { before: b.node, y: b.rect.top };
        }
        const last = blocks[blocks.length - 1];
        const er = editorEl.getBoundingClientRect();
        return { before: null, y: last ? last.rect.bottom : er.top + parseFloat(getComputedStyle(editorEl).paddingTop || 0) };
    }
    // Where a picture added with the button / Ctrl+V goes: after the line with the caret
    function caretPoint() {
        const sel = window.getSelection();
        if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) return { before: null };
        let n = sel.anchorNode;
        if (n === editorEl) return { before: editorEl.childNodes[sel.anchorOffset] || null };
        while (n.parentNode !== editorEl) n = n.parentNode;
        // an empty line: put the picture there (before it), so you keep typing below it
        if (n.nodeType === 1 && !n.textContent.trim() && !n.querySelector('img, audio, [data-voice]')) return { before: n };
        return { before: n.nextSibling };
    }
    function pictureLine(src) {
        const line = document.createElement('div');
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.style.width = '25%'; // new pictures start at size M
        line.appendChild(img);
        return line;
    }
    // put a line in the text; there is always an empty line after the last picture to type in
    function placeLine(line, point) {
        const before = point.before && point.before.parentNode === editorEl ? point.before : null;
        editorEl.insertBefore(line, before);
        if (!line.nextSibling) {
            const blank = document.createElement('div');
            blank.appendChild(document.createElement('br'));
            editorEl.appendChild(blank);
        }
    }

    // put a picture into a picture line, before `beforeImg` (or at the end)
    function placeInline(img, point) {
        const old = img.parentNode;
        point.line.insertBefore(img, point.beforeImg && point.beforeImg.parentNode === point.line ? point.beforeImg : null);
        // the line it came from is now empty: remove it
        if (old && old !== point.line && old.parentNode === editorEl && !old.querySelector('img') && !old.textContent.trim()) old.remove();
    }

    let insertingImages = false;
    async function insertImageFiles(files, point) {
        if (!noteById(state.currentNoteId)) return;
        const images = [...files].filter((f) => f.type.startsWith('image/'));
        if (!images.length || insertingImages) return;
        insertingImages = true; // never handle the same drop / paste twice
        recordText();
        const at = point || caretPoint();
        let lastImg = null;
        try {
            for (const file of images) {
                try {
                    const line = pictureLine(await imageFileToDataUrl(file));
                    if (at.inline) {
                        const img = line.querySelector('img');
                        placeInline(img, at); // next to the other picture(s)
                        at.beforeImg = img.nextSibling && img.nextSibling.nodeName === 'IMG' ? img.nextSibling : null;
                        lastImg = img;
                    } else {
                        placeLine(line, at);
                        lastImg = line.querySelector('img');
                    }
                } catch (err) {
                    toast(`Could not load image: ${file.name}`);
                }
            }
        } finally {
            insertingImages = false;
        }
        if (lastImg) {
            // caret on the line after the picture
            const next = lastImg.parentNode.nextSibling;
            if (next) {
                const r = document.createRange();
                r.selectNodeContents(next);
                r.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(r);
            }
        }
        textDirty = true;
        flushEditor();
        updateTextUndoButtons();
    }

    // dashed outline showing where a dragged picture will land
    const dropOutline = document.createElement('div');
    dropOutline.className = 'drop-outline';
    dropOutline.hidden = true;
    document.body.appendChild(dropOutline);
    function showDropOutline(point, aspect, widthPct) {
        const er = editorEl.getBoundingClientRect();
        const cs = getComputedStyle(editorEl);
        const left = er.left + parseFloat(cs.paddingLeft || 0);
        const width = (er.width - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)) * (widthPct || 25) / 100;
        const height = Math.max(24, width * (aspect || 0.66));
        dropOutline.classList.toggle('inline', !!point.inline);
        if (point.inline && point.end) {
            // the picture's own size, right next to the last picture on that line
            dropOutline.style.left = `${point.x}px`;
            dropOutline.style.top = `${point.y + Math.max(0, (point.h || height) - height)}px`;
            dropOutline.style.width = `${width}px`;
            dropOutline.style.height = `${height}px`;
        } else if (point.inline) {
            // between two pictures: a bar where it slides in
            dropOutline.style.left = `${point.x - 3}px`;
            dropOutline.style.top = `${point.y}px`;
            dropOutline.style.width = '8px';
            dropOutline.style.height = `${point.h || height}px`;
        } else {
            dropOutline.style.left = `${left}px`;
            dropOutline.style.top = `${point.y + 2}px`;
            dropOutline.style.width = `${width}px`;
            dropOutline.style.height = `${height}px`;
        }
        dropOutline.hidden = false;
    }
    const hideDropOutline = () => { dropOutline.hidden = true; };

    // Ctrl+C on a clicked picture copies the picture (also when no text is selected)
    editorEl.addEventListener('copy', (e) => {
        if (!selectedImg || !editorEl.contains(selectedImg) || !e.clipboardData) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return; // copying text: normal copy
        e.preventDefault();
        const src = selectedImg.getAttribute('src') || '';
        e.clipboardData.setData('text/html', `<img src="${src.replace(/"/g, '&quot;')}">`);
        e.clipboardData.setData('text/plain', '');
        toast('Picture copied — paste it with Ctrl+V (also in the drawing)');
    });

    editorEl.addEventListener('paste', (e) => {
        const dt = e.clipboardData;
        if (!dt) return;
        const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
        const audio = [...dt.files].filter((f) => f.type.startsWith('audio/'));
        if (files.length || audio.length) {
            e.preventDefault();
            if (files.length) insertImageFiles(files);
            if (audio.length) insertAudioFiles(audio);
            return;
        }
        const html = dt.getData('text/html');
        // a piece copied from the drawing or the grid: insert it like any other picture
        const own = html && /<img[^>]*data-remindate-copy[^>]*src="(data:image\/[^"]+)"/i.exec(html);
        if (own) {
            e.preventDefault();
            fetch(own[1]).then((r) => r.blob())
                .then((blob) => insertImageFiles([new File([blob], 'drawing.png', { type: blob.type || 'image/png' })]))
                .catch(() => toast('Could not paste that picture'));
            return;
        }
        if (html) {
            e.preventDefault();
            document.execCommand('insertHTML', false, sanitizeHtml(html));
            markTextChanged();
        }
    });

    const draggingAppItem = () => !!(draggedTreeNoteId || draggedFolderId ||
        (typeof draggedCalendarNote !== 'undefined' && draggedCalendarNote));
    editorEl.addEventListener('dragover', (e) => {
        if (draggingAppItem()) { e.dataTransfer.dropEffect = 'none'; return; }
        if (!movingNoteImg && !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        const aspect = movingNoteImg && movingNoteImg.naturalWidth ? movingNoteImg.naturalHeight / movingNoteImg.naturalWidth : 0.66;
        const pct = movingNoteImg ? parseFloat(movingNoteImg.style.width) || 25 : 25;
        showDropOutline(dropTarget(e.clientX, e.clientY), aspect, pct);
    });
    editorEl.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !editorEl.contains(e.relatedTarget)) hideDropOutline();
    });
    document.addEventListener('dragend', hideDropOutline);
    document.addEventListener('drop', hideDropOutline, true);
    // Dragging a picture that is already in the note: Chrome also hands it over as a "file",
    // which used to add a second copy. Remember the picture and just move it instead.
    let movingNoteImg = null;
    editorEl.addEventListener('dragstart', (e) => {
        const img = e.target && e.target.closest && e.target.closest('img');
        movingNoteImg = img && editorEl.contains(img) ? img : null;
    });
    editorEl.addEventListener('dragend', () => { movingNoteImg = null; hideDropOutline(); });

    editorEl.addEventListener('drop', (e) => {
        if (draggingAppItem()) { e.preventDefault(); return; }
        if (movingNoteImg) {
            const img = movingNoteImg;
            movingNoteImg = null;
            e.preventDefault();
            hideDropOutline();
            if (!editorEl.contains(img)) return;
            const point = dropTarget(e.clientX, e.clientY);
            if (point.inline) {
                if (point.beforeImg === img || (point.line === img.parentNode && (point.beforeImg === img.nextSibling
                    || (!point.beforeImg && !img.nextElementSibling)))) return; // same place
                recordText();
                placeInline(img, point);
                selectImage(img);
                markTextChanged();
                return;
            }
            // the picture's own line moves along (one node, so never a copy)
            let line = img.parentNode;
            const alone = line && line.parentNode === editorEl && line.nodeName === 'DIV'
                && [...line.childNodes].every((n) => n === img || (n.nodeType === 3 && !n.textContent.trim()) || n.nodeName === 'BR');
            if (point.before === line || (alone && point.before === line.nextSibling)) return; // same place
            recordText();
            if (!alone) { line = document.createElement('div'); line.appendChild(img); }
            placeLine(line, point);
            selectImage(img);
            markTextChanged();
            return;
        }
        const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
        const audio = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('audio/'));
        if (!files.length && !audio.length) return;
        e.preventDefault();
        e.stopPropagation();
        hideDropOutline();
        if (files.length) insertImageFiles(files, dropTarget(e.clientX, e.clientY));
        if (audio.length) { placeCaretAtPoint(e.clientX, e.clientY); insertAudioFiles(audio); }
    });

    function selectImage(img) {
        editorEl.querySelectorAll('img.selected').forEach((i) => i.classList.remove('selected'));
        selectedImg = img || null;
        if (selectedImg) selectedImg.classList.add('selected');
        $('imageTools').hidden = !selectedImg;
    }

    editorEl.addEventListener('click', (e) => {
        if (e.target.closest('.voice-chip')) { handleVoiceChipClick(e); return; }
        const link = e.target.closest('a[href]');
        if (link && editorEl.contains(link) && !window.getSelection().toString()) {
            e.preventDefault();
            if (SAFE_LINK_RE.test(link.getAttribute('href'))) window.open(link.getAttribute('href'), '_blank', 'noopener');
            return;
        }
        const img = e.target.closest('img');
        selectImage(img && editorEl.contains(img) ? img : null);
    });
    // Tab / Shift+Tab inside a list: indent / outdent the item
    editorEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const sel = window.getSelection();
        const node = sel.rangeCount ? sel.anchorNode : null;
        const li = node && (node.nodeType === 1 ? node : node.parentElement).closest('li');
        if (!li || !editorEl.contains(li)) return;
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
        markTextChanged();
    });
    editorEl.addEventListener('keydown', (e) => {
        if (selectedImg && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            selectedImg.remove();
            selectImage(null);
            markTextChanged();
        }
    });

    try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* ignore */ }
    try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (_) { /* ignore */ }
    // Toolbar buttons must not take the focus away from the text
    $('textToolbar').addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) e.preventDefault();
    });
    $('textToolbar').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b && b.id !== 'textUndo' && b.id !== 'textRedo') recordText();
    }, true);
    $('textUndo').addEventListener('click', undoText);
    $('textRedo').addEventListener('click', redoText);
    $('textToolbar').addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]');
        if (cmd) {
            if (!noteById(state.currentNoteId)) return;
            editorEl.focus();
            document.execCommand(cmd.dataset.cmd, false, null);
            markTextChanged();
            updateToolbarState();
            return;
        }
        const size = e.target.closest('[data-img-size]');
        if (size && selectedImg) {
            selectedImg.style.width = `${size.dataset.imgSize}%`;
            markTextChanged();
        }
    });
    // Download the selected picture (also possible with right-click → Save image as)
    $('imageDownload').addEventListener('click', () => {
        if (!selectedImg) return;
        const src = selectedImg.getAttribute('src') || '';
        const mime = (/^data:([^;,]+)/.exec(src) || [])[1] || 'image/png';
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[mime] || 'png';
        const note = noteById(state.currentNoteId);
        const base = ((note && note.title.trim()) || 'picture').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'picture';
        const pics = [...editorEl.querySelectorAll('img')];
        const n = pics.length > 1 ? `-${pics.indexOf(selectedImg) + 1}` : '';
        const a = document.createElement('a');
        a.href = src;
        a.download = `${base}${n}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    });
    // put the selected picture next to the picture(s) on the line above it
    $('imageSideBySide').addEventListener('click', () => {
        if (!selectedImg) return;
        const line = selectedImg.parentNode;
        let prev = line && line.parentNode === editorEl ? line.previousSibling : null;
        while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
        if (!isPictureLine(prev)) { toast('There is no picture on the line above to put it next to'); return; }
        placeInline(selectedImg, { line: prev, beforeImg: null });
        selectImage(selectedImg);
        markTextChanged();
    });
    // put the selected picture on a line of its own (below the line it is on now)
    $('imageOwnLine').addEventListener('click', () => {
        if (!selectedImg) return;
        const line = selectedImg.parentNode;
        if (!line || line.parentNode !== editorEl) return;
        if (isPictureLine(line) && line.querySelectorAll(':scope > img').length === 1) { toast('This picture already has its own line'); return; }
        const own = document.createElement('div');
        editorEl.insertBefore(own, line.nextSibling);
        own.appendChild(selectedImg);
        if (!line.querySelector('img') && !line.textContent.trim()) line.remove();
        selectImage(selectedImg);
        markTextChanged();
    });
    $('imageRemove').addEventListener('click', () => {
        if (!selectedImg) return;
        selectedImg.remove();
        selectImage(null);
        markTextChanged();
    });
    $('insertImageBtn').addEventListener('click', () => {
        if (!noteById(state.currentNoteId)) return;
        $('imageFile').click();
    });
    $('imageFile').addEventListener('change', (e) => {
        if (e.target.files.length) insertImageFiles(e.target.files);
        e.target.value = '';
    });

    /* ---------------- voice notes ----------------
     * Stored inside the note text as
     *   <span data-voice="data:audio/...;base64,..." data-name="..." data-duration="12">🎤 name</span>
     * and shown in the editor as a small player chip.
     */

    const VOICE_SRC_RE = /^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/i;
    const VOICE_MAX_SECONDS = 10 * 60;
    const VOICE_MAX_CHARS = 4.5e6; // ~3.3 MB of audio; browser storage is small

    function formatSeconds(sec) {
        sec = Math.max(0, Math.round(Number(sec) || 0));
        return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
    }

    function voiceChipHtml(src, name, duration) {
        const span = document.createElement('span');
        span.setAttribute('data-voice', src);
        span.setAttribute('data-name', name || 'Voice note');
        span.setAttribute('data-duration', String(Math.round(duration || 0)));
        span.textContent = `🎤 ${name || 'Voice note'}`;
        return span.outerHTML;
    }

    // Turn the stored <span data-voice> elements into playable chips
    function decorateVoiceChips(root = editorEl) {
        root.querySelectorAll('span[data-voice]').forEach((chip) => {
            if (chip.classList.contains('voice-chip')) return;
            chip.classList.add('voice-chip');
            chip.contentEditable = 'false';
            const name = chip.getAttribute('data-name') || 'Voice note';
            chip.innerHTML = `<span class="voice-handle" title="Drag to move">⠿</span>` +
                `<button class="voice-play" type="button" title="Play">▶</button>` +
                `<span class="voice-name" title="Click to rename">🎤 ${escapeHtml(name)}</span>` +
                `<span class="voice-time">${formatSeconds(chip.getAttribute('data-duration'))}</span>` +
                `<button class="voice-remove" type="button" title="Remove voice note">✕</button>`;
        });
    }

    /* ---- playback ---- */
    let voiceAudio = null;
    let voicePlayingChip = null;

    function stopVoicePlayback() {
        if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; }
        if (voicePlayingChip) {
            const btn = voicePlayingChip.querySelector('.voice-play');
            if (btn) btn.textContent = '▶';
            const time = voicePlayingChip.querySelector('.voice-time');
            if (time) time.textContent = formatSeconds(voicePlayingChip.getAttribute('data-duration'));
            voicePlayingChip.classList.remove('playing');
        }
        voicePlayingChip = null;
    }

    function toggleVoicePlayback(chip) {
        if (voicePlayingChip === chip && voiceAudio) {
            if (voiceAudio.paused) { voiceAudio.play(); chip.querySelector('.voice-play').textContent = '⏸'; }
            else { voiceAudio.pause(); chip.querySelector('.voice-play').textContent = '▶'; }
            return;
        }
        stopVoicePlayback();
        voicePlayingChip = chip;
        voiceAudio = new Audio(chip.getAttribute('data-voice'));
        const total = Number(chip.getAttribute('data-duration')) || 0;
        const timeEl = chip.querySelector('.voice-time');
        voiceAudio.addEventListener('timeupdate', () => {
            if (voicePlayingChip !== chip) return;
            timeEl.textContent = `${formatSeconds(voiceAudio.currentTime)} / ${formatSeconds(total || voiceAudio.duration)}`;
        });
        voiceAudio.addEventListener('ended', stopVoicePlayback);
        voiceAudio.play().catch(() => { toast('This voice note cannot be played in this browser'); stopVoicePlayback(); });
        chip.querySelector('.voice-play').textContent = '⏸';
        chip.classList.add('playing');
    }

    // chip buttons must not move the text cursor
    editorEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.voice-chip')) e.preventDefault();
    });

    /* ---- move a voice note by dragging its handle (mouse and touch) ---- */
    let voiceDrag = null; // { chip, pointerId, range }
    const dropMarker = document.createElement('div');
    dropMarker.className = 'voice-drop-marker';
    document.body.appendChild(dropMarker);

    function caretRangeAt(x, y) {
        let range = null;
        if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
        else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
        }
        return range;
    }

    // Where would the chip land if dropped at (x, y)?
    function voiceDropRange(x, y, chip) {
        const over = document.elementFromPoint(x, y);
        const otherChip = over && over.closest && over.closest('.voice-chip');
        let range;
        if (otherChip && editorEl.contains(otherChip)) {
            // over a chip (also itself): drop before or after it
            if (otherChip === chip) return null;
            const r = otherChip.getBoundingClientRect();
            range = document.createRange();
            if (x < r.left + r.width / 2) range.setStartBefore(otherChip); else range.setStartAfter(otherChip);
            range.collapse(true);
            return range;
        }
        range = caretRangeAt(x, y);
        if (!range || !editorEl.contains(range.startContainer) || chip.contains(range.startContainer)) {
            const r = editorEl.getBoundingClientRect();
            if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
            range = document.createRange();               // below the last line: put it at the end
            range.selectNodeContents(editorEl);
            range.collapse(false);
        }
        return range;
    }

    function showDropMarker(range) {
        if (!range) { dropMarker.style.display = 'none'; return; }
        let rect = range.getClientRects()[0] || range.getBoundingClientRect();
        if (!rect || (!rect.height && !rect.width)) {
            const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            const child = node && node.childNodes[range.startOffset];
            const el = child && child.nodeType === 1 ? child : node;
            rect = el ? el.getBoundingClientRect() : null;
            if (rect && child && child.nodeType === 1) rect = { left: rect.left, top: rect.top, height: rect.height || 18 };
            else if (rect) rect = { left: rect.right, top: rect.top, height: Math.min(rect.height || 18, 24) };
        }
        if (!rect) { dropMarker.style.display = 'none'; return; }
        dropMarker.style.display = 'block';
        dropMarker.style.left = `${rect.left - 1}px`;
        dropMarker.style.top = `${rect.top}px`;
        dropMarker.style.height = `${Math.max(16, rect.height || 18)}px`;
    }

    editorEl.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.voice-handle');
        if (!handle) return;
        const chip = handle.closest('.voice-chip');
        if (!chip || !editorEl.contains(chip)) return;
        e.preventDefault();
        e.stopPropagation();
        try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        voiceDrag = { chip, handle, pointerId: e.pointerId, range: null };
        chip.classList.add('dragging');
        document.body.classList.add('voice-dragging');
    });

    editorEl.addEventListener('pointermove', (e) => {
        if (!voiceDrag || e.pointerId !== voiceDrag.pointerId) return;
        e.preventDefault();
        // scroll the page when you drag near the top/bottom edge
        const scroller = editorEl.closest('.content');
        if (scroller) {
            const r = scroller.getBoundingClientRect();
            if (e.clientY < r.top + 40) scroller.scrollTop -= 12;
            else if (e.clientY > r.bottom - 40) scroller.scrollTop += 12;
        }
        voiceDrag.range = voiceDropRange(e.clientX, e.clientY, voiceDrag.chip);
        showDropMarker(voiceDrag.range);
    });

    function endVoiceDrag(e, cancelled) {
        if (!voiceDrag || (e && e.pointerId !== voiceDrag.pointerId)) return;
        const { chip, range } = voiceDrag;
        voiceDrag = null;
        chip.classList.remove('dragging');
        document.body.classList.remove('voice-dragging');
        dropMarker.style.display = 'none';
        if (cancelled || !range || !editorEl.contains(range.startContainer)) return;
        // dropping right next to where it already is: nothing to do
        if ((range.startContainer === chip.parentNode &&
            (chip.parentNode.childNodes[range.startOffset] === chip || chip.parentNode.childNodes[range.startOffset - 1] === chip))) return;
        range.insertNode(chip);
        // keep a space on both sides so you can still type around it
        const nbsp = () => document.createTextNode('\u00a0');
        if (!chip.previousSibling || (chip.previousSibling.nodeType === 1 && chip.previousSibling.matches('.voice-chip'))) chip.before(nbsp());
        if (!chip.nextSibling || (chip.nextSibling.nodeType === 1 && chip.nextSibling.matches('.voice-chip'))) chip.after(nbsp());
        markTextChanged();
        flushEditor();
    }
    editorEl.addEventListener('pointerup', (e) => endVoiceDrag(e, false));
    editorEl.addEventListener('pointercancel', (e) => endVoiceDrag(e, true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && voiceDrag) endVoiceDrag(null, true); });

    async function handleVoiceChipClick(e) {
        const chip = e.target.closest('.voice-chip');
        if (!chip || !editorEl.contains(chip)) return false;
        e.preventDefault();
        if (e.target.closest('.voice-handle')) return true;
        if (e.target.closest('.voice-play')) { toggleVoicePlayback(chip); return true; }
        if (e.target.closest('.voice-remove')) {
            const ok = await askConfirm('Remove voice note', `Remove "${chip.getAttribute('data-name')}" from this note?`, 'Delete');
            if (!ok) return true;
            if (voicePlayingChip === chip) stopVoicePlayback();
            chip.remove();
            markTextChanged();
            return true;
        }
        if (e.target.closest('.voice-name')) {
            const name = await askText('Rename voice note', chip.getAttribute('data-name'), 'Rename');
            if (name === null || !name.trim() || !editorEl.contains(chip)) return true;
            chip.setAttribute('data-name', name.trim());
            chip.querySelector('.voice-name').textContent = `🎤 ${name.trim()}`;
            markTextChanged();
            return true;
        }
        if (e.target.closest('.voice-time')) toggleVoicePlayback(chip);
        return true;
    }

    /* ---- inserting ---- */
    let savedEditorRange = null;

    function saveEditorSelection() {
        const sel = window.getSelection();
        savedEditorRange = sel.rangeCount && editorEl.contains(sel.getRangeAt(0).commonAncestorContainer)
            ? sel.getRangeAt(0).cloneRange() : null;
    }

    function restoreEditorSelection() {
        editorEl.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        if (savedEditorRange) sel.addRange(savedEditorRange);
        else {
            const range = document.createRange();
            range.selectNodeContents(editorEl);
            range.collapse(false);
            sel.addRange(range);
        }
    }

    function insertVoiceChip(src, name, duration) {
        if (!noteById(state.currentNoteId)) return;
        if (src.length > VOICE_MAX_CHARS) {
            toast('This recording is too large to store. Keep voice notes under a few minutes.');
            return;
        }
        ensureCaretInEditor();
        const html = voiceChipHtml(src, name, duration) + '&nbsp;';
        if (!document.execCommand('insertHTML', false, html)) {
            const tmp = document.createElement('span');
            tmp.innerHTML = html;
            insertNodeAtCaret(tmp.firstChild);
        }
        decorateVoiceChips();
        textDirty = true;
        flushEditor();
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    function audioDuration(src) {
        return new Promise((resolve) => {
            const a = new Audio();
            const done = (v) => resolve(Number.isFinite(v) ? v : 0);
            a.addEventListener('loadedmetadata', () => done(a.duration));
            a.addEventListener('error', () => done(0));
            setTimeout(() => done(0), 4000);
            a.src = src;
        });
    }

    async function insertAudioFiles(files) {
        for (const file of [...files].filter((f) => f.type.startsWith('audio/'))) {
            try {
                const src = await blobToDataUrl(file);
                if (!VOICE_SRC_RE.test(src)) throw new Error('unsupported');
                insertVoiceChip(src, file.name.replace(/\.[^.]+$/, ''), await audioDuration(src));
            } catch (_) {
                toast(`Could not add audio: ${file.name}`);
            }
        }
    }

    /* ---- recorder ---- */
    const voice = { recorder: null, stream: null, chunks: [], startedAt: 0, timer: null,
        result: null, duration: 0, analyser: null, source: null, levelRaf: 0 };

    function pickVoiceMime() {
        if (!window.MediaRecorder) return '';
        return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac']
            .find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    }

    function setVoiceUi(stateName) {
        const rec = $('voiceRecBtn');
        rec.classList.toggle('recording', stateName === 'recording');
        rec.textContent = stateName === 'recording' ? '■' : '●';
        rec.title = stateName === 'recording' ? 'Stop recording' : 'Start recording';
        $('voiceInsert').disabled = stateName !== 'ready';
        $('voicePreview').hidden = stateName !== 'ready';
        $('voiceStatus').textContent = {
            idle: 'Press the red button to start recording',
            recording: 'Recording… press ■ to stop',
            ready: 'Listen back, give it a name and press Insert. Press ● to record again.',
            denied: 'No access to the microphone. Allow it in your browser settings.'
        }[stateName] || '';
    }

    function releaseVoiceStream() {
        cancelAnimationFrame(voice.levelRaf);
        $('voiceLevelBar').style.width = '0%';
        try { voice.source && voice.source.disconnect(); } catch (_) {}
        voice.source = null;
        voice.analyser = null;
        if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
        voice.stream = null;
    }

    function stopVoiceRecording(discard) {
        clearInterval(voice.timer);
        if (voice.recorder && voice.recorder.state !== 'inactive') {
            if (discard) voice.recorder.ondataavailable = null;
            if (discard) voice.recorder.onstop = null;
            voice.recorder.stop();
        }
        if (discard) voice.recorder = null;
        releaseVoiceStream();
    }

    function resetVoiceModal() {
        stopVoiceRecording(true);
        const preview = $('voicePreview');
        preview.pause();
        if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
        preview.removeAttribute('src');
        voice.result = null;
        voice.duration = 0;
        $('voiceTimer').textContent = '0:00';
        setVoiceUi('idle');
    }

    function openVoiceModal() {
        if (!noteById(state.currentNoteId)) return;
        saveEditorSelection();
        resetVoiceModal();
        $('voiceName').value = `Voice note ${formatTime(toLocalIso(new Date()))}`;
        if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            $('voiceStatus').textContent = 'Recording is not supported in this browser. You can still upload an audio file.';
            $('voiceRecBtn').disabled = true;
        } else {
            $('voiceRecBtn').disabled = false;
        }
        openModal('voiceModal');
    }

    async function startVoiceRecording() {
        resetVoiceModal();
        try {
            voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (err) {
            setVoiceUi('denied');
            return;
        }
        if (!$('voiceModal').classList.contains('active')) { releaseVoiceStream(); return; }
        const mimeType = pickVoiceMime();
        try {
            voice.recorder = new MediaRecorder(voice.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
        } catch (_) {
            voice.recorder = new MediaRecorder(voice.stream);
        }
        voice.chunks = [];
        voice.recorder.ondataavailable = (e) => { if (e.data && e.data.size) voice.chunks.push(e.data); };
        voice.recorder.onstop = async () => {
            const blob = new Blob(voice.chunks, { type: (voice.recorder && voice.recorder.mimeType) || mimeType || 'audio/webm' });
            voice.recorder = null;
            if (!blob.size) { setVoiceUi('idle'); return; }
            const src = await blobToDataUrl(blob);
            voice.result = src.replace(/^data:audio\/([\w.+-]+);codecs=[^;,]+/i, 'data:audio/$1');
            $('voicePreview').src = URL.createObjectURL(blob);
            setVoiceUi('ready');
        };
        voice.recorder.start(250);
        voice.startedAt = Date.now();
        setVoiceUi('recording');
        voice.timer = setInterval(() => {
            voice.duration = (Date.now() - voice.startedAt) / 1000;
            $('voiceTimer').textContent = formatSeconds(voice.duration);
            if (voice.duration >= VOICE_MAX_SECONDS) {
                toast('Maximum length reached (10 minutes)');
                stopVoiceRecording(false);
            }
        }, 200);

        // little level meter so you can see the microphone works
        try {
            const actx = getAudioContext();
            voice.analyser = actx.createAnalyser();
            voice.analyser.fftSize = 512;
            voice.source = actx.createMediaStreamSource(voice.stream);
            voice.source.connect(voice.analyser);
            const data = new Uint8Array(voice.analyser.fftSize);
            const tick = () => {
                if (!voice.analyser) return;
                voice.analyser.getByteTimeDomainData(data);
                let peak = 0;
                for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
                $('voiceLevelBar').style.width = `${Math.min(100, (peak / 128) * 160)}%`;
                voice.levelRaf = requestAnimationFrame(tick);
            };
            tick();
        } catch (_) { /* meter is optional */ }
    }

    $('insertVoiceBtn').addEventListener('click', openVoiceModal);
    $('voiceRecBtn').addEventListener('click', () => {
        if (voice.recorder && voice.recorder.state === 'recording') {
            voice.duration = (Date.now() - voice.startedAt) / 1000;
            stopVoiceRecording(false);
        } else {
            startVoiceRecording();
        }
    });
    $('voiceInsert').addEventListener('click', () => {
        if (!voice.result) return;
        const name = $('voiceName').value.trim() || 'Voice note';
        const { result, duration } = voice;
        $('voiceModal').classList.remove('active');
        resetVoiceModal();
        restoreEditorSelection();
        insertVoiceChip(result, name, duration);
    });
    const closeVoiceModal = () => { resetVoiceModal(); $('voiceModal').classList.remove('active'); };
    $('voiceCancel').addEventListener('click', closeVoiceModal);
    $('voiceClose').addEventListener('click', closeVoiceModal);
    $('voiceBackdrop').addEventListener('click', closeVoiceModal);
    $('voiceUploadBtn').addEventListener('click', () => $('voiceFile').click());
    $('voiceFile').addEventListener('change', async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!files.length) return;
        closeVoiceModal();
        restoreEditorSelection();
        await insertAudioFiles(files);
    });



    $('saveNoteBtn').addEventListener('click', () => {
        flushEditor();
        toast('Note saved');
    });

    $('deleteNoteBtn').addEventListener('click', () => deleteNote());


    $('newNoteBtn').addEventListener('click', () => newNote());

    /* ---------------- folders ---------------- */

    $('newFolderBtn').addEventListener('click', () => createFolder(null));

    async function createFolder(parentId) {
        const parent = parentId ? state.folders.find((f) => f.id === parentId) : null;
        const name = await askText(parent ? `New folder in "${parent.name}"` : 'New folder', 'New folder', 'Create');
        if (!name || !name.trim()) return;
        const pid = parent && state.folders.includes(parent) ? parent.id : null;
        const folder = { id: uid(), name: name.trim(), modifiedAt: new Date().toISOString(), parentId: pid,
            order: childFolders(pid).reduce((m, f) => Math.max(m, typeof f.order === 'number' ? f.order : 0), -1) + 1 };
        state.folders.push(folder);
        state.prefs.expandedFolders.push(folder.id);
        if (pid) expandFolderPath(pid);
        saveFolders();
        savePrefs();
        renderTree();
        refreshFolderSelect();
    }

    async function renameFolder(id) {
        const folder = state.folders.find((f) => f.id === id);
        if (!folder) return;
        const name = await askText('Rename folder', folder.name, 'Rename');
        if (!name || !name.trim() || !state.folders.includes(folder)) return;
        folder.name = name.trim();
        folder.modifiedAt = new Date().toISOString();
        saveFolders();
        renderTree();
        if (noteById(state.currentNoteId)?.folderId === id) {
            $('noteFolder').innerHTML = folderOptions(id);
        }
    }

    async function deleteFolder(id) {
        flushEditor();
        const folder = state.folders.find((f) => f.id === id);
        if (!folder) return;
        const parentId = parentOf(folder);
        const parent = parentId ? state.folders.find((f) => f.id === parentId) : null;
        const where = parent ? `"${parent.name}"` : '"No folder"';
        const hasSubs = childFolders(id).length > 0;
        const ok = await askConfirm('Delete folder', `Delete folder "${folder.name}"? The notes${hasSubs ? ' and folders' : ''} in it are kept and moved to ${where}.`, 'Delete');
        if (!ok || !state.folders.includes(folder)) return;
        const now = new Date().toISOString();
        childFolders(id).forEach((f) => { f.parentId = parentId; f.modifiedAt = now; });
        state.folders = state.folders.filter((f) => f.id !== id);
        state.deleted.folders[id] = now;
        state.notes.forEach((n) => { if (n.folderId === id) { n.folderId = parentId; n.modifiedAt = now; } });
        state.prefs.expandedFolders = state.prefs.expandedFolders.filter((f) => f !== id);
        if (state.currentFolderId === id) state.currentFolderId = parentId;
        saveFolders();
        saveNotes();
        savePrefs();
        renderTree();
        renderEditor();
    }

    /* ---------------- planning ---------------- */

    function applyScheduleCollapse() {
        const collapsed = state.prefs.scheduleCollapsed;
        $('scheduleBody').style.display = collapsed ? 'none' : 'flex';
        $('scheduleChevron').textContent = String.fromCharCode(collapsed ? 9656 : 9662);
    }

    $('scheduleHeader').addEventListener('click', (e) => {
        if (e.target.closest('#unscheduleBtn')) return;
        state.prefs.scheduleCollapsed = !state.prefs.scheduleCollapsed;
        savePrefs();
        applyScheduleCollapse();
    });

    function updateScheduleUi(note) {
        const body = $('scheduleBody');
        if (!note) {
            $('scheduleDate').value = '';
            $('scheduleTime').value = '';
            $('alarmEnabled').checked = false;
            $('snoozeMinutes').value = 5;
            $('snoozeMinutesLabel').textContent = '5';
            $('scheduleDate').disabled = true;
            $('scheduleTime').disabled = true;
            $('alarmEnabled').disabled = true;
            $('emailEnabled').checked = false;
            $('emailEnabled').disabled = true;
            $('emailToLabel').textContent = '';
            updateEditorRepeatUi(null);
            body.style.opacity = '0.5';
            applyScheduleCollapse();
            return;
        }

        $('scheduleDate').disabled = false;
        $('scheduleTime').disabled = false;
        $('alarmEnabled').disabled = false;
        body.style.opacity = '1';

        const d = parseDate(note.scheduledAt);
        $('scheduleDate').value = d
            ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
        $('scheduleTime').value = d
            ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '';
        $('alarmEnabled').checked = note.alarmEnabled;
        $('emailEnabled').disabled = false;
        $('emailEnabled').checked = note.emailEnabled;
        $('emailToLabel').textContent = note.emailEnabled && note.emailTo ? `→ ${note.emailTo}` : '';
        $('snoozeMinutes').value = note.alarmSnoozeMinutes;
        $('snoozeMinutesLabel').textContent = note.alarmSnoozeMinutes;
        updateEditorRepeatUi(note);
        applyScheduleCollapse();
    }

    /* ---- repeat settings + overview inside the note's Scheduled card ---- */

    $('edWeekdays').innerHTML = WEEKDAY_SHORT.map((letter, index) =>
        `<label class="weekday-chip" title="${WEEKDAY_FULL[index]}"><input type="checkbox" value="${index}" aria-label="${WEEKDAY_FULL[index]}"><span>${letter}</span></label>`
    ).join('');

    function availableRepeatModes(base) {
        const modes = ['none', 'weekly', 'monthlyDate', 'monthlyWeekday'];
        if (isLastWeekdayOfMonth(base)) modes.push('monthlyLastWeekday');
        modes.push('yearly');
        return modes;
    }

    function formatOccurrence(d, withYear) {
        return `${WEEKDAY_FULL[(d.getDay() + 6) % 7].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` +
            `${withYear || d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function updateEditorRepeatUi(note) {
        const select = $('edRepeatMode');
        const base = note ? parseDate(note.scheduledAt) : null;
        const ref = base || new Date();
        const mode = base ? repeatModeOf(note) : 'none';
        const weekdays = note && mode === 'weekly' ? note.repeatWeekdays : [];
        const modes = availableRepeatModes(ref);
        if (!modes.includes(mode)) modes.splice(modes.length - 1, 0, mode);
        select.innerHTML = modes.map((m) => `<option value="${m}">${escapeHtml(repeatLabel(m, ref, weekdays))}</option>`).join('');
        select.value = mode;
        select.disabled = !base;
        select.title = base ? '' : 'Pick a date first';
        $('edWeekdays').querySelectorAll('input').forEach((input) => {
            input.checked = weekdays.includes(Number(input.value));
        });
        $('edWeeklyOptions').hidden = mode !== 'weekly';
        $('edRepeatEndRow').hidden = mode === 'none';
        $('edRepeatEnd').value = (note && note.repeatEndDate) || '';
        $('edRepeatEnd').min = base ? dayKey(base) : '';

        const skipped = note && mode !== 'none' ? (note.skipDates || []).slice().sort() : [];
        $('edSkippedRow').hidden = !skipped.length;
        $('edSkipped').innerHTML = skipped.map((key) => {
            const d = keyToDate(key);
            return `<span class="skipped-chip">${WEEKDAY_FULL[(d.getDay() + 6) % 7].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` +
                `<button type="button" class="skipped-remove" data-key="${key}" title="Bring this day back">✕</button></span>`;
        }).join('');

        $('scheduleSummary').innerHTML = scheduleSummaryHtml(note);
        renderNoteColors(note);
    }

    // in the order of the light spectrum, then pink, then the greys
    const NOTE_COLORS = ['#fca5a5', '#e11d1d', '#f97316', '#facc15', '#86efac', '#22c55e', '#14b8a6', '#22d3ee',
        '#3b82f6', '#1e3a8a', '#8b5cf6', '#d946ef', '#f472b6', '#4b5563', '#d1d5db'];

    function renderNoteColors(note) {
        renderColorPicker($('noteColors'), note ? note.color : '', !!note, 'noteColorCustom');
    }

    function renderColorPicker(host, current, enabled, customId) {
        const note = enabled;
        const custom = current && !NOTE_COLORS.includes(current);
        host.innerHTML =
            `<button type="button" class="note-color auto${!current ? ' selected' : ''}" data-color="" title="Default colour" ${note ? '' : 'disabled'}></button>` +
            NOTE_COLORS.map((c) => {
                const name = (PALETTE_NAMED.find(([pc]) => pc === c) || [, c])[1];
                return `<button type="button" class="note-color${c === current ? ' selected' : ''}" data-color="${c}" style="background:${c}" title="${name}" ${note ? '' : 'disabled'}></button>`;
            }).join('') +
            `<label class="note-color custom${custom ? ' selected' : ''}" title="Custom colour" style="${custom ? `background:${current}` : ''}">` +
            `<input type="color" id="${customId}" value="${current || '#8b5cf6'}" ${note ? '' : 'disabled'}></label>`;
    }

    function setNoteColor(color) {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.color = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '';
        touch(note);
        renderNoteColors(note);
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    $('noteColors').addEventListener('click', (e) => {
        const btn = e.target.closest('button.note-color');
        if (btn) setNoteColor(btn.dataset.color);
    });
    $('noteColors').addEventListener('change', (e) => {
        if (e.target.id === 'noteColorCustom') setNoteColor(e.target.value);
    });

    // "When will this note show up?" overview
    function scheduleSummaryHtml(note) {
        if (!note) return '';
        const base = parseDate(note.scheduledAt);
        if (!base) return '<div class="summary-line dim">Not in the calendar yet. Pick a date to schedule this note.</div>';
        const alarm = (note.alarmEnabled
            ? '🔔 Alarm on (rings every minute until you stop it)'
            : '🔕 No alarm') + (note.emailEnabled && note.emailTo ? ` · ✉️ Email to ${escapeHtml(note.emailTo)}` : '');
        if (!isRecurring(note)) {
            const passed = base.getTime() < Date.now();
            return `<div class="summary-line">📅 ${escapeHtml(formatOccurrence(base, true))}${passed ? ' <span class="dim">(passed)</span>' : ''}</div>` +
                `<div class="summary-line dim">${alarm}</div>`;
        }
        const next = [];
        let t = Date.now();
        for (let i = 0; i < 4; i++) {
            const occ = nextOccurrence(note, t);
            if (!occ) break;
            next.push(occ);
            t = occ.getTime();
        }
        const until = note.repeatEndDate ? ` until ${formatDateTime(note.repeatEndDate + 'T00:00:00').slice(0, -6)}` : ', no end date';
        return `<div class="summary-line">↻ ${escapeHtml(repeatLabel(repeatModeOf(note), base, note.repeatWeekdays))}${escapeHtml(until)}</div>` +
            `<div class="summary-line dim">Starts ${escapeHtml(formatOccurrence(base, true))} · ${alarm}</div>` +
            (next.length
                ? `<div class="summary-line">Next: ${next.map((d) => `<span class="next-chip">${escapeHtml(formatOccurrence(d))}</span>`).join(' ')}</div>`
                : '<div class="summary-line dim">No upcoming dates (the repeat has ended).</div>');
    }

    $('edRepeatMode').addEventListener('change', scheduleChanged);
    $('edWeekdays').addEventListener('change', scheduleChanged);
    $('edRepeatEnd').addEventListener('change', scheduleChanged);
    $('edSkipped').addEventListener('click', (e) => {
        const btn = e.target.closest('.skipped-remove');
        const note = noteById(state.currentNoteId);
        if (!btn || !note) return;
        note.skipDates = (note.skipDates || []).filter((k) => k !== btn.dataset.key);
        resetAlarmRuntime(note);
        touch(note);
        updateScheduleUi(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });

    function scheduleChanged() {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const date = $('scheduleDate').value;
        const time = $('scheduleTime').value || '09:00:00'; // only a date picked: default to 9 in the morning

        if (!date) {
            note.scheduledAt = null;
        } else {
            const parts = time.split(':');
            const dt = new Date(`${date}T${pad(parts[0] || 0)}:${pad(parts[1] || 0)}:${pad(parts[2] || 0)}`);
            note.scheduledAt = isNaN(dt.getTime()) ? null : toLocalIso(dt);
        }

        note.alarmEnabled = $('alarmEnabled').checked;
        note.alarmSnoozeMinutes = Number($('snoozeMinutes').value);

        const base = parseDate(note.scheduledAt);
        let mode = base ? ($('edRepeatMode').value || 'none') : 'none';
        if (!REPEAT_MODES.includes(mode)) mode = 'none';
        if (mode === 'monthlyLastWeekday' && base && !isLastWeekdayOfMonth(base)) mode = 'monthlyWeekday';
        let weekdays = [...$('edWeekdays').querySelectorAll('input:checked')].map((el) => Number(el.value));
        if (mode === 'weekly' && !weekdays.length) weekdays = [(base.getDay() + 6) % 7];
        let end = mode === 'none' ? '' : $('edRepeatEnd').value;
        if (end && base && end < dayKey(base)) {
            toast('End date is before the start date');
            end = '';
        }
        note.repeatMode = mode;
        note.repeatWeekdays = mode === 'weekly' ? weekdays : [];
        note.repeatEndDate = end;

        resetAlarmRuntime(note);
        touch(note);
        updateScheduleUi(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    $('scheduleDate').addEventListener('change', scheduleChanged);
    $('scheduleTime').addEventListener('change', scheduleChanged);
    $('alarmEnabled').addEventListener('change', scheduleChanged);

    /* ---- email notification (sent by the GitHub Action, see EMAIL-SETUP.md) ---- */
    const EMAIL_KEY = 'remindate.emailAddress.v1';
    const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
    const defaultEmail = () => localStorage.getItem(EMAIL_KEY) || '';

    // Who is the email popup for? The open note, or the "Schedule note" window.
    let emailTarget = null;

    function editorEmailTarget() {
        const note = noteById(state.currentNoteId);
        if (!note) return null;
        return {
            note,
            address: () => note.emailTo,
            enabled: () => note.emailEnabled,
            save(address) {
                note.emailTo = address;
                note.emailEnabled = true;
                touch(note);
                updateScheduleUi(note);
                renderTree();
                if (state.prefs.activeTab === 'calendar') renderCalendar();
            },
            off() {
                note.emailEnabled = false;
                touch(note);
                updateScheduleUi(note);
                if (state.prefs.activeTab === 'calendar') renderCalendar();
            },
            sync() { $('emailEnabled').checked = !!(noteById(note.id) || {}).emailEnabled; }
        };
    }

    function openEmailModal(target) {
        emailTarget = target && target.address ? target : editorEmailTarget();
        if (!emailTarget) return;
        const note = emailTarget.note;
        $('emailAddress').value = emailTarget.address() || defaultEmail();
        $('emailTurnOff').hidden = !emailTarget.enabled();
        const sync = githubConfigured();
        const notes = [];
        if (!emailTarget.isPlan && !note.scheduledAt) notes.push('This note has no date yet: pick a date and time in the Scheduled card.');
        if (!sync) notes.push('Emails are sent via GitHub using your synced notes, so turn on <b>GitHub Sync</b> (with automatic sync).');
        else if (!githubConfig.autoSync) notes.push('Turn on <b>automatic sync</b> in GitHub Sync settings, or press “Sync now” after changes, so GitHub knows about this note.');
        notes.push('Emails are sent by the “Remindate email reminders” Google Apps Script, which checks your synced notes every minute (see <b>EMAIL-SETUP.md</b>).');
        $('emailStatus').innerHTML = notes.map((t) => `<div>• ${t}</div>`).join('');
        openModal('emailModal');
        setTimeout(() => $('emailAddress').focus(), 30);
    }

    function closeEmailModal() {
        $('emailModal').classList.remove('active');
        if (emailTarget) emailTarget.sync();
        emailTarget = null;
    }

    function saveEmailSettings() {
        if (!emailTarget) return;
        const address = $('emailAddress').value.trim();
        if (!EMAIL_RE.test(address)) {
            toast('Please enter a valid email address');
            $('emailAddress').focus();
            return;
        }
        if ($('emailRemember').checked) localStorage.setItem(EMAIL_KEY, address);
        emailTarget.save(address);
        closeEmailModal();
        toast(`Email notification on → ${address}`);
    }

    $('emailEnabled').addEventListener('change', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        if ($('emailEnabled').checked) {
            const address = note.emailTo || defaultEmail();
            if (!address) { openEmailModal(); return; }   // ask for the address first
            note.emailTo = address;
            note.emailEnabled = true;
        } else {
            note.emailEnabled = false;
        }
        touch(note);
        updateScheduleUi(note);
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });
    $('emailSettingsLink').addEventListener('click', () => openEmailModal());

    /* ---- "How to setup: Google Apps Script Emails" ---- */
    let emailScriptCode = null;

    // The script lives next to the app (scripts/email-reminders.gs). The repo it reads
    // is filled in from your GitHub Sync settings, so the copied code is ready to use.
    async function loadEmailScriptCode() {
        if (emailScriptCode === null) {
            try {
                const res = await fetch('scripts/email-reminders.gs', { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                emailScriptCode = await res.text();
            } catch (_) {
                emailScriptCode = '';
            }
        }
        let code = emailScriptCode;
        if (code && githubConfigured()) {
            code = code
                .replace(/dataRepo: '[^']*'/, `dataRepo: '${githubConfig.owner}/${githubConfig.repo}'`)
                .replace(/dataPath: '[^']*'/, `dataPath: '${githubConfig.path || 'remindate.json'}'`)
                .replace(/appUrl: '[^']*'/, `appUrl: '${location.protocol.startsWith('http') ? location.href.split(/[?#]/)[0] : 'https://vharixce.github.io/Remindate/'}'`);
        }
        return code;
    }

    async function openEmailHelp() {
        $('emailHelpRepo').innerHTML = githubConfigured()
            ? `✔ GitHub Sync is set up: <code>${escapeHtml(githubConfig.owner)}/${escapeHtml(githubConfig.repo)}/${escapeHtml(githubConfig.path || 'remindate.json')}</code>. The code you copy below already uses this repo.`
            : '⚠ GitHub Sync is not set up on this device yet. Do that first, then come back here, so the copied code uses your repo.';
        $('emailHelpCopyStatus').textContent = '';
        $('emailHelpCode').hidden = true;
        $('emailHelpToggleCode').textContent = 'Show code';
        openModal('emailHelpModal');
        const code = await loadEmailScriptCode();
        $('emailHelpCode').value = code || '// Could not load the code here.\n// Open scripts/email-reminders.gs in the Remindate folder and copy everything in it.';
        $('emailHelpCopy').disabled = !code;
    }

    async function copyEmailScriptCode() {
        const code = await loadEmailScriptCode();
        if (!code) return;
        let ok = false;
        try {
            await navigator.clipboard.writeText(code);
            ok = true;
        } catch (_) {
            // older browsers / no clipboard permission: copy via a selected text box
            const box = $('emailHelpCode');
            const wasHidden = box.hidden;
            box.hidden = false;
            box.value = code;
            box.focus();
            box.select();
            try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
            box.hidden = wasHidden;
        }
        $('emailHelpCopyStatus').textContent = ok ? '✔ Copied! Paste it in the Apps Script editor.' : 'Select the code below and copy it with Ctrl+C.';
        if (!ok) { $('emailHelpCode').hidden = false; $('emailHelpToggleCode').textContent = 'Hide code'; }
    }

    $('emailHelpBtn').addEventListener('click', openEmailHelp);
    $('emailHelpCopy').addEventListener('click', copyEmailScriptCode);
    $('emailHelpToggleCode').addEventListener('click', () => {
        const box = $('emailHelpCode');
        box.hidden = !box.hidden;
        $('emailHelpToggleCode').textContent = box.hidden ? 'Show code' : 'Hide code';
    });
    const closeEmailHelp = () => $('emailHelpModal').classList.remove('active');
    $('emailHelpClose').addEventListener('click', closeEmailHelp);
    $('emailHelpDone').addEventListener('click', closeEmailHelp);
    $('emailHelpBackdrop').addEventListener('click', closeEmailHelp);
    $('emailSave').addEventListener('click', saveEmailSettings);
    $('emailAddress').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveEmailSettings(); } });
    $('emailCancel').addEventListener('click', closeEmailModal);
    $('emailClose').addEventListener('click', closeEmailModal);
    $('emailBackdrop').addEventListener('click', closeEmailModal);
    $('emailTurnOff').addEventListener('click', () => {
        if (emailTarget) emailTarget.off();
        closeEmailModal();
    });
    $('snoozeMinutes').addEventListener('input', () => {
        $('snoozeMinutesLabel').textContent = $('snoozeMinutes').value;
    });
    $('snoozeMinutes').addEventListener('change', scheduleChanged);

    $('unscheduleBtn').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.scheduledAt = null;
        note.alarmEnabled = false;
        note.emailEnabled = false;
        note.repeatWeekdays = [];
        note.repeatMode = 'none';
        note.repeatEndDate = '';
        note.skipDates = [];
        resetAlarmRuntime(note);
        touch(note);
        updateScheduleUi(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });

    /* ---------------- tabs ---------------- */

    function setTab(tab) {
        flushEditor();
        if (tab !== 'note' && unlockedNoteId) { unlockedNoteId = null; renderEditor(); }
        state.prefs.activeTab = tab;
        savePrefs();
        $('tabNote').classList.toggle('active', tab === 'note');
        $('tabCalendar').classList.toggle('active', tab === 'calendar');
        $('viewNote').style.display = tab === 'note' ? 'flex' : 'none';
        $('viewCalendar').style.display = tab === 'calendar' ? 'flex' : 'none';
        applyCalendarMode(); // the calendar, or the world clocks
    }

    $('tabNote').addEventListener('click', () => setTab('note'));
    $('tabCalendar').addEventListener('click', () => setTab('calendar'));

    /* ---------------- calendar ---------------- */

    $('calendarWeekdays').innerHTML = WEEKDAYS
        .map((d) => `<div class="calendar-weekday">${d}</div>`).join('');

    function renderCalendar() {
        if (state.prefs.calendarMode === 'clock') return; // the world clocks are showing
        const cursor = state.calendarCursor;
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        $('calendarMonth').textContent = `${MONTHS[month]} ${year}`;

        const grid = $('calendarGrid');
        grid.innerHTML = '';

        const first = new Date(year, month, 1);
        const startOffset = (first.getDay() + 6) % 7;
        const start = new Date(year, month, 1 - startOffset);
        const today = new Date();

        for (let i = 0; i < 42; i++) {
            const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const inMonth = day.getMonth() === month;
            const scheduled = notesOnDay(day);
            const isToday = sameDay(day, today);
            const isSelected = sameDay(day, state.calendarDay);

            const cell = document.createElement('div');
            cell.className = 'calendar-day' + (inMonth ? '' : ' other-month') +
                (isToday ? ' today' : '') + (isSelected ? ' selected' : '');
            cell.dataset.date = dayKey(day);
            const holidays = holidaysOn(day);
            const items = [
                ...holidays.map((h) => `<div class="holiday-chip" title="${escapeHtml(holidayTitle(h))}">${escapeHtml(h.name)}</div>`),
                ...scheduled.map((n) =>
                    `<div class="calendar-chip${isRecurring(n) ? ' recurring' : ''}" draggable="true" data-note-id="${n.id}" style="${noteChipStyle(n)}" title="${escapeHtml(n.title.trim() || 'Untitled')} – click to open, drag to another day">${escapeHtml(n.title.trim() || 'Untitled')}</div>`)
            ];
            if (holidays.length) cell.classList.add('has-holiday');
            if (items.length > 2) cell.classList.add('has-more'); // phones: dot top-right for "more than 2"
            cell.innerHTML = `<div class="calendar-day-number">${day.getDate()}</div>` +
                (items.length
                    ? `<div class="calendar-chips">${items.slice(0, 2).join('')}${items.length > 2 ? `<div class="calendar-more">+${items.length - 2} more</div>` : ''}</div>${scheduled.length ? '<div class="calendar-dot"></div>' : ''}`
                    : '');
            grid.appendChild(cell);
        }

        renderCalendarDay();
    }

    // readable text on a coloured chip
    function textColorFor(hex) {
        const v = parseInt(hex.slice(1), 16);
        const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
        return lum > 0.6 ? '#111827' : '#ffffff';
    }

    function noteChipStyle(note) {
        return note.color ? `background:${note.color};color:${textColorFor(note.color)}` : '';
    }

    function notesOnDay(day) {
        return state.notes
            .filter((n) => occurrenceOn(n, day))
            .sort((a, b) => occurrenceOn(a, day) - occurrenceOn(b, day));
    }

    function renderCalendarDay() {
        const host = $('calendarDayNotes');
        const day = state.calendarDay;
        if (!day) {
            host.innerHTML = '<div class="calendar-hint">Click a day to view scheduled notes.</div>';
            return;
        }
        const notes = notesOnDay(day);
        const holidays = holidaysOn(day);
        const label = `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
        const holidayHtml = holidays.map((h) => `<div class="holiday-item">
                    <div class="holiday-name">${escapeHtml(h.name)}${h.locals.length ? ` <span class="holiday-local">${escapeHtml(h.locals.join(' / '))}</span>` : ''}</div>
                    <div class="calendar-note-time">${escapeHtml(h.sets.join(', '))} ${h.obs ? 'observance (not a day off)' : 'holiday'}</div>
                </div>`).join('');
        host.innerHTML = `<div class="calendar-day-head"><div class="calendar-day-title">${label}</div>` +
            `<div class="calendar-day-buttons">` +
            `<button class="btn calendar-pick-note" id="calendarPickNote" type="button" title="Put an existing note on this day">Add existing</button>` +
            `<button class="btn btn-primary calendar-add-note" id="calendarAddNote" type="button" title="New note on this day">+ Note</button></div></div>` +
            holidayHtml + (notes.length
            ? notes.map((n) => `<div class="calendar-note-item${n.color ? ' colored' : ''}" draggable="true" data-note-id="${n.id}" style="${n.color ? `border-left-color:${n.color}` : ''}" title="Click to open – drag to another day">
                    <button class="more-btn cal-more" data-note-id="${n.id}" type="button" title="More" aria-label="More">⋯</button>
                    <span class="item-actions">
                        <button class="folder-action-btn note-unschedule" data-note-id="${n.id}" title="Remove this note/alarm from this date">Remove from date</button>
                        <button class="folder-action-btn note-rename" data-note-id="${n.id}" title="Rename note">Rename</button>
                        <button class="folder-action-btn folder-delete note-delete" data-note-id="${n.id}" title="Delete note">Delete</button>
                    </span>
                    <div>${escapeHtml(n.title.trim() || 'Untitled')}</div>
                    <div class="calendar-note-time">${formatTime(n.scheduledAt)}${n.alarmEnabled ? ' · alarm' : ''}${n.emailEnabled ? ' · email' : ''}${isRecurring(n) ? ' · ' + repeatSummary(n) : ''}</div>
                </div>`).join('')
            : (holidays.length ? '' : '<div class="calendar-hint">No notes scheduled for this day.</div>'));
    }
    /* ---------------- holidays (calculated in the app, no internet needed) ---------------- */

    const HOLIDAY_SETS = [
        { code: 'INT', label: 'International', short: 'Intl' },
        { code: 'SKY', label: 'Seasons & clock changes', short: 'Seasons' },
        { code: 'MOON', label: 'Moon phases & eclipses', short: 'Moon' },
        { code: 'GB', label: 'British', short: 'UK' },
        { code: 'NL', label: 'Dutch', short: 'NL' },
        { code: 'FR', label: 'French', short: 'FR' },
        { code: 'SE', label: 'Swedish', short: 'SE' },
        { code: 'DE', label: 'German', short: 'DE' },
        { code: 'JP', label: 'Japanese', short: 'JP' },
        { code: 'US', label: 'American', short: 'US' },
        { code: 'CN', label: 'Chinese', short: 'CN' },
        { code: 'IN', label: 'Indian', short: 'IN' }
    ];

    /* ---------------- astronomy (all calculated, no internet needed) ----------------
     * Moon phases: Meeus, Astronomical Algorithms ch. 49 (accurate to about a minute)
     * Eclipses:    Meeus ch. 54 (which full/new moons give an eclipse, and what kind)
     * Sun rise/set: the standard sunrise equation (accurate to a minute or two) */
    const DEG = Math.PI / 180;
    const sinD = (x) => Math.sin(x * DEG), cosD = (x) => Math.cos(x * DEG);
    const jdToDate = (jde) => new Date((jde - 2440587.5) * 86400000 - 69000); // TT -> real time (~69 s)

    const PHASE_ARGS = (M, Mp, F, O) => [
        Mp, M, 2 * Mp, 2 * F, Mp - M, Mp + M, 2 * M, Mp - 2 * F, Mp + 2 * F, 2 * Mp + M, 3 * Mp, M + 2 * F, M - 2 * F,
        2 * Mp - M, O, Mp + 2 * M, 2 * Mp - 2 * F, 3 * M, Mp + M - 2 * F, 2 * Mp + 2 * F, Mp + M + 2 * F, Mp - M + 2 * F,
        Mp - M - 2 * F, 3 * Mp + M, 4 * Mp
    ];
    // [coefficient, power of E] for new moon / full moon
    const NEW_TERMS = [[-0.40720, 0], [0.17241, 1], [0.01608, 0], [0.01039, 0], [0.00739, 1], [-0.00514, 1], [0.00208, 2],
        [-0.00111, 0], [-0.00057, 0], [0.00056, 1], [-0.00042, 0], [0.00042, 1], [0.00038, 1], [-0.00024, 1], [-0.00017, 0],
        [-0.00007, 0], [0.00004, 0], [0.00004, 0], [0.00003, 0], [0.00003, 0], [-0.00003, 0], [0.00003, 0], [-0.00002, 0],
        [-0.00002, 0], [0.00002, 0]];
    const FULL_TERMS = [[-0.40614, 0], [0.17302, 1], [0.01614, 0], [0.01043, 0], [0.00734, 1], [-0.00515, 1], [0.00209, 2],
        [-0.00111, 0], [-0.00057, 0], [0.00056, 1], [-0.00042, 0], [0.00042, 1], [0.00038, 1], [-0.00024, 1], [-0.00017, 0],
        [-0.00007, 0], [0.00004, 0], [0.00004, 0], [0.00003, 0], [0.00003, 0], [-0.00003, 0], [0.00003, 0], [-0.00002, 0],
        [-0.00002, 0], [0.00002, 0]];

    function lunation(k) { // k whole = new moon, k + 0.5 = full moon
        const T = k / 1236.85;
        const full = Math.abs(k % 1) > 0.25;
        const E = 1 - 0.002516 * T - 0.0000074 * T * T;
        const M = 2.5534 + 29.10535670 * k - 0.0000014 * T * T - 0.00000011 * T ** 3;
        const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
        const F = 160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
        const O = 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3;
        const jde0 = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4;
        const args = PHASE_ARGS(M, Mp, F, O);
        let jde = jde0;
        (full ? FULL_TERMS : NEW_TERMS).forEach(([c, e], i) => { jde += c * E ** e * sinD(args[i]); });
        // planetary corrections (largest ones)
        const A = [299.77 + 0.107408 * k - 0.009173 * T * T, 251.88 + 0.016321 * k, 251.83 + 26.651886 * k,
            349.42 + 36.412478 * k, 84.66 + 18.206239 * k, 141.74 + 53.303771 * k, 207.14 + 2.453732 * k];
        [0.000325, 0.000165, 0.000164, 0.000126, 0.000110, 0.000062, 0.000060].forEach((c, i) => { jde += c * sinD(A[i]); });
        return { jde, full, T, E, M, Mp, F, O };
    }

    // Is there an eclipse at this new/full moon? (Meeus ch. 54)
    function eclipseAt(k) {
        const { full, T, E, M, Mp, F, O } = lunation(k);
        if (Math.abs(sinD(F)) > 0.36) return null;
        const F1 = F - 0.02665 * sinD(O);
        const A1 = 299.77 + 0.107408 * k - 0.009173 * T * T;
        let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4;
        jde += (full ? -0.4065 : -0.4075) * sinD(Mp) + (full ? 0.1727 : 0.1721) * E * sinD(M)
            + 0.0161 * sinD(2 * Mp) - 0.0097 * sinD(2 * F1) + 0.0073 * E * sinD(Mp - M) - 0.0050 * E * sinD(Mp + M)
            - 0.0023 * sinD(Mp - 2 * F1) + 0.0021 * E * sinD(2 * M) + 0.0012 * sinD(Mp + 2 * F1) + 0.0006 * E * sinD(2 * Mp + M)
            - 0.0004 * sinD(3 * Mp) - 0.0003 * E * sinD(M + 2 * F1) + 0.0003 * sinD(A1) - 0.0002 * E * sinD(M - 2 * F1)
            - 0.0002 * E * sinD(2 * Mp - M) - 0.0002 * sinD(O);
        const P = 0.2070 * E * sinD(M) + 0.0024 * E * sinD(2 * M) - 0.0392 * sinD(Mp) + 0.0116 * sinD(2 * Mp)
            - 0.0073 * E * sinD(Mp + M) + 0.0067 * E * sinD(Mp - M) + 0.0118 * sinD(2 * F1);
        const Q = 5.2207 - 0.0048 * E * cosD(M) + 0.0020 * E * cosD(2 * M) - 0.3299 * cosD(Mp)
            - 0.0060 * E * cosD(Mp + M) + 0.0041 * E * cosD(Mp - M);
        const W = Math.abs(cosD(F1));
        const gamma = (P * cosD(F1) + Q * sinD(F1)) * (1 - 0.0048 * W);
        const u = 0.0059 + 0.0046 * E * cosD(M) - 0.0182 * cosD(Mp) + 0.0004 * cosD(2 * Mp) - 0.0005 * cosD(M + Mp);
        const g = Math.abs(gamma);
        let kind = null;
        if (!full) {
            if (g > 1.5433 + u) return null;
            if (g < 0.9972) kind = u < 0 ? 'Total solar eclipse' : u > 0.0047 ? 'Annular solar eclipse'
                : (u < 0.00464 * Math.sqrt(1 - gamma * gamma) ? 'Hybrid solar eclipse' : 'Annular solar eclipse');
            else kind = g < 0.9972 + Math.abs(u) ? (u < 0 ? 'Total solar eclipse' : 'Annular solar eclipse') : 'Partial solar eclipse';
        } else {
            const pen = (1.5573 + u - g) / 0.5450;
            const umb = (1.0128 - u - g) / 0.5450;
            if (pen < 0) return null;
            kind = umb < 0 ? 'Penumbral lunar eclipse' : umb >= 1 ? 'Total lunar eclipse' : 'Partial lunar eclipse';
        }
        return { kind, date: jdToDate(jde), solar: !full };
    }

    // All new moons, full moons and eclipses whose moment falls in year y (in this device's time zone)
    function moonEvents(y) {
        const out = [];
        const k0 = Math.floor((y - 2000) * 12.3685) - 2;
        for (let k = k0; k < k0 + 16; k++) {
            [k, k + 0.5].forEach((kk) => {
                const { jde, full } = lunation(kk);
                const date = jdToDate(jde);
                if (date.getFullYear() === y) out.push({ type: full ? 'full' : 'new', date });
                const ecl = eclipseAt(kk);
                if (ecl && ecl.date.getFullYear() === y) out.push({ type: 'eclipse', ...ecl });
            });
        }
        return out.sort((a, b) => a.date - b.date);
    }

    // Sunrise and sunset for a place on a calendar day (y, m 1-12, d); null = sun stays up / down
    function sunTimes(lat, lon, y, m, d) {
        const n = Math.round((Date.UTC(y, m - 1, d, 12) - Date.UTC(2000, 0, 1, 12)) / 86400000);
        const Js = n - lon / 360;
        const M = (357.5291 + 0.98560028 * Js) % 360;
        const C = 1.9148 * sinD(M) + 0.0200 * sinD(2 * M) + 0.0003 * sinD(3 * M);
        const lambda = (M + C + 180 + 102.9372) % 360;
        const transit = 2451545.0 + Js + 0.0053 * sinD(M) - 0.0069 * sinD(2 * lambda);
        const sinDec = sinD(lambda) * sinD(23.4397);
        const cosDec = Math.cos(Math.asin(sinDec));
        const cosW = (sinD(-0.833) - sinD(lat) * sinDec) / (cosD(lat) * cosDec);
        const toDate = (jd) => new Date((jd - 2440587.5) * 86400000);
        if (cosW > 1) return { polar: 'night', noon: toDate(transit) };
        if (cosW < -1) return { polar: 'day', noon: toDate(transit) };
        const w = Math.acos(cosW) / DEG;
        return { rise: toDate(transit - w / 360), set: toDate(transit + w / 360), noon: toDate(transit) };
    }

    // Easter Sunday (Gregorian calendar, "anonymous" algorithm)
    function easterSunday(y) {
        const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
        const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(y, month - 1, day);
    }

    const D = (y, m, d) => new Date(y, m - 1, d);
    const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
    // n-th given weekday (0 = Sunday) of a month
    const nthWeekday = (y, m, wd, n) => { const first = D(y, m, 1); return D(y, m, 1 + ((wd - first.getDay() + 7) % 7) + (n - 1) * 7); };
    const lastWeekday = (y, m, wd) => { const last = D(y, m + 1, 0); return addDays(last, -((last.getDay() - wd + 7) % 7)); };
    // first given weekday on or after a date
    const weekdayFrom = (date, wd) => addDays(date, (wd - date.getDay() + 7) % 7);

    // Equinoxes and solstices (Meeus, Astronomical Algorithms ch. 27; accurate to about a minute)
    const SEASON_TERMS = [
        [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
        [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
        [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
        [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
        [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
        [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]
    ];
    function seasonMoment(y, which) { // which: 0 March, 1 June, 2 September, 3 December
        const Y = (y - 2000) / 1000;
        const c = [
            [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
            [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
            [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
            [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
        ][which];
        const jde0 = c[0] + c[1] * Y + c[2] * Y * Y + c[3] * Y ** 3 + c[4] * Y ** 4;
        const T = (jde0 - 2451545.0) / 36525;
        const rad = Math.PI / 180;
        const W = (35999.373 * T - 2.47) * rad;
        const dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
        const S = SEASON_TERMS.reduce((sum, [A, B, C]) => sum + A * Math.cos((B + C * T) * rad), 0);
        const jde = jde0 + 0.00001 * S / dl;
        // Julian day (Terrestrial Time) -> real time (about 69 s difference)
        return new Date((jde - 2440587.5) * 86400000 - 69000);
    }

    // Days the clocks change, read from this device's own time zone
    function clockChanges(y) {
        const out = [];
        for (let d = D(y, 1, 1); d.getFullYear() === y; d = addDays(d, 1)) {
            const before = d.getTimezoneOffset();
            const after = addDays(d, 1).getTimezoneOffset();
            if (before !== after) out.push({ date: d, forward: after < before, minutes: Math.abs(after - before) });
        }
        return out;
    }

    /* ---------------- Indian (Hindu) festivals: calculated like a panchang ----------------
     * tithi (lunar day) = angle between Moon and Sun / 12°; lunar month (amanta) from the
     * sidereal sign of the Sun at the new moon that starts it. Reference place: New Delhi (IST). */
    const DELHI = { lat: 28.61, lon: 77.21 };
    const MOON_TERMS = [ // D, M, M', F, coefficient (1e-6 degree)
        [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618],
        [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066],
        [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
        [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980],
        [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
        [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
        [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689],
        [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390], [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
        [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
        [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110], [3, 0, -1, 0, -892],
        [2, 1, 1, 0, -810], [4, -1, -2, 0, 759], [0, 2, -1, 0, -713], [2, 2, -1, 0, -700]
    ];
    const norm360 = (a) => ((a % 360) + 360) % 360;
    const centuries = (date) => (date.getTime() / 86400000 + 2440587.5 + 69 / 86400 - 2451545.0) / 36525;
    function sunLongitude(date) {
        const T = centuries(date);
        const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
        const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
        const C = (1.914602 - 0.004817 * T) * sinD(M) + (0.019993 - 0.000101 * T) * sinD(2 * M) + 0.000289 * sinD(3 * M);
        return norm360(L0 + C - 0.00569);
    }
    function moonLongitude(date) {
        const T = centuries(date);
        const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841;
        const Dm = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868;
        const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
        const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699;
        const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T;
        const E = 1 - 0.002516 * T - 0.0000074 * T * T;
        let sum = 0;
        MOON_TERMS.forEach(([d, m, mp, f, c]) => { sum += c * E ** Math.abs(m) * sinD(d * Dm + m * M + mp * Mp + f * F); });
        sum += 3958 * sinD(119.75 + 131.849 * T) + 1962 * sinD(Lp - F) + 318 * sinD(53.09 + 479264.29 * T);
        return norm360(Lp + sum / 1e6);
    }
    // tithi 1..30 (1–15 bright half, 16–30 dark half, 30 = new moon day)
    const tithiAt = (date) => Math.floor(norm360(moonLongitude(date) - sunLongitude(date)) / 12) + 1;
    const ayanamsa = (date) => 23.853 + 0.013968 * (date.getUTCFullYear() + date.getUTCMonth() / 12 - 2000);
    const siderealSign = (date) => Math.floor(norm360(sunLongitude(date) - ayanamsa(date)) / 30); // 0 = Mesha
    const newMoonMoment = (k) => jdToDate(lunation(k).jde);
    // lunar month (amanta) at a moment: 0 Chaitra … 11 Phalguna; leap = adhika (extra) month
    function lunarMonthAt(date) {
        let k = Math.floor((date.getTime() / 86400000 - 10957.75) / 29.530588861) + 1; // rough index from 2000
        while (newMoonMoment(k) > date) k--;
        while (newMoonMoment(k + 1) <= date) k++;
        const s0 = siderealSign(newMoonMoment(k)), s1 = siderealSign(newMoonMoment(k + 1));
        return { month: (s0 + 1) % 12, leap: s0 === s1 };
    }
    // the IST day (y, m, d) on which `tithi` in lunar `month` holds at the reference moment of that day
    const IST = 330; // minutes
    function istDay(y, m, d) { return new Date(Date.UTC(y, m - 1, d) - IST * 60000); } // 00:00 IST
    function refMoment(y, m, d, when) {
        const sun = sunTimes(DELHI.lat, DELHI.lon, y, m, d);
        const len = sun.set - sun.rise;
        switch (when) {
            case 'sunrise': return new Date(sun.rise.getTime() + 60000);
            case 'midday': return new Date(sun.rise.getTime() + len / 2);               // madhyahna
            case 'afternoon': return new Date(sun.rise.getTime() + len * 0.7);          // aparahna
            case 'evening': return new Date(sun.set.getTime() + 45 * 60000);            // pradosh
            case 'midnight': return new Date(istDay(y, m, d).getTime() + 24 * 3600000 + 5 * 60000); // nishita
            default: return sun.rise;
        }
    }
    const elongationAt = (date) => norm360(moonLongitude(date) - sunLongitude(date));
    // full moon day where the full moon still holds 2.4 h (3 muhurtas) after sunrise;
    // otherwise the day before (used for Raksha Bandhan)
    function purnimaUdaya(month, from, to) {
        for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
            const g = new Date(t);
            const yy = g.getFullYear(), mm = g.getMonth() + 1, dd = g.getDate();
            const rise = sunTimes(DELHI.lat, DELHI.lon, yy, mm, dd).rise;
            const at = new Date(rise.getTime() + 144 * 60000);
            if (tithiAt(at) === 15) { const lm = lunarMonthAt(at); if (lm.month === month && !lm.leap) return D(yy, mm, dd); continue; }
            const aft = refMoment(yy, mm, dd, 'afternoon');
            const nRise = sunTimes(DELHI.lat, DELHI.lon, yy, mm, dd + 1).rise;
            if (tithiAt(aft) === 15 && tithiAt(new Date(nRise.getTime() + 144 * 60000)) !== 15) {
                const lm = lunarMonthAt(aft); if (lm.month === month && !lm.leap) return D(yy, mm, dd);
            }
        }
        return null;
    }
    // Holika Dahan: full moon in the evening, but not during Bhadra (the first half of the full-moon tithi).
    // If Bhadra only ends after midnight, the bonfire moves to the next evening.
    function holikaDahan(from, to) {
        const day = festivalDay(null, 11, 15, 'evening', from, to);
        if (!day) return null;
        const y = day.getFullYear(), m = day.getMonth() + 1, d = day.getDate();
        const ev = refMoment(y, m, d, 'evening');
        const e = elongationAt(ev);
        if (e >= 174) return day; // Bhadra is already over
        const rate = (elongationAt(new Date(ev.getTime() + 3600000)) - e) || 0.5; // degrees per hour
        const bhadraEnd = new Date(ev.getTime() + ((174 - e) / rate) * 3600000);
        const midnight = new Date(istDay(y, m, d).getTime() + 24 * 3600000);
        if (bhadraEnd <= midnight) return day; // bonfire later that same night
        // Bhadra lasts past midnight: the next evening, if the full moon lasts until about sunset that day
        const next = addDays(day, 1);
        const nSet = sunTimes(DELHI.lat, DELHI.lon, next.getFullYear(), next.getMonth() + 1, next.getDate()).set;
        return tithiAt(new Date(nSet.getTime() - 2 * 3600000)) === 15 ? next : day;
    }

    function festivalDay(y, month, tithi, when, from, to) {
        for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
            const g = new Date(t);
            const yy = g.getFullYear(), mm = g.getMonth() + 1, dd = g.getDate();
            const at = refMoment(yy, mm, dd, when);
            if (tithiAt(at) !== tithi) continue;
            const lm = lunarMonthAt(at);
            if (lm.month === month && !lm.leap) return D(yy, mm, dd);
        }
        return null;
    }
    // [name, lunar month, tithi, when, search window (month, day) → (month, day)]
    const HINDU_FESTIVALS = [
        ['Maha Shivaratri', 10, 29, 'midnight', [2, 1], [3, 20]],
        ['Holika Dahan', 11, 15, 'evening', [2, 20], [4, 5]],
        ['Ram Navami', 0, 9, 'midday', [3, 15], [4, 30]],
        ['Raksha Bandhan', 4, 15, 'afternoon', [7, 20], [9, 5]],
        ['Krishna Janmashtami', 4, 23, 'midnight', [8, 5], [9, 15]],
        ['Ganesh Chaturthi', 5, 4, 'midday', [8, 15], [9, 30]],
        ['Navratri begins', 6, 1, 'sunrise', [9, 15], [10, 31]],
        ['Dussehra', 6, 10, 'afternoon', [9, 25], [11, 5]],
        ['Diwali', 6, 30, 'evening', [10, 10], [11, 20]]
    ];
    const hinduCache = new Map();
    function hinduFestivals(y) {
        if (hinduCache.has(y)) return hinduCache.get(y);
        const out = [];
        HINDU_FESTIVALS.forEach(([name, month, tithi, when, a, b]) => {
            const from = D(y, a[0], a[1]), to = D(y, b[0], b[1]);
            const day = name === 'Holika Dahan' ? holikaDahan(from, to)
                : name === 'Raksha Bandhan' ? purnimaUdaya(month, from, to)
                    : festivalDay(y, month, tithi, when, from, to);
            if (!day) return;
            if (name === 'Holika Dahan') { out.push([day, 'Holika Dahan']); out.push([addDays(day, 1), 'Holi']); }
            else out.push([day, name]);
        });
        hinduCache.set(y, out);
        return out;
    }

    // the day (in a time zone, as an offset in minutes) on which the Sun reaches a longitude
    // (tropical, or sidereal for Indian sankrantis), searching day `from` (y, m, d) for `days` days
    function solarTermDay(y, m, d, days, targetLon, tzMin, sidereal) {
        const lonAt = (t) => norm360(sunLongitude(t) - (sidereal ? ayanamsa(t) : 0));
        for (let i = 0; i < days; i++) {
            const start = new Date(Date.UTC(y, m - 1, d + i) - tzMin * 60000);
            const end = new Date(start.getTime() + 86400000);
            const a = norm360(lonAt(start) - targetLon), b = norm360(lonAt(end) - targetLon);
            if (a > 300 && b < 60) { const g = new Date(Date.UTC(y, m - 1, d + i)); return D(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate()); }
        }
        return null;
    }

    // Chinese lunar dates (the browser knows the Chinese calendar): every day of year y with its lunar month/day
    const chineseCache = new Map();
    function chineseLunarDays(y) {
        if (chineseCache.has(y)) return chineseCache.get(y);
        const out = [];
        let fmt = null;
        try { fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }); } catch (err) { /* old browser */ }
        if (fmt) {
            for (let dt = D(y, 1, 1); dt.getFullYear() === y; dt = addDays(dt, 1)) {
                const parts = {};
                fmt.formatToParts(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), 4))).forEach((p) => { parts[p.type] = p.value; });
                const leap = /bis/.test(parts.month);
                out.push({ date: dt, month: parseInt(parts.month, 10), day: parseInt(parts.day, 10), leap });
            }
        }
        chineseCache.set(y, out);
        return out;
    }
    const lunarDates = (y, month, day) => chineseLunarDays(y).filter((x) => !x.leap && x.month === month && x.day === day).map((x) => x.date);

    // Islamic dates (Umm al-Qura calendar); in India the day can be one later (moon sighting)
    function islamicDates(y, month, day) {
        let fmt = null;
        try { fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }); } catch (err) { return []; }
        const out = [];
        for (let dt = D(y, 1, 1); dt.getFullYear() === y; dt = addDays(dt, 1)) {
            const parts = {};
            fmt.formatToParts(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12))).forEach((p) => { parts[p.type] = p.value; });
            if (parseInt(parts.month, 10) === month && parseInt(parts.day, 10) === day) out.push(dt);
        }
        return out;
    }

    // US federal holidays on a weekend are observed on the Friday before / Monday after
    function usObserved(date) {
        const wd = date.getDay();
        return wd === 6 ? addDays(date, -1) : wd === 0 ? addDays(date, 1) : null;
    }

    function holidayList(code, y) {
        const E = easterSunday(y);
        const H = (date, name, local) => ({ date, name, local: local || '', obs: false });
        // observance: a special day, but not a day off
        const O = (date, name, local) => ({ date, name, local: local || '', obs: true });
        const lastSunday = (m) => lastWeekday(y, m, 0);
        switch (code) {
            case 'MOON': {
                const hm = (t) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                return moonEvents(y).map((e) => {
                    const day = D(e.date.getFullYear(), e.date.getMonth() + 1, e.date.getDate());
                    if (e.type === 'full') return O(day, '🌕 Full moon', `at ${hm(e.date)}`);
                    if (e.type === 'new') return O(day, '🌑 New moon', `at ${hm(e.date)}`);
                    return O(day, `${e.solar ? '🌘' : '🌒'} ${e.kind}`, `greatest at ${hm(e.date)}, not visible everywhere`);
                });
            }
            case 'SKY': {
                const hm = (t) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                const names = ['Spring equinox', 'Summer solstice (longest day)', 'Autumn equinox', 'Winter solstice (shortest day)'];
                const list = names.map((name, i) => {
                    const t = seasonMoment(y, i);
                    return O(D(t.getFullYear(), t.getMonth() + 1, t.getDate()), name, `at ${hm(t)}`);
                });
                clockChanges(y).forEach((c) => {
                    const amount = c.minutes === 60 ? '1 hour' : `${c.minutes} min`;
                    list.push(O(c.date, c.forward ? 'Summer time starts' : 'Winter time starts',
                        c.forward ? `clocks go forward ${amount}` : `clocks go back ${amount}`));
                });
                return list;
            }
            case 'INT': return [
                H(D(y, 1, 1), "New Year's Day"), H(D(y, 2, 14), "Valentine's Day"),
                H(D(y, 3, 8), "International Women's Day"), H(D(y, 4, 22), 'Earth Day'),
                H(D(y, 5, 1), "International Workers' Day"), H(D(y, 10, 31), 'Halloween'),
                H(D(y, 12, 24), 'Christmas Eve'), H(D(y, 12, 25), 'Christmas Day'), H(D(y, 12, 31), "New Year's Eve"),
                O(D(y, 3, 20), 'International Day of Happiness'), O(D(y, 4, 1), "April Fools' Day"),
                O(D(y, 4, 10), 'Siblings Day'), O(nthWeekday(y, 5, 0, 2), "Mother's Day"),
                O(D(y, 6, 1), "International Children's Day"), O(nthWeekday(y, 6, 0, 3), "Father's Day"),
                O(D(y, 7, 30), 'International Friendship Day'), O(D(y, 8, 1), 'Girlfriend Day'),
                O(D(y, 10, 3), 'Boyfriend Day'), O(D(y, 11, 19), "International Men's Day")
            ];
            case 'GB': {
                const list = [
                    H(D(y, 1, 1), "New Year's Day"), H(addDays(E, -2), 'Good Friday'), H(addDays(E, 1), 'Easter Monday'),
                    H(nthWeekday(y, 5, 1, 1), 'Early May bank holiday'), H(lastWeekday(y, 5, 1), 'Spring bank holiday'),
                    H(lastWeekday(y, 8, 1), 'Summer bank holiday'), H(D(y, 12, 25), 'Christmas Day'), H(D(y, 12, 26), 'Boxing Day'),
                    O(D(y, 2, 14), "Valentine's Day"), O(addDays(E, -21), 'Mothering Sunday'),
                    O(nthWeekday(y, 6, 0, 3), "Father's Day"), O(D(y, 10, 31), 'Halloween'),
                    O(D(y, 11, 5), 'Bonfire Night'), O(D(y, 3, 17), "St Patrick's Day")
                ];
                // bank holidays on a weekend move to the next weekday
                const ny = D(y, 1, 1);
                if (ny.getDay() === 6 || ny.getDay() === 0) list.push(H(weekdayFrom(ny, 1), "New Year's Day (substitute day)"));
                const xmas = D(y, 12, 25).getDay();
                if (xmas === 6) { list.push(H(D(y, 12, 27), 'Christmas Day (substitute day)'), H(D(y, 12, 28), 'Boxing Day (substitute day)')); }
                else if (xmas === 0) { list.push(H(D(y, 12, 27), 'Christmas Day (substitute day)')); }
                else if (xmas === 5) { list.push(H(D(y, 12, 28), 'Boxing Day (substitute day)')); }
                return list;
            }
            case 'NL': {
                const kingsDay = D(y, 4, 27).getDay() === 0 ? D(y, 4, 26) : D(y, 4, 27);
                return [
                    H(D(y, 1, 1), "New Year's Day", 'Nieuwjaarsdag'), H(addDays(E, -2), 'Good Friday', 'Goede Vrijdag'),
                    H(E, 'Easter Sunday', 'Eerste Paasdag'), H(addDays(E, 1), 'Easter Monday', 'Tweede Paasdag'),
                    H(kingsDay, "King's Day", 'Koningsdag'), H(D(y, 5, 5), 'Liberation Day', 'Bevrijdingsdag'),
                    H(addDays(E, 39), 'Ascension Day', 'Hemelvaartsdag'), H(addDays(E, 49), 'Whit Sunday', 'Eerste Pinksterdag'),
                    H(addDays(E, 50), 'Whit Monday', 'Tweede Pinksterdag'), H(D(y, 12, 25), 'Christmas Day', 'Eerste Kerstdag'),
                    H(D(y, 12, 26), 'Boxing Day', 'Tweede Kerstdag'),
                    O(D(y, 2, 14), "Valentine's Day", 'Valentijnsdag'), O(nthWeekday(y, 5, 0, 2), "Mother's Day", 'Moederdag'),
                    O(D(y, 5, 4), 'Remembrance of the Dead', 'Dodenherdenking'), O(nthWeekday(y, 6, 0, 3), "Father's Day", 'Vaderdag'),
                    O(nthWeekday(y, 9, 2, 3), "Prince's Day", 'Prinsjesdag'), O(D(y, 11, 11), "St Martin's Day", 'Sint-Maarten'),
                    O(D(y, 12, 5), 'Sinterklaas Eve', 'Sinterklaasavond / Pakjesavond'), O(D(y, 12, 31), "New Year's Eve", 'Oudejaarsavond')
                ];
            }
            case 'FR': return [
                H(D(y, 1, 1), "New Year's Day", "Jour de l'an"), H(addDays(E, 1), 'Easter Monday', 'Lundi de Pâques'),
                H(D(y, 5, 1), 'Labour Day', 'Fête du Travail'), H(D(y, 5, 8), 'Victory in Europe Day', 'Victoire 1945'),
                H(addDays(E, 39), 'Ascension Day', 'Ascension'), H(addDays(E, 50), 'Whit Monday', 'Lundi de Pentecôte'),
                H(D(y, 7, 14), 'Bastille Day', 'Fête nationale'), H(D(y, 8, 15), 'Assumption Day', 'Assomption'),
                H(D(y, 11, 1), "All Saints' Day", 'Toussaint'), H(D(y, 11, 11), 'Armistice Day', 'Armistice 1918'),
                H(D(y, 12, 25), 'Christmas Day', 'Noël'),
                O(D(y, 2, 14), "Valentine's Day", 'Saint-Valentin'),
                O(dayKey(lastSunday(5)) === dayKey(addDays(E, 49)) ? nthWeekday(y, 6, 0, 1) : lastSunday(5), "Mother's Day", 'Fête des Mères'),
                O(nthWeekday(y, 6, 0, 3), "Father's Day", 'Fête des Pères'), O(D(y, 6, 21), 'Music Day', 'Fête de la Musique')
            ];
            case 'SE': return [
                H(D(y, 1, 1), "New Year's Day", 'Nyårsdagen'), H(D(y, 1, 6), 'Epiphany', 'Trettondedag jul'),
                H(addDays(E, -2), 'Good Friday', 'Långfredagen'), H(E, 'Easter Sunday', 'Påskdagen'),
                H(addDays(E, 1), 'Easter Monday', 'Annandag påsk'), H(D(y, 5, 1), 'May Day', 'Första maj'),
                H(addDays(E, 39), 'Ascension Day', 'Kristi himmelsfärdsdag'), H(addDays(E, 49), 'Whit Sunday', 'Pingstdagen'),
                H(D(y, 6, 6), 'National Day of Sweden', 'Sveriges nationaldag'),
                H(weekdayFrom(D(y, 6, 19), 5), 'Midsummer Eve', 'Midsommarafton'),
                H(weekdayFrom(D(y, 6, 20), 6), 'Midsummer Day', 'Midsommardagen'),
                H(weekdayFrom(D(y, 10, 31), 6), "All Saints' Day", 'Alla helgons dag'),
                H(D(y, 12, 24), 'Christmas Eve', 'Julafton'), H(D(y, 12, 25), 'Christmas Day', 'Juldagen'),
                H(D(y, 12, 26), 'Boxing Day', 'Annandag jul'), H(D(y, 12, 31), "New Year's Eve", 'Nyårsafton'),
                O(D(y, 2, 14), "Valentine's Day", 'Alla hjärtans dag'), O(D(y, 4, 30), 'Walpurgis Night', 'Valborgsmässoafton'),
                O(lastSunday(5), "Mother's Day", 'Mors dag'), O(nthWeekday(y, 11, 0, 2), "Father's Day", 'Fars dag'),
                O(D(y, 12, 13), "St Lucia's Day", 'Luciadagen')
            ];
            case 'DE': return [
                H(D(y, 1, 1), "New Year's Day", 'Neujahr'), H(addDays(E, -2), 'Good Friday', 'Karfreitag'),
                H(addDays(E, 1), 'Easter Monday', 'Ostermontag'), H(D(y, 5, 1), 'Labour Day', 'Tag der Arbeit'),
                H(addDays(E, 39), 'Ascension Day', 'Christi Himmelfahrt'), H(addDays(E, 50), 'Whit Monday', 'Pfingstmontag'),
                H(D(y, 10, 3), 'German Unity Day', 'Tag der Deutschen Einheit'),
                H(D(y, 12, 25), 'Christmas Day', '1. Weihnachtstag'), H(D(y, 12, 26), 'Second Day of Christmas', '2. Weihnachtstag'),
                O(D(y, 2, 14), "Valentine's Day", 'Valentinstag'), O(nthWeekday(y, 5, 0, 2), "Mother's Day", 'Muttertag'),
                O(addDays(E, 39), "Father's Day", 'Vatertag'), O(D(y, 11, 11), "St Martin's Day", 'Martinstag'),
                O(D(y, 12, 6), "St Nicholas' Day", 'Nikolaustag'), O(D(y, 12, 24), 'Christmas Eve', 'Heiligabend'),
                O(D(y, 12, 31), "New Year's Eve", 'Silvester')
            ];
            case 'US': {
                const list = [
                    H(D(y, 1, 1), "New Year's Day"), H(nthWeekday(y, 1, 1, 3), 'Martin Luther King Jr. Day'),
                    H(nthWeekday(y, 2, 1, 3), "Washington's Birthday (Presidents' Day)"), H(lastWeekday(y, 5, 1), 'Memorial Day'),
                    H(D(y, 6, 19), 'Juneteenth'), H(D(y, 7, 4), 'Independence Day'),
                    H(nthWeekday(y, 9, 1, 1), 'Labor Day'), H(nthWeekday(y, 10, 1, 2), "Columbus Day / Indigenous Peoples' Day"),
                    H(D(y, 11, 11), 'Veterans Day'), H(nthWeekday(y, 11, 4, 4), 'Thanksgiving Day'),
                    H(D(y, 12, 25), 'Christmas Day'),
                    O(D(y, 2, 2), 'Groundhog Day'), O(D(y, 2, 14), "Valentine's Day"), O(D(y, 3, 17), "St. Patrick's Day"),
                    O(E, 'Easter Sunday'), O(nthWeekday(y, 5, 0, 2), "Mother's Day"), O(nthWeekday(y, 6, 0, 3), "Father's Day"),
                    O(D(y, 10, 31), 'Halloween'), O(addDays(nthWeekday(y, 11, 4, 4), 1), 'Black Friday'),
                    O(D(y, 12, 24), 'Christmas Eve'), O(D(y, 12, 31), "New Year's Eve")
                ];
                // weekend federal holidays: the day off moves to Friday / Monday
                [[D(y, 1, 1), "New Year's Day"], [D(y, 6, 19), 'Juneteenth'], [D(y, 7, 4), 'Independence Day'],
                    [D(y, 11, 11), 'Veterans Day'], [D(y, 12, 25), 'Christmas Day'], [D(y + 1, 1, 1), "New Year's Day"]].forEach(([d, n]) => {
                    const obs = usObserved(d);
                    if (obs && obs.getFullYear() === y) list.push(H(obs, `${n} (observed)`, 'day off'));
                });
                // Election Day: the Tuesday after the first Monday of November, in even years
                if (y % 2 === 0) list.push(O(addDays(nthWeekday(y, 11, 1, 1), 1), 'Election Day'));
                return list;
            }
            case 'CN': {
                const list = [
                    H(D(y, 1, 1), "New Year's Day", '元旦'), H(D(y, 5, 1), 'Labour Day', '劳动节'),
                    H(D(y, 10, 1), 'National Day', '国庆节')
                ];
                const add = (fn, dates, name, local) => dates.forEach((d) => list.push(fn(d, name, local)));
                const newYear = lunarDates(y, 1, 1);
                add(H, newYear, 'Chinese New Year (Spring Festival)', '春节');
                add(O, newYear.map((d) => addDays(d, -1)), "Chinese New Year's Eve", '除夕');
                add(O, lunarDates(y, 1, 15), 'Lantern Festival', '元宵节');
                const qingming = solarTermDay(y, 4, 3, 4, 15, 480);
                if (qingming) list.push(H(qingming, 'Qingming Festival (Tomb-Sweeping Day)', '清明节'));
                add(H, lunarDates(y, 5, 5), 'Dragon Boat Festival', '端午节');
                add(O, lunarDates(y, 7, 7), 'Qixi Festival', '七夕');
                add(O, lunarDates(y, 7, 15), 'Ghost Festival', '中元节');
                add(H, lunarDates(y, 8, 15), 'Mid-Autumn Festival', '中秋节');
                add(O, lunarDates(y, 9, 9), 'Double Ninth Festival', '重阳节');
                const dongzhi = solarTermDay(y, 12, 20, 4, 270, 480);
                if (dongzhi) list.push(O(dongzhi, 'Winter Solstice Festival', '冬至'));
                add(O, lunarDates(y, 12, 8), 'Laba Festival', '腊八节');
                return list;
            }
            case 'IN': {
                const hi = { 'Maha Shivaratri': 'महाशिवरात्रि', 'Holika Dahan': 'होलिका दहन', Holi: 'होली', 'Ram Navami': 'राम नवमी',
                    'Raksha Bandhan': 'रक्षा बन्धन', 'Krishna Janmashtami': 'जन्माष्टमी', 'Ganesh Chaturthi': 'गणेश चतुर्थी',
                    'Navratri begins': 'नवरात्रि', Dussehra: 'दशहरा', Diwali: 'दीपावली' };
                const days_off = new Set(['Holi', 'Dussehra', 'Diwali']);
                const list = [
                    H(D(y, 1, 26), 'Republic Day', 'गणतंत्र दिवस'), H(D(y, 8, 15), 'Independence Day', 'स्वतंत्रता दिवस'),
                    H(D(y, 10, 2), 'Gandhi Jayanti', 'गांधी जयंती'), H(addDays(E, -2), 'Good Friday'),
                    H(D(y, 12, 25), 'Christmas Day'), O(D(y, 4, 14), 'Ambedkar Jayanti', 'आंबेडकर जयंती')
                ];
                const makar = solarTermDay(y, 1, 12, 5, 270, IST, true);
                if (makar) list.push(O(makar, 'Makar Sankranti / Pongal', 'मकर संक्रान्ति'));
                const mesha = solarTermDay(y, 4, 12, 4, 0, IST, true);
                if (mesha) list.push(O(mesha, 'Vaisakhi (Baisakhi)', 'वैसाखी'));
                hinduFestivals(y).forEach(([d, name]) => list.push((days_off.has(name) ? H : O)(d, name, hi[name] || '')));
                islamicDates(y, 10, 1).forEach((d) => list.push(H(d, 'Eid al-Fitr', 'ईद उल-फ़ित्र · may be a day later in India')));
                islamicDates(y, 12, 10).forEach((d) => list.push(H(d, 'Eid al-Adha (Bakrid)', 'बकरीद · may be a day later in India')));
                return list;
            }
            case 'JP': {
                const t = y - 1980, leap = Math.floor(t / 4);
                const vernal = Math.floor(20.8431 + 0.242194 * t - leap);
                const autumnal = Math.floor(23.2488 + 0.242194 * t - leap);
                const list = [
                    H(D(y, 1, 1), "New Year's Day", '元日'), H(nthWeekday(y, 1, 1, 2), 'Coming of Age Day', '成人の日'),
                    H(D(y, 2, 11), 'National Foundation Day', '建国記念の日'), H(D(y, 2, 23), "Emperor's Birthday", '天皇誕生日'),
                    H(D(y, 3, vernal), 'Vernal Equinox Day', '春分の日'), H(D(y, 4, 29), 'Shōwa Day', '昭和の日'),
                    H(D(y, 5, 3), 'Constitution Memorial Day', '憲法記念日'), H(D(y, 5, 4), 'Greenery Day', 'みどりの日'),
                    H(D(y, 5, 5), "Children's Day", 'こどもの日'), H(nthWeekday(y, 7, 1, 3), 'Marine Day', '海の日'),
                    H(D(y, 8, 11), 'Mountain Day', '山の日'), H(nthWeekday(y, 9, 1, 3), 'Respect for the Aged Day', '敬老の日'),
                    H(D(y, 9, autumnal), 'Autumnal Equinox Day', '秋分の日'), H(nthWeekday(y, 10, 1, 2), 'Sports Day', 'スポーツの日'),
                    H(D(y, 11, 3), 'Culture Day', '文化の日'), H(D(y, 11, 23), 'Labour Thanksgiving Day', '勤労感謝の日')
                ];
                // special days that are not days off (added after the substitute-day rules below run on `list`)
                const extras = [
                    O(D(y, 2, 3), 'Setsubun', '節分'), O(D(y, 2, 14), "Valentine's Day", 'バレンタインデー'),
                    O(D(y, 3, 3), "Girls' Day (Hinamatsuri)", 'ひな祭り'), O(D(y, 3, 14), 'White Day', 'ホワイトデー'),
                    O(nthWeekday(y, 5, 0, 2), "Mother's Day", '母の日'), O(nthWeekday(y, 6, 0, 3), "Father's Day", '父の日'),
                    O(D(y, 7, 7), 'Tanabata', '七夕'), O(D(y, 11, 15), 'Shichi-Go-San', '七五三'),
                    O(D(y, 12, 24), 'Christmas Eve', 'クリスマスイブ'), O(D(y, 12, 31), "New Year's Eve", '大晦日')
                ];
                const taken = new Set(list.map((h) => dayKey(h.date)));
                // a holiday on a Sunday gives the next free weekday off
                list.slice().sort((a, b) => a.date - b.date).forEach((h) => {
                    if (h.date.getDay() !== 0) return;
                    let d = addDays(h.date, 1);
                    while (taken.has(dayKey(d))) d = addDays(d, 1);
                    taken.add(dayKey(d));
                    list.push(H(d, 'Substitute Holiday', '振替休日'));
                });
                // a single day between two holidays is also a holiday
                list.slice().forEach((h) => {
                    const mid = addDays(h.date, 1);
                    if (!taken.has(dayKey(mid)) && taken.has(dayKey(addDays(h.date, 2))) && mid.getDay() !== 0) {
                        taken.add(dayKey(mid));
                        list.push(H(mid, "Citizens' Holiday", '国民の休日'));
                    }
                });
                return list.concat(extras);
            }
            default: return [];
        }
    }

    const holidayCache = new Map(); // "NL-2026" -> Map(dayKey -> [holiday])
    function holidaysByDay(code, y) {
        const key = `${code}-${y}`;
        if (!holidayCache.has(key)) {
            const map = new Map();
            holidayList(code, y).forEach((h) => {
                const k = dayKey(h.date);
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(h);
            });
            holidayCache.set(key, map);
        }
        return holidayCache.get(key);
    }

    function enabledHolidaySets() {
        const on = Array.isArray(state.prefs.holidays) ? state.prefs.holidays : [];
        return HOLIDAY_SETS.filter((s) => on.includes(s.code));
    }

    // Holidays on a day, the same holiday from several countries merged into one
    function holidaysOn(day) {
        const merged = new Map();
        enabledHolidaySets().forEach((set) => {
            (holidaysByDay(set.code, day.getFullYear()).get(dayKey(day)) || []).forEach((h) => {
                const item = merged.get(h.name) || { name: h.name, locals: [], sets: [], obs: true };
                if (!h.obs) item.obs = false; // a day off somewhere = holiday
                if (h.local && !item.locals.includes(h.local)) item.locals.push(h.local);
                item.sets.push(set.short);
                merged.set(h.name, item);
            });
        });
        return [...merged.values()];
    }

    function holidayTitle(h) {
        return `${h.name}${h.locals.length ? ` (${h.locals.join(' / ')})` : ''} · ${h.sets.join(', ')} ${h.obs ? 'observance' : 'holiday'}`;
    }

    /* ---------------- world clocks (Calendar tab → Clock) ---------------- */
    // id, name, country, IANA time zone, latitude, longitude
    const CLOCK_CITIES = [
        ['amsterdam', 'Amsterdam', 'Netherlands', 'Europe/Amsterdam', 52.37, 4.90],
        ['london', 'London', 'United Kingdom', 'Europe/London', 51.51, -0.13],
        ['dublin', 'Dublin', 'Ireland', 'Europe/Dublin', 53.35, -6.26],
        ['paris', 'Paris', 'France', 'Europe/Paris', 48.86, 2.35],
        ['brussels', 'Brussels', 'Belgium', 'Europe/Brussels', 50.85, 4.35],
        ['berlin', 'Berlin', 'Germany', 'Europe/Berlin', 52.52, 13.40],
        ['madrid', 'Madrid', 'Spain', 'Europe/Madrid', 40.42, -3.70],
        ['lisbon', 'Lisbon', 'Portugal', 'Europe/Lisbon', 38.72, -9.14],
        ['rome', 'Rome', 'Italy', 'Europe/Rome', 41.90, 12.50],
        ['vienna', 'Vienna', 'Austria', 'Europe/Vienna', 48.21, 16.37],
        ['copenhagen', 'Copenhagen', 'Denmark', 'Europe/Copenhagen', 55.68, 12.57],
        ['oslo', 'Oslo', 'Norway', 'Europe/Oslo', 59.91, 10.75],
        ['stockholm', 'Stockholm', 'Sweden', 'Europe/Stockholm', 59.33, 18.07],
        ['helsinki', 'Helsinki', 'Finland', 'Europe/Helsinki', 60.17, 24.94],
        ['reykjavik', 'Reykjavík', 'Iceland', 'Atlantic/Reykjavik', 64.15, -21.94],
        ['warsaw', 'Warsaw', 'Poland', 'Europe/Warsaw', 52.23, 21.01],
        ['athens', 'Athens', 'Greece', 'Europe/Athens', 37.98, 23.73],
        ['istanbul', 'Istanbul', 'Türkiye', 'Europe/Istanbul', 41.01, 28.98],
        ['moscow', 'Moscow', 'Russia', 'Europe/Moscow', 55.76, 37.62],
        ['cairo', 'Cairo', 'Egypt', 'Africa/Cairo', 30.04, 31.24],
        ['lagos', 'Lagos', 'Nigeria', 'Africa/Lagos', 6.52, 3.38],
        ['nairobi', 'Nairobi', 'Kenya', 'Africa/Nairobi', -1.29, 36.82],
        ['johannesburg', 'Johannesburg', 'South Africa', 'Africa/Johannesburg', -26.20, 28.05],
        ['riyadh', 'Riyadh', 'Saudi Arabia', 'Asia/Riyadh', 24.71, 46.68],
        ['dubai', 'Dubai', 'United Arab Emirates', 'Asia/Dubai', 25.20, 55.27],
        ['tehran', 'Tehran', 'Iran', 'Asia/Tehran', 35.69, 51.39],
        ['new-delhi', 'New Delhi', 'India', 'Asia/Kolkata', 28.61, 77.21],
        ['bangkok', 'Bangkok', 'Thailand', 'Asia/Bangkok', 13.76, 100.50],
        ['jakarta', 'Jakarta', 'Indonesia', 'Asia/Jakarta', -6.21, 106.85],
        ['singapore', 'Singapore', 'Singapore', 'Asia/Singapore', 1.35, 103.82],
        ['manila', 'Manila', 'Philippines', 'Asia/Manila', 14.60, 120.98],
        ['hong-kong', 'Hong Kong', 'China', 'Asia/Hong_Kong', 22.32, 114.17],
        ['beijing', 'Beijing', 'China', 'Asia/Shanghai', 39.90, 116.41],
        ['seoul', 'Seoul', 'South Korea', 'Asia/Seoul', 37.57, 126.98],
        ['tokyo', 'Tokyo', 'Japan', 'Asia/Tokyo', 35.68, 139.69],
        ['sydney', 'Sydney', 'Australia', 'Australia/Sydney', -33.87, 151.21],
        ['canberra', 'Canberra', 'Australia', 'Australia/Sydney', -35.28, 149.13],
        ['auckland', 'Auckland', 'New Zealand', 'Pacific/Auckland', -36.85, 174.76],
        ['honolulu', 'Honolulu', 'United States', 'Pacific/Honolulu', 21.31, -157.86],
        ['anchorage', 'Anchorage', 'United States', 'America/Anchorage', 61.22, -149.90],
        ['los-angeles', 'Los Angeles', 'United States', 'America/Los_Angeles', 34.05, -118.24],
        ['vancouver', 'Vancouver', 'Canada', 'America/Vancouver', 49.28, -123.12],
        ['denver', 'Denver', 'United States', 'America/Denver', 39.74, -104.99],
        ['mexico-city', 'Mexico City', 'Mexico', 'America/Mexico_City', 19.43, -99.13],
        ['chicago', 'Chicago', 'United States', 'America/Chicago', 41.88, -87.63],
        ['toronto', 'Toronto', 'Canada', 'America/Toronto', 43.65, -79.38],
        ['ottawa', 'Ottawa', 'Canada', 'America/Toronto', 45.42, -75.70],
        ['new-york', 'New York', 'United States', 'America/New_York', 40.71, -74.01],
        ['washington', 'Washington, D.C.', 'United States', 'America/New_York', 38.90, -77.04],
        ['bogota', 'Bogotá', 'Colombia', 'America/Bogota', 4.71, -74.07],
        ['lima', 'Lima', 'Peru', 'America/Lima', -12.05, -77.04],
        ['santiago', 'Santiago', 'Chile', 'America/Santiago', -33.45, -70.67],
        ['buenos-aires', 'Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires', -34.60, -58.38],
        ['sao-paulo', 'São Paulo', 'Brazil', 'America/Sao_Paulo', -23.55, -46.63],
        ['brasilia', 'Brasília', 'Brazil', 'America/Sao_Paulo', -15.79, -47.88]
    ].map(([id, name, country, tz, lat, lon]) => ({ id, name, country, tz, lat, lon }));
    const cityById = new Map(CLOCK_CITIES.map((c) => [c.id, c]));
    const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { return ''; } })();

    function clockInfo(id) {
        if (id === 'local') {
            // your own clock: use a known city in your time zone for sunrise / sunset
            const city = CLOCK_CITIES.find((c) => c.tz === LOCAL_TZ);
            return { id, name: 'Your time', country: city ? city.name : LOCAL_TZ.replace(/_/g, ' '), tz: LOCAL_TZ || undefined,
                lat: city ? city.lat : null, lon: city ? city.lon : null, local: true };
        }
        return cityById.get(id) || null;
    }

    const partsCache = new Map();
    function zoneParts(tz, date) {
        let fmt = partsCache.get(tz || '');
        if (!fmt) {
            fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
                day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
            partsCache.set(tz || '', fmt);
        }
        const p = {};
        fmt.formatToParts(date).forEach(({ type, value }) => { p[type] = value; });
        return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second, wd: p.weekday };
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    // minutes ahead of UTC
    function zoneOffset(tz, date) {
        const p = zoneParts(tz, date);
        return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - date.getTime()) / 60000);
    }
    const zoneHM = (tz, date) => { const p = zoneParts(tz, date); return `${pad2(p.h)}:${pad2(p.min)}`; };

    const RING_R = 54.2; // middle of the 24-hour ring (inner edge just outside the 12-hour dial)

    // colour the 24-hour ring: light from sunrise to sunset, dark at night (like the clock face)
    function updateRing(card, c, now) {
        const p = zoneParts(c.tz, now);
        let start = 7 * 60, len = 12 * 60; // without a known place: 07:00–19:00
        if (c.lat !== null && c.lat !== undefined) {
            const sun = sunTimes(c.lat, c.lon, p.y, p.m, p.d);
            if (sun.polar) { start = 0; len = sun.polar === 'day' ? 1440 : 0; }
            else {
                const r = zoneParts(c.tz, sun.rise), st = zoneParts(c.tz, sun.set);
                start = r.h * 60 + r.min;
                len = ((st.h * 60 + st.min) - start + 1440) % 1440;
            }
        }
        const day = card.querySelector('.ring-day');
        day.setAttribute('stroke-dasharray', `${len} ${1440 - len + 0.001}`);
        // a circle starts at 3 o'clock: turn it so the arc starts at sunrise (24 at the top)
        day.setAttribute('transform', `rotate(${(start / 4 - 90).toFixed(2)} 60 60)`);
        card.querySelectorAll('.ring-ticks text').forEach((t) => {
            const m = Number(t.dataset.h) * 60;
            const isDay = len >= 1440 || ((m - start + 1440) % 1440) < len;
            t.classList.toggle('on-day', isDay);
        });
    }

    function clockFaceSvg() {
        let ticks = '';
        for (let i = 0; i < 60; i++) {
            const big = i % 5 === 0;
            ticks += `<line x1="50" y1="${big ? 6 : 7}" x2="50" y2="${big ? 13 : 10}" class="${big ? 'tick-big' : 'tick'}" transform="rotate(${i * 6} 50 50)"/>`;
        }
        let nums = '';
        for (let i = 1; i <= 12; i++) {
            const a = i * 30 * DEG;
            nums += `<text x="${(50 + 30 * Math.sin(a)).toFixed(2)}" y="${(50 - 30 * Math.cos(a) + 3.6).toFixed(2)}">${i}</text>`;
        }
        // 24-hour ring around the clock: 24 (midnight) at the top, 12 (noon) at the bottom
        let ring = '';
        for (let h = 0; h < 24; h++) {
            const a = h * 15 * DEG;
            ring += `<line x1="60" y1="0.9" x2="60" y2="3.4" class="ring-tick" transform="rotate(${h * 15 + 7.5} 60 60)"/>`;
            ring += `<text x="${(60 + RING_R * Math.sin(a)).toFixed(2)}" y="${(60 - RING_R * Math.cos(a) + 1.95).toFixed(2)}" data-h="${h}">${h || 24}</text>`;
        }
        return `<svg viewBox="0 0 120 120" class="clock-face" aria-hidden="true">
            <circle cx="60" cy="60" r="${RING_R}" class="ring-night"/>
            <circle cx="60" cy="60" r="${RING_R}" class="ring-day" pathLength="1440" stroke-dasharray="0 1440"/>
            <circle cx="60" cy="60" r="${RING_R + 5.2}" class="ring-edge"/>
            <g class="ring-ticks">${ring}</g>
            <g transform="translate(10 10)">
                <circle cx="50" cy="50" r="47" class="rim"/>
                ${ticks}<g class="nums">${nums}</g>
                <line x1="50" y1="55" x2="50" y2="27" class="hand hour"/>
                <line x1="50" y1="57" x2="50" y2="15" class="hand minute"/>
                <line x1="50" y1="60" x2="50" y2="11" class="hand second"/>
                <circle cx="50" cy="50" r="2.4" class="pin"/>
            </g>
            <g class="ring-mark" visibility="hidden"><line x1="60" y1="0.6" x2="60" y2="13.5"/></g>
        </svg>`;
    }

    function clockIds() {
        if (!Array.isArray(state.prefs.clocks)) state.prefs.clocks = ['local', 'tokyo', 'paris', 'new-york'];
        return state.prefs.clocks.filter((id) => clockInfo(id));
    }

    function renderClocks() {
        const now = new Date();
        $('clockGrid').innerHTML = clockIds().map((id) => {
            const c = clockInfo(id);
            return `<div class="clock-card" data-clock-id="${id}">
                ${c.local ? '' : `<button class="clock-remove icon-btn" type="button" title="Remove ${escapeHtml(c.name)}" aria-label="Remove ${escapeHtml(c.name)}">&times;</button>`}
                ${clockFaceSvg()}
                <div class="clock-name">${escapeHtml(c.name)}</div>
                <div class="clock-sub">${escapeHtml(c.country)}</div>
                <div class="clock-digital"></div>
                <div class="clock-date"></div>
                <div class="clock-diff"></div>
                <div class="clock-sun"></div>
                <div class="clock-mark" hidden></div>
            </div>`;
        }).join('') + `<button class="clock-card clock-add" id="clockAdd" type="button"><span class="clock-add-plus">+</span><span>Add clock</span></button>`;
        updateClocks(now, true);
        updateClockMarks();
    }

    /* Red marker: click (or drag) on a clock to mark a moment; every clock shows that same
     * moment in its own time. Dark red = night there, light red = day there. */
    let clockMark = null; // the marked moment (a Date), or null

    function isNightAt(c, when) {
        const p = zoneParts(c.tz, when);
        if (c.lat === null || c.lat === undefined) return p.h < 7 || p.h >= 19;
        const sun = sunTimes(c.lat, c.lon, p.y, p.m, p.d);
        if (sun.polar) return sun.polar === 'night';
        return when < sun.rise || when >= sun.set;
    }

    function updateClockMarks() {
        document.querySelectorAll('#clockGrid .clock-card[data-clock-id]').forEach((card) => {
            const c = clockInfo(card.dataset.clockId);
            const hand = card.querySelector('.ring-mark');
            const label = card.querySelector('.clock-mark');
            if (!c || !hand) return;
            if (!clockMark) {
                hand.setAttribute('visibility', 'hidden');
                label.hidden = true;
                return;
            }
            const p = zoneParts(c.tz, clockMark);
            const night = isNightAt(c, clockMark);
            hand.setAttribute('visibility', 'visible');
            hand.setAttribute('transform', `rotate(${((p.h * 60 + p.min) / 4).toFixed(2)} 60 60)`);
            hand.classList.toggle('night', night);
            const today = zoneParts(c.tz, new Date());
            const sameDay = today.y === p.y && today.m === p.m && today.d === p.d;
            label.hidden = false;
            label.classList.toggle('night', night);
            label.innerHTML = `<span class="clock-mark-dot"></span>${pad2(p.h)}:${pad2(p.min)}${sameDay ? '' : ` ${p.wd}`} · ${night ? 'night' : 'day'}`
                + '<button type="button" class="clock-mark-clear" title="Remove the red marker" aria-label="Remove the red marker">&times;</button>';
        });
    }

    // Where on the clock was clicked → that time of day on the 24-hour ring (the nearest such moment, ± 12 h from now)
    function markFromPointer(card, e) {
        const face = card.querySelector('.clock-face');
        const r = face.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        const dayMin = (Math.round(deg * 4 / 5) * 5) % 1440; // 24 hours = 360°, snap to 5 min
        const c = clockInfo(card.dataset.clockId);
        const now = new Date();
        const p = zoneParts(c.tz, now);
        let delta = dayMin - (p.h * 60 + p.min);
        if (delta > 720) delta -= 1440;
        if (delta <= -720) delta += 1440;
        clockMark = new Date(now.getTime() - p.s * 1000 - now.getMilliseconds() + delta * 60000);
        updateClockMarks();
    }

    let markDrag = null;
    $('clockGrid').addEventListener('pointerdown', (e) => {
        const face = e.target.closest('.clock-face');
        if (!face || e.button > 0) return;
        const card = face.closest('.clock-card');
        e.preventDefault();
        markDrag = { card, id: e.pointerId };
        try { face.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        markFromPointer(card, e);
    });
    $('clockGrid').addEventListener('pointermove', (e) => {
        if (markDrag && e.pointerId === markDrag.id) markFromPointer(markDrag.card, e);
    });
    const endMarkDrag = (e) => { if (markDrag && e.pointerId === markDrag.id) markDrag = null; };
    $('clockGrid').addEventListener('pointerup', endMarkDrag);
    $('clockGrid').addEventListener('pointercancel', endMarkDrag);

    let lastSunDay = '';
    function updateClocks(now = new Date(), force = false) {
        const localOffset = -now.getTimezoneOffset();
        const dayStamp = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
        const sunNeeded = force || dayStamp !== lastSunDay;
        lastSunDay = dayStamp;
        document.querySelectorAll('#clockGrid .clock-card[data-clock-id]').forEach((card) => {
            const c = clockInfo(card.dataset.clockId);
            if (!c) return;
            const p = zoneParts(c.tz, now);
            const set = (cls, deg) => card.querySelector(cls).setAttribute('transform', `rotate(${deg.toFixed(2)} 50 50)`);
            set('.hand.hour', (p.h % 12) * 30 + p.min * 0.5 + p.s / 120);
            set('.hand.minute', p.min * 6 + p.s * 0.1);
            set('.hand.second', p.s * 6);
            card.querySelector('.clock-digital').textContent = `${pad2(p.h)}:${pad2(p.min)}:${pad2(p.s)}`;
            card.querySelector('.clock-date').textContent = `${p.wd} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
            if (!sunNeeded) return;
            const diff = zoneOffset(c.tz, now) - localOffset;
            const h = Math.trunc(diff / 60), m = Math.abs(diff % 60);
            card.querySelector('.clock-diff').textContent = c.local ? 'This device' : diff === 0 ? 'Same time as you'
                : `${diff > 0 ? '+' : '−'}${Math.abs(h)}${m ? `:${pad2(m)}` : ''} h`;
            let sunText = '', isDay = p.h >= 7 && p.h < 19;
            if (c.lat !== null && c.lat !== undefined) {
                const sun = sunTimes(c.lat, c.lon, p.y, p.m, p.d);
                if (sun.polar === 'day') { sunText = '☀️ Sun up all day'; isDay = true; }
                else if (sun.polar === 'night') { sunText = '🌙 Sun down all day'; isDay = false; }
                else {
                    sunText = `🌅 ${zoneHM(c.tz, sun.rise)} · 🌇 ${zoneHM(c.tz, sun.set)}`;
                    isDay = now >= sun.rise && now < sun.set;
                }
            }
            card.querySelector('.clock-sun').textContent = sunText;
            updateRing(card, c, now);
            card.querySelector('.clock-sun').title = sunText ? 'Sunrise · sunset today (local time there)' : '';
            card.classList.toggle('night', !isDay);
        });
    }

    let clockTimer = null;
    function setCalendarMode(mode) {
        state.prefs.calendarMode = mode === 'clock' ? 'clock' : 'calendar';
        savePrefs();
        applyCalendarMode();
    }
    function applyCalendarMode() {
        const clock = state.prefs.calendarMode === 'clock' && state.prefs.activeTab === 'calendar';
        const inCal = state.prefs.calendarMode === 'clock';
        $('calendarPane').hidden = inCal;
        $('clockPane').hidden = !inCal;
        $('calPrev').hidden = inCal;
        $('calNext').hidden = inCal;
        $('calendarMonth').textContent = inCal ? 'World clocks' : $('calendarMonth').textContent;
        $('clockToggle').innerHTML = inCal ? '📅 Calendar' : '🕐 Clock';
        $('clockToggle').title = inCal ? 'Back to the calendar' : 'World clocks';
        clearInterval(clockTimer);
        clockTimer = null;
        if (clock) {
            renderClocks();
            // tick right on the second
            setTimeout(() => {
                updateClocks();
                if (state.prefs.calendarMode === 'clock' && state.prefs.activeTab === 'calendar' && !clockTimer) {
                    clockTimer = setInterval(() => { if (!document.hidden) updateClocks(); }, 1000);
                }
            }, 1000 - (Date.now() % 1000));
        } else if (!inCal) {
            renderCalendar();
        }
    }
    $('clockToggle').addEventListener('click', () => setCalendarMode(state.prefs.calendarMode === 'clock' ? 'calendar' : 'clock'));

    $('clockGrid').addEventListener('click', (e) => {
        if (e.target.closest('#clockAdd')) { openClockPicker(); return; }
        if (e.target.closest('.clock-mark-clear')) { clockMark = null; updateClockMarks(); return; }
        const remove = e.target.closest('.clock-remove');
        if (remove) {
            const id = remove.closest('.clock-card').dataset.clockId;
            state.prefs.clocks = clockIds().filter((x) => x !== id);
            savePrefs();
            renderClocks();
        }
    });

    function openClockPicker() {
        $('clockSearch').value = '';
        renderClockPicker();
        openModal('clockModal');
        if (!isMobile()) setTimeout(() => $('clockSearch').focus(), 30);
    }
    function renderClockPicker() {
        const q = $('clockSearch').value.trim().toLowerCase();
        const have = new Set(clockIds());
        const list = CLOCK_CITIES.filter((c) => !q || `${c.name} ${c.country}`.toLowerCase().includes(q));
        const now = new Date();
        $('clockCityList').innerHTML = list.length ? list.map((c) => `
            <button class="clock-city${have.has(c.id) ? ' added' : ''}" type="button" data-city="${c.id}" ${have.has(c.id) ? 'disabled' : ''}>
                <span><b>${escapeHtml(c.name)}</b> <span class="clock-city-country">${escapeHtml(c.country)}</span></span>
                <span class="clock-city-time">${have.has(c.id) ? 'Added' : zoneHM(c.tz, now)}</span>
            </button>`).join('') : '<div class="calendar-hint">No city found.</div>';
    }
    $('clockSearch').addEventListener('input', renderClockPicker);
    $('clockSearch').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = $('clockCityList').querySelector('.clock-city:not([disabled])');
        if (first) first.click();
    });
    $('clockCityList').addEventListener('click', (e) => {
        const btn = e.target.closest('.clock-city');
        if (!btn || btn.disabled) return;
        state.prefs.clocks = clockIds().concat(btn.dataset.city);
        savePrefs();
        closeModals();
        renderClocks();
    });
    $('clockClose').addEventListener('click', closeModals);
    $('clockBackdrop').addEventListener('click', closeModals);

    /* settings window: which holidays to show */
    $('holidayOptions').innerHTML = HOLIDAY_SETS.map((s) =>
        `<label class="check-row holiday-option"><input type="checkbox" value="${s.code}"> ${s.label}</label>`
    ).join('');

    function syncHolidayCheckboxes() {
        const on = Array.isArray(state.prefs.holidays) ? state.prefs.holidays : [];
        $('holidayOptions').querySelectorAll('input').forEach((input) => { input.checked = on.includes(input.value); });
    }

    $('holidayOptions').addEventListener('change', () => {
        state.prefs.holidays = [...$('holidayOptions').querySelectorAll('input:checked')].map((el) => el.value);
        savePrefs();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });



    $('calendarGrid').addEventListener('click', (e) => {
        const chip = e.target.closest('.calendar-chip');
        // on a phone the labels fill the whole day, so a tap selects the day (open notes from the list below)
        if (chip && !isMobile()) {
            setTab('note');
            selectNote(chip.dataset.noteId);
            return;
        }
        const cell = e.target.closest('.calendar-day');
        if (!cell) return;
        const [y, m, d] = cell.dataset.date.split('-').map(Number);
        state.calendarDay = new Date(y, m - 1, d);
        renderCalendar();
    });

    // Dragging a note that is already on the calendar (from a day cell or the day panel)
    let draggedCalendarNote = null; // { noteId, fromKey }

    function startCalendarDrag(e, noteId, fromKey) {
        draggedCalendarNote = { noteId, fromKey };
        e.dataTransfer.setData('text/plain', noteId);
        e.dataTransfer.effectAllowed = 'move';
    }

    $('calendarGrid').addEventListener('dragstart', (e) => {
        const chip = e.target.closest('.calendar-chip');
        if (!chip) return;
        startCalendarDrag(e, chip.dataset.noteId, chip.closest('.calendar-day').dataset.date);
    });
    $('calendarDayNotes').addEventListener('dragstart', (e) => {
        const item = e.target.closest('.calendar-note-item');
        if (!item || !state.calendarDay) return;
        startCalendarDrag(e, item.dataset.noteId, dayKey(state.calendarDay));
    });
    document.addEventListener('dragend', () => {
        draggedCalendarNote = null;
        document.querySelectorAll('.calendar-day.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });

    // Move a note from one day to another, keeping its time. For a repeating
    // note the whole series (start date and end date) shifts by the same number of days.
    function moveNoteToDay(noteId, fromKey, toKey) {
        const note = noteById(noteId);
        const base = note && parseDate(note.scheduledAt);
        if (!base || fromKey === toKey) return;
        const from = keyToDate(fromKey), to = keyToDate(toKey);
        const diff = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
            Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);
        const moved = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff,
            base.getHours(), base.getMinutes(), base.getSeconds());
        note.scheduledAt = toLocalIso(moved);
        if (note.repeatEndDate) {
            const end = keyToDate(note.repeatEndDate);
            note.repeatEndDate = dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() + diff));
        }
        resetAlarmRuntime(note);
        touch(note);
        state.calendarDay = to;
        renderTree();
        renderCalendar();
        if (note.id === state.currentNoteId) updateScheduleUi(note);
        toast(`Moved to ${to.getDate()} ${MONTHS[to.getMonth()]}`);
    }

    $('calendarGrid').addEventListener('dragover', (e) => {
        const cell = e.target.closest('.calendar-day');
        if (!cell) return;
        if (!draggedTreeNoteId && !Array.from(e.dataTransfer.types || []).includes('text/plain')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
    });

    $('calendarGrid').addEventListener('dragleave', (e) => {
        const cell = e.target.closest('.calendar-day');
        if (!cell) return;
        const related = e.relatedTarget;
        if (related && cell.contains(related)) return;
        cell.classList.remove('drag-over');
    });

    $('calendarGrid').addEventListener('drop', (e) => {
        const cell = e.target.closest('.calendar-day');
        if (!cell) return;
        e.preventDefault();
        cell.classList.remove('drag-over');
        if (draggedCalendarNote) {
            const { noteId, fromKey } = draggedCalendarNote;
            draggedCalendarNote = null;
            moveNoteToDay(noteId, fromKey, cell.dataset.date);
            return;
        }
        const noteId = e.dataTransfer.getData('text/plain') || draggedTreeNoteId;
        if (!noteId) return;
        openPlanFromTreeModal(noteId, keyToDate(cell.dataset.date));
        draggedTreeNoteId = null;
    });

    // Take a note (and its alarm) off a date. The note itself is kept.
    // For a repeating note you choose: skip only this day, or remove the whole series.
    async function removeFromDate(noteId, day) {
        const note = noteById(noteId);
        if (!note || !day) return;
        const title = note.title.trim() || 'Untitled';
        const dateLabel = `${day.getDate()} ${MONTHS[day.getMonth()]}`;
        let choice;
        if (isRecurring(note)) {
            choice = await askDialog({
                title: 'Remove from date',
                message: `"${title}" repeats. Remove it only from ${dateLabel}, or remove the whole repeating schedule?`,
                okLabel: 'Only this day',
                altLabel: 'Whole series'
            });
            if (!choice) return;
        } else {
            choice = await askConfirm('Remove from date', `Remove "${title}" (and its alarm) from ${dateLabel}? The note itself is kept.`, 'Remove');
            if (!choice) return;
            choice = 'alt';
        }
        if (!noteById(noteId)) return;
        if (choice === 'alt') {
            note.scheduledAt = null;
            note.alarmEnabled = false;
            note.emailEnabled = false;
            note.repeatWeekdays = [];
            note.repeatMode = 'none';
            note.repeatEndDate = '';
            note.skipDates = [];
        } else {
            note.skipDates = [...new Set([...(note.skipDates || []), dayKey(day)])].sort();
        }
        resetAlarmRuntime(note);
        touch(note);
        renderTree();
        renderCalendar();
        if (note.id === state.currentNoteId) updateScheduleUi(note);
        toast(choice === 'alt' ? `Removed "${title}" from the calendar` : `Skipped "${title}" on ${dateLabel}`);
    }

    /* ---- pick an existing note for the selected day (same as dragging it onto the day) ---- */
    function openNotePicker() {
        const day = state.calendarDay;
        if (!day) return;
        $('notePickerTitle').textContent = `Add a note to ${day.getDate()} ${MONTHS[day.getMonth()]}`;
        $('notePickerSearch').value = '';
        renderNotePicker();
        openModal('notePickerModal');
        if (!isMobile()) setTimeout(() => $('notePickerSearch').focus(), 30);
    }

    function renderNotePicker() {
        const q = $('notePickerSearch').value.trim().toLowerCase();
        const match = (n) => !q || (n.title || '').toLowerCase().includes(q) || (!n.private && (n.content || '').toLowerCase().includes(q));
        const groups = [...folderTree().map(({ folder: f }) => ({ name: folderPath(f.id), notes: sortedNotes(state.notes.filter((n) => n.folderId === f.id)) })),
            { name: 'No folder', notes: sortedNotes(state.notes.filter((n) => !n.folderId)) }]
            .map((g) => ({ ...g, notes: g.notes.filter(match) }))
            .filter((g) => g.notes.length);
        const day = state.calendarDay;
        $('notePickerList').innerHTML = groups.length ? groups.map((g) => `
            <div class="picker-group">${escapeHtml(g.name)}</div>
            ${g.notes.map((n) => {
                const onDay = day && occurrenceOn(n, day);
                const when = n.scheduledAt
                    ? (isRecurring(n) ? `↻ ${repeatSummary(n)}` : `📅 ${formatDateTime(n.scheduledAt)}`)
                    : 'Not scheduled';
                return `<button type="button" class="picker-item${onDay ? ' on-day' : ''}" data-note-id="${n.id}">
                    <span class="picker-dot" style="${n.color ? `background:${n.color}` : ''}"></span>
                    <span class="picker-text">
                        <span class="picker-title">${escapeHtml(n.title.trim() || 'Untitled')}</span>
                        <span class="picker-meta">${escapeHtml(onDay ? 'Already on this day' : when)}</span>
                    </span>
                </button>`;
            }).join('')}`).join('')
            : `<div class="calendar-hint">${q ? 'No notes match your search.' : 'You have no notes yet.'}</div>`;
    }

    $('notePickerSearch').addEventListener('input', renderNotePicker);
    $('notePickerList').addEventListener('click', (e) => {
        const item = e.target.closest('.picker-item');
        if (!item || !state.calendarDay) return;
        $('notePickerModal').classList.remove('active');
        openPlanFromTreeModal(item.dataset.noteId, state.calendarDay);
    });
    $('notePickerClose').addEventListener('click', closeModals);
    $('notePickerBackdrop').addEventListener('click', closeModals);

    $('calendarDayNotes').addEventListener('click', (e) => {
        if (e.target.closest('#calendarPickNote')) { openNotePicker(); return; }
        if (e.target.closest('#calendarAddNote')) {
            const d = state.calendarDay;
            if (!d) return;
            newNote({ scheduledAt: toLocalIso(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0)) });
            toast(`New note on ${d.getDate()} ${MONTHS[d.getMonth()]} – give it a title`);
            return;
        }
        const calMore = e.target.closest('.cal-more');
        if (calMore) {
            const note = noteById(calMore.dataset.noteId);
            const day = state.calendarDay;
            if (!note) return;
            showActionSheet(note.title.trim() || 'Untitled', [
                { label: 'Open note', run: () => { setTab('note'); selectNote(note.id); } },
                { label: 'Change date / time…', run: () => openPlanFromTreeModal(note.id, day || new Date()) },
                { label: 'Remove from date', run: () => removeFromDate(note.id, day) },
                { label: 'Rename', run: () => renameNote(note.id) },
                { label: 'Delete', danger: true, run: () => deleteNote(note.id) }
            ]);
            return;
        }
        const unschedule = e.target.closest('.note-unschedule');
        if (unschedule) { removeFromDate(unschedule.dataset.noteId, state.calendarDay); return; }
        const rename = e.target.closest('.note-rename');
        if (rename) { renameNote(rename.dataset.noteId); return; }
        const del = e.target.closest('.note-delete');
        if (del) { deleteNote(del.dataset.noteId); return; }
        const item = e.target.closest('.calendar-note-item');
        if (!item) return;
        setTab('note');
        selectNote(item.dataset.noteId);
    });

    const planModal = $('planFromTreeModal');
    const planBackdrop = $('planFromTreeBackdrop');
    const planClose = $('planFromTreeClose');
    const planCancel = $('planFromTreeCancel');
    let pendingPlan = null;

    $('weekdayOptions').innerHTML = WEEKDAY_SHORT.map((letter, index) =>
        `<label class="weekday-chip" title="${WEEKDAY_FULL[index]}"><input type="checkbox" value="${index}" aria-label="${WEEKDAY_FULL[index]}"><span>${letter}</span></label>`
    ).join('');
    $('advancedSettingsToggle').addEventListener('click', () => {
        const panel = $('advancedSettings');
        panel.hidden = !panel.hidden;
        $('advancedSettingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
    });

    // Fill the Repeat dropdown with options that match the chosen date
    function refreshRepeatOptions(selected) {
        const select = $('repeatMode');
        const value = selected || select.value || 'none';
        const date = $('planFromTreeDate').value;
        const base = date ? keyToDate(date) : new Date();
        const checked = [...$('weekdayOptions').querySelectorAll('input:checked')].map((el) => Number(el.value));
        const modes = ['none', 'weekly', 'monthlyDate', 'monthlyWeekday'];
        if (isLastWeekdayOfMonth(base)) modes.push('monthlyLastWeekday');
        modes.push('yearly');
        let pick = value;
        if (!modes.includes(pick)) pick = pick === 'monthlyLastWeekday' ? 'monthlyWeekday' : 'none';
        select.innerHTML = modes.map((m) =>
            `<option value="${m}">${escapeHtml(repeatLabel(m, base, checked))}</option>`).join('');
        select.value = pick;
        $('weeklyOptions').hidden = pick !== 'weekly';
        $('repeatEndRow').hidden = pick === 'none';
    }

    $('repeatMode').addEventListener('change', () => {
        if ($('repeatMode').value === 'weekly' && !$('weekdayOptions').querySelector('input:checked')) {
            // start with the weekday of the chosen date
            const date = $('planFromTreeDate').value;
            const idx = ((date ? keyToDate(date) : new Date()).getDay() + 6) % 7;
            const box = $('weekdayOptions').querySelector(`input[value="${idx}"]`);
            if (box) box.checked = true;
        }
        refreshRepeatOptions($('repeatMode').value);
    });
    $('planFromTreeDate').addEventListener('change', () => refreshRepeatOptions());
    $('weekdayOptions').addEventListener('change', () => refreshRepeatOptions());

    function openPlanFromTreeModal(noteId, day) {
        const note = noteById(noteId);
        if (!note) return;
        pendingPlan = { noteId, day: new Date(day.getFullYear(), day.getMonth(), day.getDate()) };
        $('planFromTreeNoteTitle').textContent = note.title.trim() || 'Untitled';
        const existing = parseDate(note.scheduledAt);
        let timeStr = '09:00:00';
        if (existing && sameDay(existing, day)) {
            timeStr = `${pad(existing.getHours())}:${pad(existing.getMinutes())}:${pad(existing.getSeconds())}`;
        } else if (existing) {
            timeStr = `${pad(existing.getHours())}:${pad(existing.getMinutes())}:${pad(existing.getSeconds())}`;
        }
        $('planFromTreeDate').value = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        $('planFromTreeTime').value = timeStr;
        $('planFromTreeAlarm').checked = note.alarmEnabled;
        $('planFromTreeSnooze').value = note.alarmSnoozeMinutes || 5;
        $('planFromTreeSnoozeLabel').textContent = $('planFromTreeSnooze').value;
        $('advancedSettings').hidden = !isRecurring(note);
        $('advancedSettingsToggle').setAttribute('aria-expanded', String(isRecurring(note)));
        $('weekdayOptions').querySelectorAll('input').forEach((input) => {
            input.checked = (note.repeatWeekdays || []).includes(Number(input.value));
        });
        $('repeatEndDate').value = note.repeatEndDate || '';
        refreshRepeatOptions(repeatModeOf(note));
        pendingPlan.color = note.color || '';
        pendingPlan.email = { enabled: !!note.emailEnabled, to: note.emailTo || '' };
        renderPlanExtras();
        planModal.classList.add('active');
    }

    function renderPlanExtras() {
        if (!pendingPlan) return;
        renderColorPicker($('planNoteColors'), pendingPlan.color, true, 'planColorCustom');
        $('planEmailEnabled').checked = pendingPlan.email.enabled;
        $('planEmailLabel').textContent = pendingPlan.email.enabled && pendingPlan.email.to ? `→ ${pendingPlan.email.to}` : '';
    }

    function planEmailTarget() {
        const note = pendingPlan && noteById(pendingPlan.noteId);
        if (!note) return null;
        return {
            note,
            isPlan: true,
            address: () => pendingPlan.email.to,
            enabled: () => pendingPlan.email.enabled,
            save(address) { pendingPlan.email = { enabled: true, to: address }; },
            off() { if (pendingPlan) pendingPlan.email.enabled = false; },
            sync() { renderPlanExtras(); }
        };
    }

    $('planNoteColors').addEventListener('click', (e) => {
        const btn = e.target.closest('button.note-color');
        if (!btn || !pendingPlan) return;
        pendingPlan.color = btn.dataset.color;
        renderPlanExtras();
    });
    $('planNoteColors').addEventListener('change', (e) => {
        if (e.target.id !== 'planColorCustom' || !pendingPlan) return;
        pendingPlan.color = e.target.value.toLowerCase();
        renderPlanExtras();
    });
    $('planEmailEnabled').addEventListener('change', () => {
        if (!pendingPlan) return;
        if ($('planEmailEnabled').checked) {
            const address = pendingPlan.email.to || defaultEmail();
            if (!address) { openEmailModal(planEmailTarget()); return; }
            pendingPlan.email = { enabled: true, to: address };
        } else {
            pendingPlan.email.enabled = false;
        }
        renderPlanExtras();
    });
    $('planEmailLink').addEventListener('click', () => openEmailModal(planEmailTarget()));

    function closePlanFromTreeModal() {
        planModal.classList.remove('active');
        pendingPlan = null;
    }

    planBackdrop.addEventListener('click', closePlanFromTreeModal);
    planClose.addEventListener('click', closePlanFromTreeModal);
    planCancel.addEventListener('click', closePlanFromTreeModal);

    $('planFromTreeSnooze').addEventListener('input', () => {
        $('planFromTreeSnoozeLabel').textContent = $('planFromTreeSnooze').value;
    });

    $('planFromTreeSave').addEventListener('click', () => {
        if (!pendingPlan) return;
        const note = noteById(pendingPlan.noteId);
        if (!note) return;
        const date = $('planFromTreeDate').value;
        const time = $('planFromTreeTime').value || '00:00:00';
        const endDate = $('repeatEndDate').value;
        if (endDate && date && endDate < date) {
            toast('End date is before the start date');
            return;
        }
        if (date) {
            const parts = time.split(':');
            const dt = new Date(`${date}T${pad(parts[0] || 0)}:${pad(parts[1] || 0)}:${pad(parts[2] || 0)}`);
            note.scheduledAt = isNaN(dt.getTime()) ? null : toLocalIso(dt);
        } else {
            note.scheduledAt = null;
        }
        note.alarmEnabled = $('planFromTreeAlarm').checked;
        note.alarmSnoozeMinutes = Number($('planFromTreeSnooze').value);
        const mode = $('repeatMode').value;
        const weekdays = [...$('weekdayOptions').querySelectorAll('input:checked')].map((el) => Number(el.value));
        if (mode === 'weekly' && !weekdays.length) {
            toast('Pick at least one weekday');
            return;
        }
        note.repeatMode = REPEAT_MODES.includes(mode) ? mode : 'none';
        note.repeatWeekdays = mode === 'weekly' ? weekdays : [];
        note.repeatEndDate = mode === 'none' ? '' : $('repeatEndDate').value;
        note.color = /^#[0-9a-f]{6}$/i.test(pendingPlan.color || '') ? pendingPlan.color : '';
        note.emailEnabled = !!(pendingPlan.email.enabled && pendingPlan.email.to);
        note.emailTo = pendingPlan.email.to || note.emailTo || '';
        resetAlarmRuntime(note);
        touch(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') {
            state.calendarDay = new Date(pendingPlan.day.getFullYear(), pendingPlan.day.getMonth(), pendingPlan.day.getDate());
            renderCalendar();
        }
        closePlanFromTreeModal();
        if (note.id === state.currentNoteId) updateScheduleUi(note);
        toast(isRecurring(note) ? `Scheduled · ${repeatSummary(note)}` : 'Note scheduled');
    });

    $('calPrev').addEventListener('click', () => {
        state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() - 1, 1);
        renderCalendar();
    });

    $('calNext').addEventListener('click', () => {
        state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + 1, 1);
        renderCalendar();
    });

    /* ---------------- zoom (pinch on phone, Ctrl + scroll on computer) ---------------- */

    // Two fingers = zoom/move, one finger = draw. `content` (the canvas) is
    // scaled with a CSS transform inside `viewport`.
    function createZoom(viewport, content, onPinchStart, onChange) {
        const z = { scale: 1, tx: 0, ty: 0 };
        const MAX = 8;
        const touches = new Map();
        let pinch = null;
        let lock = false; // stays on until all fingers are lifted, so a pinch never draws
        const resetBtn = viewport.querySelector('.zoom-reset');

        function apply() {
            const w = viewport.clientWidth;
            const h = content.offsetHeight;
            z.scale = Math.min(MAX, Math.max(1, z.scale));
            if (z.scale <= 1.001) { z.scale = 1; z.tx = 0; z.ty = 0; }
            z.tx = Math.min(0, Math.max(w - w * z.scale, z.tx));
            z.ty = Math.min(0, Math.max(h - h * z.scale, z.ty));
            content.style.transform = z.scale === 1 ? '' : `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`;
            if (resetBtn) resetBtn.hidden = z.scale === 1;
            if (onChange) onChange(z);
        }

        function local(e) {
            const r = viewport.getBoundingClientRect();
            return { x: e.clientX - r.left - viewport.clientLeft, y: e.clientY - r.top - viewport.clientTop };
        }

        function pinchInfo() {
            const [a, b] = [...touches.values()];
            return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
        }

        function startPinch() {
            const { mid, dist } = pinchInfo();
            pinch = { s0: z.scale, tx0: z.tx, ty0: z.ty, mid0: mid, d0: dist };
        }

        // Middle mouse button: drag to move around while zoomed in (never draws)
        let pan = null;
        viewport.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 1) return;
            e.stopPropagation();
            e.preventDefault();
            if (z.scale <= 1) return;
            pan = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: z.tx, ty: z.ty };
            try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            viewport.classList.add('panning');
        }, true);
        viewport.addEventListener('pointermove', (e) => {
            if (!pan || e.pointerId !== pan.id) return;
            e.stopPropagation();
            e.preventDefault();
            z.tx = pan.tx + (e.clientX - pan.x);
            z.ty = pan.ty + (e.clientY - pan.y);
            apply();
        }, true);
        const endPan = (e) => {
            if (!pan || e.pointerId !== pan.id) return;
            e.stopPropagation();
            pan = null;
            viewport.classList.remove('panning');
        };
        viewport.addEventListener('pointerup', endPan, true);
        viewport.addEventListener('pointercancel', endPan, true);
        // no auto-scroll circle / paste-on-middle-click in the drawing area
        viewport.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
        viewport.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

        // capture phase: runs before the canvas' own drawing handlers
        viewport.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            touches.set(e.pointerId, local(e));
            if (touches.size >= 2) {
                e.stopPropagation();
                e.preventDefault();
                if (!lock && onPinchStart) onPinchStart();
                lock = true;
                startPinch();
            } else if (lock) {
                e.stopPropagation();
            }
        }, true);

        viewport.addEventListener('pointermove', (e) => {
            if (!touches.has(e.pointerId)) return;
            touches.set(e.pointerId, local(e));
            if (!lock) return;
            e.stopPropagation();
            e.preventDefault();
            if (pinch && touches.size >= 2) {
                const { mid, dist } = pinchInfo();
                const s = Math.min(MAX, Math.max(1, pinch.s0 * dist / pinch.d0));
                const px = (pinch.mid0.x - pinch.tx0) / pinch.s0;
                const py = (pinch.mid0.y - pinch.ty0) / pinch.s0;
                z.scale = s;
                z.tx = mid.x - px * s;
                z.ty = mid.y - py * s;
                apply();
            }
        }, true);

        const up = (e) => {
            if (!touches.has(e.pointerId)) return;
            touches.delete(e.pointerId);
            if (lock) e.stopPropagation();
            if (touches.size >= 2) startPinch();
            else pinch = null;
            if (touches.size === 0) lock = false;
        };
        viewport.addEventListener('pointerup', up, true);
        viewport.addEventListener('pointercancel', up, true);

        viewport.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const p = local(e);
                const s0 = z.scale;
                const s = Math.min(MAX, Math.max(1, s0 * Math.exp(-e.deltaY * 0.0025)));
                z.tx = p.x - (p.x - z.tx) * (s / s0);
                z.ty = p.y - (p.y - z.ty) * (s / s0);
                z.scale = s;
                apply();
            } else if (z.scale > 1) {
                e.preventDefault();
                z.tx -= e.deltaX;
                z.ty -= e.deltaY;
                apply();
            }
        }, { passive: false });

        if (resetBtn) resetBtn.addEventListener('click', () => { z.scale = 1; apply(); });

        return { apply, reset() { z.scale = 1; apply(); }, isPinching: () => lock };
    }

    // Sharper canvases (and still sharp-ish when zoomed in)
    function backingScale(cssWidth) {
        const k = Math.min(3, Math.max(1.5, (window.devicePixelRatio || 1) * 1.5));
        return Math.min(k, 3200 / Math.max(1, cssWidth));
    }

    /* ---------------- tekenen ---------------- */

    const canvas = $('drawCanvas');
    const ctx = canvas.getContext('2d');
    const drawContainer = $('drawContainer');

    function fitCanvas() {
        if (!drawContainer || drawContainer.style.display === 'none') return;
        const cssW = Math.max(200, drawContainer.clientWidth);
        const width = Math.round(cssW * backingScale(cssW));
        const height = Math.round(width * 0.75);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            renderStrokes();
        }
        drawZoom.apply();
    }

    // A pinch started while the first finger was drawing: drop that stroke
    function cancelStroke() {
        if (state.draw.drawing && state.draw.current) {
            const i = state.draw.strokes.indexOf(state.draw.current);
            if (i >= 0) state.draw.strokes.splice(i, 1);
        }
        state.draw.drawing = false;
        state.draw.current = null;
        renderStrokes();
    }
    const drawZoom = createZoom(drawContainer, canvas, cancelStroke);

    function renderStrokes() {
        const note = noteById(state.currentNoteId);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = note ? (note.canvasBackground || DEFAULT_CANVAS_BG) : DEFAULT_CANVAS_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        state.draw.strokes.forEach((item) => drawStroke(item));
        drawSelectionFrame();
        drawPickFrame();
    }

    // draws one item; by default on the drawing itself, or on another canvas (g, size W×H, shifted by ox/oy)
    function drawStroke(stroke, g = ctx, W = canvas.width, H = canvas.height, ox = 0, oy = 0) {
        if (stroke.image) {
            const img = drawImageEl(stroke.image);
            if (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth)) {
                g.drawImage(img, ox + stroke.x * W, oy + stroke.y * H, stroke.w * W, stroke.h * H);
            }
            return;
        }
        if (!stroke.points.length) return;
        g.strokeStyle = stroke.color || '#000000';
        g.lineWidth = Math.max(1, (stroke.thicknessRatio || 0.006) * W);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        const first = stroke.points[0];
        g.moveTo(ox + first.x * W, oy + first.y * H);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = stroke.points[i];
            g.lineTo(ox + p.x * W, oy + p.y * H);
        }
        if (stroke.points.length === 1) {
            g.lineTo(ox + first.x * W + 0.01, oy + first.y * H);
        }
        g.stroke();
    }

    /* ---------------- bucket fill (like in Paint) ----------------
     * Fills the closed area you click on with the current colour. The filled area becomes
     * its own item (a picture with see-through edges), so it can be selected, moved and undone. */
    function bucketFill(pos) {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const W = canvas.width, H = canvas.height;
        // a clean picture of the drawing (no selection frames)
        const off = document.createElement('canvas');
        off.width = W; off.height = H;
        const g = off.getContext('2d', { willReadFrequently: true });
        g.fillStyle = note.canvasBackground || DEFAULT_CANVAS_BG;
        g.fillRect(0, 0, W, H);
        state.draw.strokes.forEach((s) => drawStroke(s, g, W, H));
        const data = g.getImageData(0, 0, W, H).data;
        const sx = Math.min(W - 1, Math.max(0, Math.floor(pos.x * W)));
        const sy = Math.min(H - 1, Math.max(0, Math.floor(pos.y * H)));
        const i0 = (sy * W + sx) * 4;
        const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2];
        const fill = parseInt(state.draw.color.slice(1), 16);
        const fr = (fill >> 16) & 255, fg = (fill >> 8) & 255, fb = fill & 255;
        if (Math.abs(fr - r0) + Math.abs(fg - g0) + Math.abs(fb - b0) < 6) return; // already that colour
        const TOL = 70; // how different a pixel may be and still count as "the same area"
        const same = (p) => { const k = p * 4; return Math.abs(data[k] - r0) + Math.abs(data[k + 1] - g0) + Math.abs(data[k + 2] - b0) <= TOL; };
        const mask = new Uint8Array(W * H);
        const stack = [sy * W + sx];
        let x0 = sx, x1 = sx, y0 = sy, y1 = sy, count = 0;
        // scan-line flood fill
        while (stack.length) {
            const p = stack.pop();
            const y = (p / W) | 0;
            let x = p - y * W;
            while (x > 0 && !mask[y * W + x - 1] && same(y * W + x - 1)) x--;
            let up = false, down = false;
            for (; x < W && !mask[y * W + x] && same(y * W + x); x++) {
                const q = y * W + x;
                mask[q] = 1; count++;
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                if (y > 0) { const a = q - W; if (!mask[a] && same(a)) { if (!up) { stack.push(a); up = true; } } else up = false; }
                if (y < H - 1) { const b = q + W; if (!mask[b] && same(b)) { if (!down) { stack.push(b); down = true; } } else down = false; }
            }
        }
        if (!count) return;
        // grow the area 2 px so it slides under the soft edges of the lines (no light seams)
        const pad = 2;
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const out = document.createElement('canvas');
        out.width = bw; out.height = bh;
        const og = out.getContext('2d');
        const img = og.createImageData(bw, bh);
        const px = img.data;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let on = mask[y * W + x];
                for (let d = 1; !on && d <= pad; d++) {
                    on = (x >= d && mask[y * W + x - d]) || (x + d < W && mask[y * W + x + d])
                        || (y >= d && mask[(y - d) * W + x]) || (y + d < H && mask[(y + d) * W + x]);
                }
                if (!on) continue;
                const k = ((y - y0) * bw + (x - x0)) * 4;
                px[k] = fr; px[k + 1] = fg; px[k + 2] = fb; px[k + 3] = 255;
            }
        }
        og.putImageData(img, 0, 0);
        const item = { image: out.toDataURL('image/png'), x: x0 / W, y: y0 / H, w: bw / W, h: bh / H, points: [], fill: true };
        drawImageCache.set(item.image, out); // draw it right away (no waiting for the picture to load)
        pushDrawUndo();
        // fills go above earlier fills but below the lines drawn after them
        let at = 0;
        state.draw.strokes.forEach((s, i) => { if (s.fill) at = i + 1; });
        state.draw.strokes.splice(at, 0, item);
        renderStrokes();
        flushEditor();
    }

    /* ---------------- select tool: pick parts of the drawing, move / copy / delete them ---------------- */
    let drawPick = [];     // the selected items
    let marquee = null;    // { a, b } while dragging a selection box
    let pickDrag = null;   // while moving the selection
    let drawClipboard = null;
    const COPY_MARK = '[Remindate drawing selection]';

    function cloneItem(s) {
        if (s.image) return { ...s };
        return { color: s.color, thicknessRatio: s.thicknessRatio, points: s.points.map((p) => ({ x: p.x, y: p.y })) };
    }
    function itemBox(s) {
        if (s.image) return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
        const r = (s.thicknessRatio || 0) / 2;
        const ry = r * canvas.width / (canvas.height || 1);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        s.points.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
        return { x0: x0 - r, y0: y0 - ry, x1: x1 + r, y1: y1 + ry };
    }
    function pickBox() {
        if (!drawPick.length) return null;
        return drawPick.map(itemBox).reduce((a, b) => ({
            x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)
        }));
    }
    // the top-most item under a point (pen lines count when you are close to them)
    function itemAt(pos) {
        const tol = 10 / (canvas.clientWidth || 1);
        for (let i = state.draw.strokes.length - 1; i >= 0; i--) {
            const s = state.draw.strokes[i];
            if (s.image) {
                if (pos.x >= s.x && pos.x <= s.x + s.w && pos.y >= s.y && pos.y <= s.y + s.h) return s;
            } else {
                const r = (s.thicknessRatio || 0) / 2 + tol;
                if (s.points.some((p) => Math.hypot(p.x - pos.x, (p.y - pos.y) * canvas.height / canvas.width) <= r)) return s;
            }
        }
        return null;
    }

    function updatePickBar() {
        const show = state.draw.tool === 'select' && drawPick.length > 0;
        $('pickActions').hidden = !show;
        if (show) $('pickCount').textContent = drawPick.length === 1 ? '1 selected' : `${drawPick.length} selected`;
    }

    function drawPickFrame() {
        drawPick = drawPick.filter((s) => state.draw.strokes.includes(s));
        const W = canvas.width, H = canvas.height;
        const px = W / (canvas.clientWidth || W);
        ctx.save();
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        const box = pickBox();
        if (box) {
            const pad = 6 * px;
            ctx.strokeStyle = '#7c6ff0';
            ctx.fillStyle = 'rgba(124,111,240,.08)';
            ctx.fillRect(box.x0 * W - pad, box.y0 * H - pad, (box.x1 - box.x0) * W + 2 * pad, (box.y1 - box.y0) * H + 2 * pad);
            ctx.strokeRect(box.x0 * W - pad, box.y0 * H - pad, (box.x1 - box.x0) * W + 2 * pad, (box.y1 - box.y0) * H + 2 * pad);
            // handle at the bottom-right corner: drag it to make the selection bigger / smaller
            if (!marquee) {
                const hs = 14 * px, cx = box.x1 * W + pad, cy = box.y1 * H + pad;
                ctx.setLineDash([]);
                ctx.fillStyle = '#7c6ff0';
                ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(cx - hs / 4, cy - hs / 4, hs / 2, hs / 2);
            }
        }
        if (marquee) {
            ctx.strokeStyle = '#a5b4fc';
            ctx.fillStyle = 'rgba(165,180,252,.12)';
            const x = Math.min(marquee.a.x, marquee.b.x) * W, y = Math.min(marquee.a.y, marquee.b.y) * H;
            const w = Math.abs(marquee.b.x - marquee.a.x) * W, h = Math.abs(marquee.b.y - marquee.a.y) * H;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        }
        ctx.restore();
        updatePickBar();
    }

    // is the pointer on the resize handle (bottom-right corner of the selection)?
    function onScaleHandle(pos, box) {
        if (!box) return false;
        const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
        const cx = box.x1 + 6 / cw, cy = box.y1 + 6 / ch;
        return Math.abs(pos.x - cx) * cw <= 12 && Math.abs(pos.y - cy) * ch <= 12;
    }

    function startPick(e) {
        const pos = pointerPos(e, true);
        try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* ignore */ }
        const box = pickBox();
        if (onScaleHandle(pos, box)) {
            // resize: change copies, so Ctrl+Z gets the old size back
            pushDrawUndo();
            const copies = new Map(drawPick.map((s) => [s, cloneItem(s)]));
            state.draw.strokes = state.draw.strokes.map((s) => copies.get(s) || s);
            drawPick = [...copies.values()];
            pickDrag = { scale: true, start: pos, box, orig: drawPick.map(cloneItem), moved: false };
            canvas.style.cursor = 'nwse-resize';
            return;
        }
        const pad = 6 / (canvas.clientWidth || 1);
        const inBox = box && pos.x >= box.x0 - pad && pos.x <= box.x1 + pad && pos.y >= box.y0 - pad && pos.y <= box.y1 + pad;
        const hit = inBox ? null : itemAt(pos);
        if (!inBox && hit) drawPick = [hit]; // press on an item: select it and move it right away
        if (inBox || hit) {
            // move: change copies, so Ctrl+Z gets the old place back
            pushDrawUndo();
            const copies = new Map(drawPick.map((s) => [s, cloneItem(s)]));
            state.draw.strokes = state.draw.strokes.map((s) => copies.get(s) || s);
            drawPick = [...copies.values()];
            pickDrag = { start: pos, orig: drawPick.map(cloneItem), moved: false };
            canvas.style.cursor = 'move';
            renderStrokes();
            return;
        }
        drawPick = [];
        marquee = { a: pos, b: pos };
        renderStrokes();
    }

    function movePick(e) {
        const pos = pointerPos(e, true);
        if (pickDrag && pickDrag.scale) {
            e.preventDefault();
            const { box, start, orig } = pickDrag;
            const bw = Math.max(box.x1 - box.x0, 0.001), bh = Math.max(box.y1 - box.y0, 0.001);
            // same factor for width and height (keeps the shape); never smaller than 3% of the canvas
            let f = Math.max((bw + pos.x - start.x) / bw, (bh + pos.y - start.y) / bh);
            f = Math.max(f, 0.03 / Math.max(bw, bh));
            if (Math.abs(f - 1) > 0.002) pickDrag.moved = true;
            const ax = box.x0, ay = box.y0; // the top-left corner stays put
            drawPick.forEach((s, i) => {
                const o = orig[i];
                if (s.image) {
                    s.x = ax + (o.x - ax) * f; s.y = ay + (o.y - ay) * f; s.w = o.w * f; s.h = o.h * f;
                } else {
                    s.thicknessRatio = o.thicknessRatio * f;
                    s.points.forEach((p, j) => { p.x = ax + (o.points[j].x - ax) * f; p.y = ay + (o.points[j].y - ay) * f; });
                }
            });
            renderStrokes();
            return;
        }
        if (pickDrag) {
            e.preventDefault();
            const dx = pos.x - pickDrag.start.x, dy = pos.y - pickDrag.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 0.001) pickDrag.moved = true;
            drawPick.forEach((s, i) => {
                const o = pickDrag.orig[i];
                if (s.image) { s.x = o.x + dx; s.y = o.y + dy; }
                else s.points.forEach((p, j) => { p.x = o.points[j].x + dx; p.y = o.points[j].y + dy; });
            });
            renderStrokes();
            return;
        }
        if (marquee) {
            e.preventDefault();
            marquee.b = pos;
            renderStrokes();
            return;
        }
        // hover: show where you can grab
        const box = pickBox();
        if (onScaleHandle(pos, box)) { canvas.style.cursor = 'nwse-resize'; return; }
        const inBox = box && pos.x >= box.x0 && pos.x <= box.x1 && pos.y >= box.y0 && pos.y <= box.y1;
        canvas.style.cursor = inBox || itemAt(pos) ? 'move' : 'default';
    }

    function endPick() {
        if (pickDrag) {
            const moved = pickDrag.moved;
            pickDrag = null;
            if (!moved) drawUndo.pop(); // just a click: nothing changed
            renderStrokes();
            if (moved) flushEditor();
            return;
        }
        const x0 = Math.min(marquee.a.x, marquee.b.x), x1 = Math.max(marquee.a.x, marquee.b.x);
        const y0 = Math.min(marquee.a.y, marquee.b.y), y1 = Math.max(marquee.a.y, marquee.b.y);
        marquee = null;
        if (x1 - x0 < 0.004 && y1 - y0 < 0.004) { drawPick = []; renderStrokes(); return; }
        // everything that touches the box
        drawPick = state.draw.strokes.filter((s) => {
            if (s.image) return s.x < x1 && s.x + s.w > x0 && s.y < y1 && s.y + s.h > y0;
            return s.points.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
        });
        renderStrokes();
    }

    function deletePick() {
        if (!drawPick.length) return false;
        pushDrawUndo();
        const gone = new Set(drawPick);
        state.draw.strokes = state.draw.strokes.filter((s) => !gone.has(s));
        drawPick = [];
        renderStrokes();
        flushEditor();
        return true;
    }
    // put copies of the items in the drawing, a little to the right and down, and select them
    function placeCopies(items, offset = 0.03) {
        if (!items || !items.length) return;
        pushDrawUndo();
        const copies = items.map((s) => {
            const c = cloneItem(s);
            if (c.image) { c.x += offset; c.y += offset; }
            else c.points.forEach((p) => { p.x += offset; p.y += offset; });
            return c;
        });
        state.draw.strokes = state.draw.strokes.concat(copies);
        drawPick = copies;
        if (state.draw.tool !== 'select') setTool('select');
        renderStrokes();
        flushEditor();
    }
    function duplicatePick() { placeCopies(drawPick); }

    // Ctrl+C / Ctrl+X: keep a copy of the selection (and mark the clipboard so Ctrl+V pastes it)
    function drawPickActive() {
        if (state.prefs.mode !== 'draw' || state.prefs.activeTab === 'calendar' || !state.currentNoteId) return false;
        if (document.querySelector('.modal.active')) return false;
        const t = document.activeElement && document.activeElement.closest && document.activeElement.closest('input, textarea, [contenteditable="true"]');
        return !(t && t.offsetParent !== null);
    }
    // the selected part of the drawing as a picture (PNG), for pasting into the text
    function drawPickPng() {
        const box = pickBox();
        if (!box) return null;
        const note = noteById(state.currentNoteId);
        const W = canvas.width, H = canvas.height;
        const pad = 8;
        let x0 = Math.floor(box.x0 * W) - pad, y0 = Math.floor(box.y0 * H) - pad;
        let bw = Math.ceil((box.x1 - box.x0) * W) + 2 * pad, bh = Math.ceil((box.y1 - box.y0) * H) + 2 * pad;
        const scale = Math.min(1, 1600 / Math.max(bw, bh));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(bw * scale)); out.height = Math.max(1, Math.round(bh * scale));
        const g = out.getContext('2d');
        g.fillStyle = (note && note.canvasBackground) || DEFAULT_CANVAS_BG;
        g.fillRect(0, 0, out.width, out.height);
        drawPick.forEach((s) => drawStroke(s, g, W * scale, H * scale, -x0 * scale, -y0 * scale));
        return out.toDataURL('image/png');
    }
    const copyImgHtml = (src) => (src ? `<img data-remindate-copy="1" src="${src}">` : '');

    ['copy', 'cut'].forEach((type) => document.addEventListener(type, (e) => {
        if (!drawPickActive() || state.draw.tool !== 'select' || !drawPick.length) return;
        e.preventDefault();
        drawClipboard = drawPick.map(cloneItem);
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', COPY_MARK);
            e.clipboardData.setData('text/html', copyImgHtml(drawPickPng())); // pastes as a picture in the text
        }
        if (type === 'cut') deletePick();
        else toast('Copied — Ctrl+V pastes it here, or as a picture in the text');
    }));

    function pointerPos(e, unclamped) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (unclamped) return { x, y };
        return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }

    /* ---------------- pictures in the drawing ---------------- */
    const drawImageCache = new Map();
    let drawSel = null;      // the picture that is being placed (move / resize)
    let drawSelDrag = null;

    function drawImageEl(src) {
        let img = drawImageCache.get(src);
        if (!img) {
            img = new Image();
            img.onload = () => renderStrokes();
            img.src = src;
            drawImageCache.set(src, img);
        }
        return img;
    }

    // size of the corner handle, as part of the canvas width / height
    const handleSize = () => ({ x: 18 / (canvas.clientWidth || 1), y: 18 / (canvas.clientHeight || 1) });

    function drawSelectionFrame() {
        if (!drawSel || !state.draw.strokes.includes(drawSel)) { drawSel = null; return; }
        const W = canvas.width, H = canvas.height;
        const px = W / (canvas.clientWidth || W);
        const x = drawSel.x * W, y = drawSel.y * H, w = drawSel.w * W, h = drawSel.h * H;
        ctx.save();
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeStyle = '#7c6ff0';
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        const hs = handleSize();
        ctx.fillStyle = '#7c6ff0';
        ctx.fillRect(x + w - hs.x * W / 2, y + h - hs.y * H / 2, hs.x * W, hs.y * H);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + w - hs.x * W / 4, y + h - hs.y * H / 4, hs.x * W / 2, hs.y * H / 2);
        ctx.restore();
    }

    function selectionHit(pos) {
        if (!drawSel) return null;
        const hs = handleSize();
        const cx = drawSel.x + drawSel.w, cy = drawSel.y + drawSel.h;
        if (Math.abs(pos.x - cx) <= hs.x * 0.9 && Math.abs(pos.y - cy) <= hs.y * 0.9) return 'resize';
        if (pos.x >= drawSel.x && pos.x <= cx && pos.y >= drawSel.y && pos.y <= cy) return 'move';
        return null;
    }

    function dragSelection(e) {
        e.preventDefault();
        const pos = pointerPos(e, true);
        const { mode, start, orig } = drawSelDrag;
        const dx = pos.x - start.x, dy = pos.y - start.y;
        if (mode === 'move') {
            // keep at least a bit of the picture on the canvas
            drawSel.x = Math.min(0.95, Math.max(0.05 - orig.w, orig.x + dx));
            drawSel.y = Math.min(0.95, Math.max(0.05 - orig.h, orig.y + dy));
        } else {
            // resize from the corner, keeping the picture's shape
            const ratio = orig.h / orig.w;
            const grow = Math.max(dx, dy / ratio);
            drawSel.w = Math.max(0.04, orig.w + grow);
            drawSel.h = drawSel.w * ratio;
        }
        renderStrokes();
    }

    // the top-most picture under a point
    function pictureAt(pos) {
        for (let i = state.draw.strokes.length - 1; i >= 0; i--) {
            const s = state.draw.strokes[i];
            if (s.image && pos.x >= s.x && pos.x <= s.x + s.w && pos.y >= s.y && pos.y <= s.y + s.h) return s;
        }
        return null;
    }

    async function addDrawImages(files, at) {
        const note = noteById(state.currentNoteId);
        if (!note || !files.length || isPrivateLocked(note)) return;
        let added = null;
        for (const [i, file] of files.entries()) {
            let src;
            try { src = await imageFileToDataUrl(file); } catch (err) { toast('Could not read that picture'); continue; }
            const img = drawImageEl(src);
            if (!img.complete || !img.naturalWidth) {
                await new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); });
            }
            if (!img.naturalWidth) { toast('Could not read that picture'); continue; }
            const W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
            // at most 60% of the width and 80% of the height, never bigger than the picture itself
            let w = Math.min(0.6, img.naturalWidth / W);
            let h = w * W * (img.naturalHeight / img.naturalWidth) / H;
            if (h > 0.8) { w *= 0.8 / h; h = 0.8; }
            const cx = at ? at.x : 0.5, cy = at ? at.y : 0.5;
            const item = {
                image: src,
                x: Math.min(1 - w, Math.max(0, cx - w / 2)) + i * 0.03,
                y: Math.min(1 - h, Math.max(0, cy - h / 2)) + i * 0.03,
                w, h, points: []
            };
            if (!added) pushDrawUndo();
            state.draw.strokes.push(item);
            added = item;
        }
        if (!added) return;
        drawSel = added;
        renderStrokes();
        flushEditor();
        toast('Picture added: drag it to move, drag the corner to resize, click outside when done');
    }

    function deleteSelectedPicture() {
        if (!drawSel) return false;
        pushDrawUndo();
        state.draw.strokes = state.draw.strokes.filter((s) => s !== drawSel);
        drawSel = null;
        renderStrokes();
        flushEditor();
        return true;
    }

    // Double-click a picture to move / resize / delete it again
    canvas.addEventListener('dblclick', (e) => {
        if (state.prefs.mode !== 'draw') return;
        const pic = pictureAt(pointerPos(e, true));
        if (!pic) return;
        // the double-click also drew a dot: take that away again
        const last = state.draw.strokes[state.draw.strokes.length - 1];
        if (last && !last.image && last.points.length <= 2) state.draw.strokes.pop();
        drawSel = pic;
        renderStrokes();
        flushEditor();
    });

    // Ctrl+V a picture while the drawing is open
    document.addEventListener('paste', (e) => {
        if (state.prefs.mode !== 'draw' || state.prefs.activeTab === 'calendar' || !state.currentNoteId) return;
        if (document.querySelector('.modal.active')) return;
        const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
        if (typing && typing.offsetParent !== null) return;
        const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) {
            // pieces copied with the select tool (they also carry a picture: use the real lines instead)
            const mark = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (drawClipboard && mark === COPY_MARK && !isPrivateLocked(noteById(state.currentNoteId))) {
                e.preventDefault();
                placeCopies(drawClipboard);
                return;
            }
            // a picture copied from the text part of a note, from the grid, or from a web page
            const html = e.clipboardData ? e.clipboardData.getData('text/html') : '';
            const m = html && /<img[^>]+src="(data:image\/[^"]+)"/i.exec(html);
            if (m && !isPrivateLocked(noteById(state.currentNoteId))) {
                e.preventDefault();
                fetch(m[1].replace(/&quot;/g, '"')).then((r) => r.blob()).then((blob) => {
                    const type = blob.type || 'image/png';
                    addDrawImages([new File([blob], `picture.${type.split('/')[1] || 'png'}`, { type })]);
                }).catch(() => toast('Could not paste that picture'));
                return;
            }
            // pieces copied with the select tool
            const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (drawClipboard && text === COPY_MARK && !isPrivateLocked(noteById(state.currentNoteId))) {
                e.preventDefault();
                placeCopies(drawClipboard);
            }
            return;
        }
        e.preventDefault();
        addDrawImages(files);
    });

    // Drop picture files on the drawing
    drawContainer.addEventListener('dragover', (e) => {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
    drawContainer.addEventListener('drop', (e) => {
        const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        addDrawImages(files, pointerPos(e));
    });

    function startStroke(e) {
        if (state.prefs.mode !== 'draw' || drawZoom.isPinching()) return;
        e.preventDefault();
        const note = noteById(state.currentNoteId);
        if (!note) return;

        // A selected picture: drag it to move, drag the corner to resize, click elsewhere when done
        if (drawSel) {
            const pos = pointerPos(e, true);
            const hit = selectionHit(pos);
            if (hit) {
                try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* ignore */ }
                // keep the old version for Ctrl+Z: change a copy of the picture
                pushDrawUndo();
                const copy = { ...drawSel };
                state.draw.strokes = state.draw.strokes.map((s) => (s === drawSel ? copy : s));
                drawSel = copy;
                drawSelDrag = { mode: hit, start: pos, orig: { x: drawSel.x, y: drawSel.y, w: drawSel.w, h: drawSel.h } };
                return;
            }
            drawSel = null;
            renderStrokes();
            return;
        }

        if (state.draw.tool === 'select') {
            startPick(e);
            return;
        }

        if (state.draw.tool === 'fill') {
            bucketFill(pointerPos(e));
            return;
        }

        const pos = pointerPos(e);
        if (state.draw.tool === 'eraser') {
            state.draw.drawing = true;
            eraseSaved = false;
            eraseAt(pos);
            return;
        }

        try {
            canvas.setPointerCapture?.(e.pointerId);
        } catch (err) {
            /* niet elke browser staat capture toe voor synthetische events */
        }
        state.draw.current = {
            color: state.draw.color,
            thicknessRatio: state.draw.size / (canvas.clientWidth || canvas.width),
            points: [pos]
        };
        pushDrawUndo();
        state.draw.strokes.push(state.draw.current);
        state.draw.drawing = true;
        renderStrokes();
    }

    function moveStroke(e) {
        if (drawSelDrag) { dragSelection(e); return; }
        if (state.draw.tool === 'select') { movePick(e); return; }
        if (drawSel && !state.draw.drawing) {
            const hit = selectionHit(pointerPos(e, true));
            canvas.style.cursor = hit === 'resize' ? 'nwse-resize' : hit === 'move' ? 'move' : '';
        }
        if (!state.draw.drawing) return;
        e.preventDefault();
        const pos = pointerPos(e);
        if (state.draw.tool === 'eraser') {
            eraseAt(pos);
            return;
        }
        const current = state.draw.current;
        if (!current) return;
        const last = current.points[current.points.length - 1];
        if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 0.0015) return;
        current.points.push(pos);
        // only draw the new piece instead of repainting everything
        ctx.strokeStyle = current.color;
        ctx.lineWidth = Math.max(1, current.thicknessRatio * canvas.width);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(last.x * canvas.width, last.y * canvas.height);
        ctx.lineTo(pos.x * canvas.width, pos.y * canvas.height);
        ctx.stroke();
    }

    function endStroke() {
        if (drawSelDrag) { drawSelDrag = null; flushEditor(); return; }
        if (pickDrag || marquee) { endPick(); return; }
        if (!state.draw.drawing) return;
        state.draw.drawing = false;
        state.draw.current = null;
        flushEditor();
    }

    let eraseSaved = false;
    function eraseAt(pos) {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const radius = Math.max(0.006, (state.draw.size / 2) / (canvas.clientWidth || canvas.width));
        const before = state.draw.strokes;
        const after = before.filter((stroke) =>
            !stroke.points.some((p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= radius)
        );
        if (after.length !== before.length) {
            if (!eraseSaved) { pushDrawUndo(); eraseSaved = true; }
            state.draw.strokes = after;
            renderStrokes();
            flushEditor();
        }
    }

    canvas.addEventListener('pointerdown', startStroke);
    canvas.addEventListener('pointermove', moveStroke);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    window.addEventListener('resize', fitCanvas);

    const BUCKET_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><path d=\'M5 11l7-7 7 7-7 7z\' fill=\'white\' stroke=\'black\' stroke-width=\'1.5\'/><path d=\'M19 14c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z\' fill=\'%23e11d1d\' stroke=\'black\'/></svg>').replace(/%2523/g, '%23')}") 2 20, copy`;
    function setTool(tool) {
        state.draw.tool = tool;
        if (tool !== 'select' && drawPick.length) { drawPick = []; renderStrokes(); }
        updatePickBar();
        $('toolSelect').classList.toggle('active', tool === 'select');
        $('toolPen').classList.toggle('active', tool === 'pen');
        $('toolEraser').classList.toggle('active', tool === 'eraser');
        $('toolFill').classList.toggle('active', tool === 'fill');
        canvas.style.cursor = tool === 'eraser' ? 'cell' : tool === 'fill' ? BUCKET_CURSOR : tool === 'select' ? 'default' : 'crosshair';
    }

    $('toolImage').addEventListener('click', () => $('drawImageFile').click());
    $('drawImageFile').addEventListener('change', (e) => {
        const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
        e.target.value = '';
        addDrawImages(files);
    });
    $('toolPen').addEventListener('click', () => setTool('pen'));
    $('toolSelect').addEventListener('click', () => setTool('select'));
    $('pickCopy').addEventListener('click', () => duplicatePick());
    $('pickDelete').addEventListener('click', () => deletePick());
    $('toolEraser').addEventListener('click', () => setTool('eraser'));
    // Bucket: click an area of the drawing to fill it with the current colour
    $('toolFill').addEventListener('click', () => setTool('fill'));

    $('toolUndo').addEventListener('click', () => {
        let prev = drawUndo.pop();
        // nothing remembered (e.g. after a reload): take away the last item like before
        if (!prev) {
            if (!state.draw.strokes.length) return;
            prev = state.draw.strokes.slice(0, -1);
        }
        drawRedo.push(drawSnapshot());
        restoreDrawSnapshot(prev);
        drawSel = null;
        renderStrokes();
        flushEditor();
    });

    // Redo (Ctrl+Y): bring back what was undone last
    function redoDraw() {
        const next = drawRedo.pop();
        if (!next) return;
        drawUndo.push(drawSnapshot());
        restoreDrawSnapshot(next);
        drawSel = null;
        renderStrokes();
        flushEditor();
    }

    $('toolClear').addEventListener('click', async () => {
        if (!state.draw.strokes.length) return;
        if (!(await askConfirm('Clear drawing', 'Clear the entire drawing?', 'Clear'))) return;
        pushDrawUndo();
        state.draw.strokes = [];
        drawPick = [];
        renderStrokes();
        flushEditor();
    });

    $('brushSize').addEventListener('input', () => {
        state.draw.size = Number($('brushSize').value);
        $('brushSizeLabel').textContent = state.draw.size;
    });

    function setMode(mode) {
        if (!['text', 'draw', 'grid'].includes(mode)) mode = 'text';
        state.prefs.mode = mode;
        savePrefs();
        $('modeText').classList.toggle('active', mode === 'text');
        $('modeDraw').classList.toggle('active', mode === 'draw');
        $('modeGrid').classList.toggle('active', mode === 'grid');
        editorEl.style.display = mode === 'text' ? 'block' : 'none';
        $('textToolbar').style.display = mode === 'text' ? 'block' : 'none';
        drawContainer.style.display = mode === 'draw' ? 'block' : 'none';
        $('drawToolbar').style.display = mode === 'draw' ? 'block' : 'none';
        gridContainer.style.display = mode === 'grid' ? 'block' : 'none';
        $('gridToolbar').style.display = mode === 'grid' ? 'block' : 'none';
        $('zoomHint').style.display = mode === 'text' ? 'none' : 'block';
        if (mode === 'draw') {
            requestAnimationFrame(() => {
                fitCanvas();
                renderStrokes();
            });
        }
        if (mode === 'grid') requestAnimationFrame(fitGrid);
    }

    $('modeText').addEventListener('click', () => setMode('text'));
    $('modeDraw').addEventListener('click', () => setMode('draw'));
    $('modeGrid').addEventListener('click', () => setMode('grid'));

    /* ---------------- grid mode (fill cells by drawing over them) ---------------- */

    const gridCanvas = $('gridCanvas');
    const gctx = gridCanvas.getContext('2d');
    const gridContainer = $('gridContainer');
    const GRID_TYPES = ['triangle', 'square', 'hexagon', 'octagon'];
    const GRID_CELL_AREA = 1 / 2500; // ≈ 50 × 50 cells, same cell size for every shape
    const gridCache = {};
    let gridTool = 'pen';
    let gridStroke = null;   // { changes: Map(id -> previous color), last: {x, y} }
    let drawRedo = [];       // drawing versions that Ctrl+Y can bring back
    let drawUndo = [];       // earlier versions of the drawing (lists of items) for Ctrl+Z
    // Call before every change to the drawing: remembers the drawing as it is now
    function drawSnapshot() {
        const snap = state.draw.strokes.slice();
        const note = noteById(state.currentNoteId);
        snap.bg = note ? note.canvasBackground : undefined; // the canvas colour is part of the version too
        return snap;
    }
    function pushDrawUndo() {
        drawUndo.push(drawSnapshot());
        if (drawUndo.length > 100) drawUndo.shift();
        drawRedo = [];
    }
    function restoreDrawSnapshot(snap) {
        state.draw.strokes = snap.slice();
        const note = noteById(state.currentNoteId);
        if (note && 'bg' in snap && (note.canvasBackground || undefined) !== (snap.bg || undefined)) {
            if (snap.bg) note.canvasBackground = snap.bg; else delete note.canvasBackground;
            touch(note);
        }
    }
    let gridHistory = [];    // undo steps for the open note
    let gridRedo = [];       // undone steps that Ctrl+Y can redo

    // Cell size: L = the original size, M = half, S = a quarter (side length)
    const GRID_SIZES = { L: 1, M: 0.5, S: 0.25 };
    // Turning a grid by this many degrees gives the same grid again
    const GRID_PERIOD = { square: 90, octagon: 90, triangle: 180, hexagon: 180 };
    const GRID_STEP = { square: 45, octagon: 45, triangle: 90, hexagon: 90 };

    function gridSettings(note) {
        const type = currentGridType(note);
        const size = GRID_SIZES[note && note.gridSize] ? note.gridSize : 'L';
        let rot = ((((note && +note.gridRotation) || 0) % GRID_PERIOD[type]) + GRID_PERIOD[type]) % GRID_PERIOD[type];
        rot -= rot % GRID_STEP[type]; // triangles and hexagons only turn in steps of 90°
        return { type, size, rot };
    }
    // Where the filled cells are stored: the original L / 0° grids keep their old key
    function gridKey(note) {
        const { type, size, rot } = gridSettings(note);
        return size === 'L' && rot === 0 ? type : `${type}@${size}@${rot}`;
    }
    const gridOf = (note) => { const g = gridSettings(note); return buildGrid(g.type, g.size, g.rot); };

    // All cell polygons for a grid, in coordinates 0..1 (the canvas is square)
    function buildGrid(type, size = 'L', rot = 0) {
        const cacheKey = `${type}@${size}@${rot}`;
        if (gridCache[cacheKey]) return gridCache[cacheKey];
        const raw = [];
        const add = (id, pts) => raw.push({ id, pts });
        // A turned grid must also cover the corners: build it on a larger area around the canvas
        const lo = rot ? 0.5 - Math.SQRT1_2 - 0.02 : 0;
        const span = rot ? 2 * (Math.SQRT1_2 + 0.02) : 1;
        const k = GRID_SIZES[size] || 1;
        const A = GRID_CELL_AREA * k * k / (span * span); // cell area on the 0..1 building area

        if (type === 'square') {
            const s = Math.sqrt(A);
            const n = Math.round(1 / s);
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                add(`${c}.${r}`, [[c * s, r * s], [(c + 1) * s, r * s], [(c + 1) * s, (r + 1) * s], [c * s, (r + 1) * s]]);
            }
        } else if (type === 'triangle') {
            const a = 0.75 * Math.sqrt(4 * A / Math.sqrt(3)); // triangles are a bit smaller (25%)
            const h = a * Math.sqrt(3) / 2;
            const rows = Math.ceil(1 / h);
            const per = Math.ceil(2 / a) + 2;
            for (let r = 0; r < rows; r++) {
                const y = r * h;
                for (let j = 0; j <= per; j++) {
                    const x = (j - 1) * a / 2;
                    const up = (j + r) % 2 === 0;
                    add(`${j}.${r}`, up
                        ? [[x, y + h], [x + a, y + h], [x + a / 2, y]]
                        : [[x, y], [x + a, y], [x + a / 2, y + h]]);
                }
            }
        } else if (type === 'hexagon') {
            const R = Math.sqrt(2 * A / (3 * Math.sqrt(3)));
            const w = Math.sqrt(3) * R;
            const step = 1.5 * R;
            const rows = Math.ceil(1 / step) + 1;
            const cols = Math.ceil(1 / w) + 1;
            for (let r = 0; r <= rows; r++) for (let c = -1; c <= cols; c++) {
                const cx = c * w + (r % 2 ? w / 2 : 0);
                const cy = r * step;
                const pts = [];
                for (let q = 0; q < 6; q++) {
                    const t = (Math.PI / 180) * (60 * q - 90);
                    pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]);
                }
                add(`${c}.${r}`, pts);
            }
        } else if (type === 'octagon') {
            // octagons with small diamonds in between (truncated square tiling)
            const s = Math.sqrt(A);
            const n = Math.round(1 / s);
            const t = s / (2 + Math.SQRT2);
            const q = s / 2 - t;
            for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
                const cx = (i + 0.5) * s, cy = (j + 0.5) * s;
                add(`o${i}.${j}`, [[cx - s / 2, cy - q], [cx - q, cy - s / 2], [cx + q, cy - s / 2], [cx + s / 2, cy - q],
                    [cx + s / 2, cy + q], [cx + q, cy + s / 2], [cx - q, cy + s / 2], [cx - s / 2, cy + q]]);
            }
            for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
                const x = i * s, y = j * s;
                add(`s${i}.${j}`, [[x, y - t], [x + t, y], [x, y + t], [x - t, y]]);
            }
        }

        // place on the canvas (scale + turn around the middle) and keep the cells that are visible
        const cos = Math.cos(rot * Math.PI / 180), sin = Math.sin(rot * Math.PI / 180);
        const cells = [];
        raw.forEach(({ id, pts }) => {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            const out = pts.map(([px, py]) => {
                let x = lo + px * span, y = lo + py * span;
                if (rot) {
                    const dx = x - 0.5, dy = y - 0.5;
                    x = 0.5 + dx * cos - dy * sin;
                    y = 0.5 + dx * sin + dy * cos;
                }
                x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
                return [x, y];
            });
            if (x1 <= 0 || y1 <= 0 || x0 >= 1 || y0 >= 1) return;
            cells.push({ id, pts: out, x0, y0, x1, y1 });
        });

        // bucket index for fast "which cell is under the pen?"
        const B = Math.round(40 / k);
        const buckets = Array.from({ length: B * B }, () => []);
        const clampB = (v) => Math.min(B - 1, Math.max(0, Math.floor(v * B)));
        cells.forEach((c) => {
            for (let by = clampB(c.y0); by <= clampB(c.y1); by++) {
                for (let bx = clampB(c.x0); bx <= clampB(c.x1); bx++) buckets[by * B + bx].push(c);
            }
        });
        const byId = new Map(cells.map((c) => [c.id, c]));
        const cellSide = Math.sqrt(GRID_CELL_AREA) * k;
        gridCache[cacheKey] = { cells, buckets, B, clampB, byId, cellSide };
        return gridCache[cacheKey];
    }

    function pointInPoly(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    function gridHit(grid, x, y) {
        const list = grid.buckets[grid.clampB(y) * grid.B + grid.clampB(x)];
        for (const c of list) {
            if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) continue;
            if (pointInPoly(x, y, c.pts)) return c;
        }
        return null;
    }

    function currentGridType(note) {
        return GRID_TYPES.includes(note && note.gridType) ? note.gridType : 'square';
    }

    function gridCellsOf(note) {
        const type = gridKey(note);
        if (!note.grids || typeof note.grids !== 'object') note.grids = {};
        if (!note.grids[type] || typeof note.grids[type] !== 'object') note.grids[type] = {};
        return note.grids[type];
    }

    function gridLineColor(bg) {
        const m = /^#?([0-9a-f]{6})$/i.exec(bg || '');
        const v = m ? parseInt(m[1], 16) : 0;
        const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
        return lum > 0.55 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)';
    }

    // A drawing target: canvas context + how 0..1 grid coordinates map to its pixels
    const mainGridView = () => ({ g: gctx, sx: gridCanvas.width, sy: gridCanvas.height, ox: 0, oy: 0 });

    function tracePoly(c, v) {
        const { g, sx, sy, ox, oy } = v;
        g.moveTo(ox + c.pts[0][0] * sx, oy + c.pts[0][1] * sy);
        for (let i = 1; i < c.pts.length; i++) g.lineTo(ox + c.pts[i][0] * sx, oy + c.pts[i][1] * sy);
        g.closePath();
    }

    function drawGridOn(v, note, bg) {
        const { g } = v;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = bg;
        g.fillRect(0, 0, g.canvas.width, g.canvas.height);
        if (!note) return;
        const grid = gridOf(note);
        const cells = gridCellsOf(note);
        // only the cells that are visible on this target
        const x0 = -v.ox / v.sx, y0 = -v.oy / v.sy;
        const x1 = (g.canvas.width - v.ox) / v.sx, y1 = (g.canvas.height - v.oy) / v.sy;
        const list = (v.ox || v.oy || x1 < 1 || y1 < 1)
            ? grid.cells.filter((c) => c.x1 >= x0 && c.x0 <= x1 && c.y1 >= y0 && c.y0 <= y1)
            : grid.cells;
        list.forEach((c) => {
            const color = cells[c.id];
            if (!color) return;
            g.beginPath();
            tracePoly(c, v);
            g.fillStyle = color;
            g.fill();
        });
        g.strokeStyle = gridLineColor(bg);
        g.lineWidth = Math.max(1, v.sx / 1600);
        // draw the lines in small batches: one huge path is very slow for the small (S) grids
        for (let i = 0; i < list.length; i += 100) {
            g.beginPath();
            for (let j = i; j < Math.min(i + 100, list.length); j++) tracePoly(list[j], v);
            g.stroke();
        }
        drawGridPickOverlay(v);
    }

    function renderGrid() {
        const note = noteById(state.currentNoteId);
        const bg = (note && note.canvasBackground) || DEFAULT_CANVAS_BG;
        drawGridOn(mainGridView(), note, bg);
        renderGridDetail();
    }

    function paintGridCell(c, color, bg) {
        const views = [mainGridView()];
        if (gridDetailView) views.push(gridDetailView);
        views.forEach((v) => {
            v.g.beginPath();
            tracePoly(c, v);
            v.g.fillStyle = color || bg;
            v.g.fill();
            v.g.strokeStyle = gridLineColor(bg);
            v.g.lineWidth = Math.max(1, v.sx / 1600);
            v.g.stroke();
        });
    }

    /* Sharp zoom: when zoomed in, an extra canvas on top shows only the visible part,
     * drawn at the screen's full resolution (the big canvas underneath only gets stretched). */
    const gridDetail = document.createElement('canvas');
    gridDetail.className = 'grid-detail';
    gridDetail.hidden = true;
    gridContainer.appendChild(gridDetail);
    const gridDetailCtx = gridDetail.getContext('2d');
    let gridDetailView = null;
    let gridDetailTimer = null;
    let gridZoomState = { scale: 1, tx: 0, ty: 0 };

    function onGridZoom(z) {
        gridZoomState = { scale: z.scale, tx: z.tx, ty: z.ty };
        // while zooming/moving show the stretched picture, sharpen it as soon as you stop
        gridDetail.hidden = true;
        gridDetailView = null;
        clearTimeout(gridDetailTimer);
        if (z.scale > 1) gridDetailTimer = setTimeout(renderGridDetail, 120);
    }

    function renderGridDetail() {
        const { scale, tx, ty } = gridZoomState;
        if (scale <= 1 || gridContainer.style.display === 'none') {
            gridDetail.hidden = true;
            gridDetailView = null;
            return;
        }
        const note = noteById(state.currentNoteId);
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const w = gridContainer.clientWidth, h = gridCanvas.offsetHeight;
        gridDetail.style.width = `${w}px`;
        gridDetail.style.height = `${h}px`;
        gridDetail.width = Math.round(w * dpr);
        gridDetail.height = Math.round(h * dpr);
        gridDetailView = {
            g: gridDetailCtx,
            sx: gridCanvas.offsetWidth * scale * dpr,
            sy: gridCanvas.offsetHeight * scale * dpr,
            ox: tx * dpr,
            oy: ty * dpr
        };
        drawGridOn(gridDetailView, note, (note && note.canvasBackground) || DEFAULT_CANVAS_BG);
        gridDetail.hidden = false;
    }

    function fitGrid() {
        if (!gridContainer || gridContainer.style.display === 'none') return;
        const cssW = Math.max(200, gridContainer.clientWidth);
        const W = Math.round(cssW * backingScale(cssW));
        if (gridCanvas.width !== W || gridCanvas.height !== W) {
            gridCanvas.width = W;
            gridCanvas.height = W;
        }
        renderGrid();
        gridZoom.apply();
    }

    function gridPos(e) {
        const rect = gridCanvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    }

    function gridPaintAt(note, pos) {
        const grid = gridOf(note);
        const c = gridHit(grid, pos.x, pos.y);
        if (!c) return;
        const cells = gridCellsOf(note);
        const prev = cells[c.id];
        const next = gridTool === 'eraser' ? undefined : state.draw.color;
        if (prev === next) return;
        if (!gridStroke.changes.has(c.id)) gridStroke.changes.set(c.id, prev);
        if (next) cells[c.id] = next; else delete cells[c.id];
        paintGridCell(c, next, note.canvasBackground || DEFAULT_CANVAS_BG);
    }

    gridCanvas.addEventListener('pointerdown', (e) => {
        if (state.prefs.mode !== 'grid' || gridZoom.isPinching()) return;
        const note = noteById(state.currentNoteId);
        if (!note) return;
        e.preventDefault();
        try { gridCanvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        const pos = gridPos(e);
        if (gridTool === 'select') { startGridPick(note, pos, e.altKey); return; }
        gridStroke = { changes: new Map(), last: pos, type: gridKey(note) };
        gridPaintAt(note, pos);
    });

    gridCanvas.addEventListener('pointermove', (e) => {
        if (gridTool === 'select') { moveGridPick(e); return; }
        if (!gridStroke) return;
        e.preventDefault();
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const pos = gridPos(e);
        const { last } = gridStroke;
        const dist = Math.hypot(pos.x - last.x, pos.y - last.y);
        const steps = Math.max(1, Math.ceil(dist / (gridOf(note).cellSide * 0.25)));
        for (let i = 1; i <= steps; i++) {
            gridPaintAt(note, { x: last.x + (pos.x - last.x) * (i / steps), y: last.y + (pos.y - last.y) * (i / steps) });
        }
        gridStroke.last = pos;
    });

    function endGridStroke() {
        if (gridPickDrag || gridMarquee) { endGridPick(); return; }
        if (!gridStroke) return;
        const stroke = gridStroke;
        gridStroke = null;
        const note = noteById(state.currentNoteId);
        if (!note || !stroke.changes.size) return;
        gridHistory.push(stroke);
        gridRedo = [];
        if (gridHistory.length > 100) gridHistory.shift();
        touch(note);
        renderTree();
    }

    function revertGridChanges(note, stroke) {
        const cells = note.grids[stroke.type] || (note.grids[stroke.type] = {});
        stroke.after = new Map();   // remember the painted colors so the step can be redone
        stroke.changes.forEach((prev, id) => {
            stroke.after.set(id, cells[id]);
            if (prev) cells[id] = prev; else delete cells[id];
        });
    }

    // A pinch started while the first finger was already painting: undo that paint
    function cancelGridStroke() {
        const note = noteById(state.currentNoteId);
        if (gridStroke && note) revertGridChanges(note, gridStroke);
        gridStroke = null;
        renderGrid();
    }

    gridCanvas.addEventListener('pointerup', endGridStroke);
    gridCanvas.addEventListener('pointercancel', endGridStroke);

    const gridZoom = createZoom(gridContainer, gridCanvas, cancelGridStroke, onGridZoom);

    function setGridTool(tool) {
        gridTool = tool;
        if (tool !== 'select' && (gridPick.length || gridCopyMode)) { gridPick = []; gridCopyMode = false; renderGrid(); }
        $('gridPen').classList.toggle('active', tool === 'pen');
        $('gridEraser').classList.toggle('active', tool === 'eraser');
        $('gridSelect').classList.toggle('active', tool === 'select');
        gridCanvas.style.cursor = tool === 'eraser' ? 'cell' : tool === 'select' ? 'default' : 'crosshair';
        updateGridPickBar();
    }

    /* ---------- select tool in the grid: pick filled cells, move / copy / delete them ---------- */
    let gridPick = [];        // ids of the selected cells
    let gridMarquee = null;   // { a, b } while dragging a selection box
    let gridPickDrag = null;  // while moving the selection
    let gridCopyMode = false; // the next move leaves the originals where they are (a copy)
    let gridClipboard = null; // { key, cells: [[id, colour]] }
    const GRID_COPY_MARK = '[Remindate grid selection]';
    const cellCenter = (c) => {
        let x = 0, y = 0;
        c.pts.forEach(([px, py]) => { x += px; y += py; });
        return { x: x / c.pts.length, y: y / c.pts.length };
    };
    // same kind of cell (triangles up/down, octagon vs small square), so a move keeps the pattern
    const cellKind = (c) => `${c.pts.length}:${Math.round(Math.atan2(c.pts[1][1] - c.pts[0][1], c.pts[1][0] - c.pts[0][0]) * 100)}`;

    function updateGridPickBar() {
        const show = gridTool === 'select' && gridPick.length > 0;
        $('gridPickActions').hidden = !show;
        if (show) $('gridPickCount').textContent = `${gridPick.length} cell${gridPick.length === 1 ? '' : 's'}${gridCopyMode ? ' · copy' : ''}`;
    }

    // outline of the selected cells and the selection box (drawn on top of the grid)
    function drawGridPickOverlay(v) {
        if (!gridPick.length && !gridMarquee) return;
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const grid = gridOf(note);
        const { g } = v;
        const px = Math.max(1, v.sx / 800);
        g.save();
        g.setLineDash([5 * px, 3 * px]);
        g.lineWidth = 2 * px;
        g.strokeStyle = '#a78bfa';
        g.fillStyle = 'rgba(167,139,250,.18)';
        gridPick.forEach((id) => {
            const c = grid.byId.get(id);
            if (!c) return;
            g.beginPath();
            tracePoly(c, v);
            g.fill();
            g.stroke();
        });
        if (gridMarquee) {
            const { a, b } = gridMarquee;
            g.strokeStyle = '#c4b5fd';
            g.fillStyle = 'rgba(196,181,253,.12)';
            const x = v.ox + Math.min(a.x, b.x) * v.sx, y = v.oy + Math.min(a.y, b.y) * v.sy;
            g.fillRect(x, y, Math.abs(b.x - a.x) * v.sx, Math.abs(b.y - a.y) * v.sy);
            g.strokeRect(x, y, Math.abs(b.x - a.x) * v.sx, Math.abs(b.y - a.y) * v.sy);
        }
        g.restore();
    }

    function startGridPick(note, pos, alt) {
        const grid = gridOf(note);
        const cells = gridCellsOf(note);
        const hit = gridHit(grid, pos.x, pos.y);
        if (hit && gridPick.includes(hit.id)) {
            // drag the selection (with Alt, or after "Copy": leave the originals)
            gridPickDrag = {
                key: gridKey(note), anchor: hit, base: { ...cells }, moved: false, copy: gridCopyMode || alt,
                colors: gridPick.map((id) => [id, cells[id]]), targets: gridPick.slice()
            };
            gridCanvas.style.cursor = 'move';
            return;
        }
        if (hit && cells[hit.id]) {
            // press on a filled cell: select it and move it right away
            gridPick = [hit.id];
            gridCopyMode = false;
            gridPickDrag = { key: gridKey(note), anchor: hit, base: { ...cells }, moved: false, copy: alt,
                colors: [[hit.id, cells[hit.id]]], targets: [hit.id] };
            renderGrid();
            updateGridPickBar();
            return;
        }
        gridPick = [];
        gridCopyMode = false;
        gridMarquee = { a: pos, b: pos };
        renderGrid();
        updateGridPickBar();
    }

    function moveGridPick(e) {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const pos = gridPos(e);
        const grid = gridOf(note);
        if (gridPickDrag) {
            e.preventDefault();
            const d = gridPickDrag;
            const over = gridHit(grid, pos.x, pos.y);
            if (!over || cellKind(over) !== cellKind(d.anchor)) return; // wait for a matching cell
            const a = cellCenter(d.anchor), o = cellCenter(over);
            const dx = o.x - a.x, dy = o.y - a.y;
            const targets = [];
            const cells = { ...d.base };
            if (!d.copy) d.colors.forEach(([id]) => { delete cells[id]; });
            for (const [id, color] of d.colors) {
                const c = grid.byId.get(id);
                if (!c) continue;
                const cc = cellCenter(c);
                const t = gridHit(grid, cc.x + dx, cc.y + dy);
                if (!t) continue; // moved off the grid
                cells[t.id] = color;
                targets.push(t.id);
            }
            d.moved = over.id !== d.anchor.id;
            d.targets = targets;
            note.grids[d.key] = cells;
            gridPick = targets;
            renderGrid();
            return;
        }
        if (gridMarquee) {
            e.preventDefault();
            gridMarquee.b = pos;
            renderGrid();
            return;
        }
        const hit = gridHit(grid, pos.x, pos.y);
        gridCanvas.style.cursor = hit && (gridPick.includes(hit.id) || gridCellsOf(note)[hit.id]) ? 'move' : 'default';
    }

    // record the change between two versions of the cells as one undo step
    function commitGridChange(note, key, before) {
        const after = note.grids[key] || {};
        const changes = new Map();
        new Set([...Object.keys(before), ...Object.keys(after)]).forEach((id) => {
            if (before[id] !== after[id]) changes.set(id, before[id]);
        });
        if (!changes.size) return false;
        gridHistory.push({ changes, type: key });
        gridRedo = [];
        if (gridHistory.length > 100) gridHistory.shift();
        touch(note);
        return true;
    }

    function endGridPick() {
        const note = noteById(state.currentNoteId);
        if (gridPickDrag) {
            const d = gridPickDrag;
            gridPickDrag = null;
            if (note && d.moved) {
                commitGridChange(note, d.key, d.base);
                gridCopyMode = false;
            } else if (note) {
                note.grids[d.key] = d.base;
                gridPick = d.colors.map(([id]) => id);
            }
            renderGrid();
            updateGridPickBar();
            return;
        }
        const { a, b } = gridMarquee;
        gridMarquee = null;
        if (note) {
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const grid = gridOf(note);
            const cells = gridCellsOf(note);
            // every filled cell whose middle is inside the box
            gridPick = grid.cells.filter((c) => {
                if (!cells[c.id]) return false;
                const m = cellCenter(c);
                return m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1;
            }).map((c) => c.id);
        }
        renderGrid();
        updateGridPickBar();
    }

    function deleteGridPick() {
        const note = noteById(state.currentNoteId);
        if (!note || !gridPick.length) return false;
        const key = gridKey(note);
        const before = { ...gridCellsOf(note) };
        const cells = { ...before };
        gridPick.forEach((id) => { delete cells[id]; });
        note.grids[key] = cells;
        commitGridChange(note, key, before);
        gridPick = [];
        gridCopyMode = false;
        renderGrid();
        updateGridPickBar();
        return true;
    }
    function copyGridPick() {
        if (!gridPick.length) return;
        gridCopyMode = true;
        updateGridPickBar();
        toast('Copy made — drag it to where you want it');
    }
    function gridPickActive() {
        if (state.prefs.mode !== 'grid' || state.prefs.activeTab === 'calendar' || !state.currentNoteId) return false;
        if (document.querySelector('.modal.active')) return false;
        const t = document.activeElement && document.activeElement.closest && document.activeElement.closest('input, textarea, select, [contenteditable="true"]');
        return !(t && t.offsetParent !== null);
    }
    // the selected cells as a picture (PNG), for pasting into the text
    function gridPickPng(note) {
        const grid = gridOf(note);
        const cells = gridCellsOf(note);
        const list = gridPick.map((id) => grid.byId.get(id)).filter(Boolean);
        if (!list.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        list.forEach((c) => { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1); });
        const side = Math.min(gridCanvas.width, 1600 / Math.max(x1 - x0, y1 - y0, 0.001));
        const pad = 6;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round((x1 - x0) * side) + 2 * pad);
        out.height = Math.max(1, Math.round((y1 - y0) * side) + 2 * pad);
        const g = out.getContext('2d');
        const bg = note.canvasBackground || DEFAULT_CANVAS_BG;
        g.fillStyle = bg;
        g.fillRect(0, 0, out.width, out.height);
        const v = { g, sx: side, sy: side, ox: pad - x0 * side, oy: pad - y0 * side };
        g.strokeStyle = gridLineColor(bg);
        g.lineWidth = Math.max(1, side / 1600);
        list.forEach((c) => {
            g.beginPath();
            tracePoly(c, v);
            g.fillStyle = cells[c.id] || bg;
            g.fill();
            g.stroke();
        });
        return out.toDataURL('image/png');
    }

    // Copied cells from one grid → the cells of another grid (other size, shape or angle).
    // Each target cell looks at 5 spots (its middle + 4 spots towards its corners) in the copied
    // part; if at least 2 land on copied cells, it gets the colour that came up most.
    function resampleGridCells(clip, target) {
        const src = buildGrid(clip.settings.type, clip.settings.size, clip.settings.rot);
        const colorOf = new Map(clip.cells);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        clip.cells.forEach(([id]) => {
            const c = src.byId.get(id);
            if (!c) return;
            x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
        });
        if (x0 === Infinity) return [];
        const out = [];
        target.cells.forEach((t) => {
            if (t.x1 < x0 || t.x0 > x1 || t.y1 < y0 || t.y0 > y1) return;
            const m = cellCenter(t);
            const spots = [m, ...[0, 1, 2, 3].map((k) => {
                const v = t.pts[Math.floor(k * t.pts.length / 4)];
                return { x: m.x + (v[0] - m.x) * 0.5, y: m.y + (v[1] - m.y) * 0.5 };
            })];
            const votes = new Map();
            let hits = 0;
            spots.forEach((q) => {
                const c = gridHit(src, q.x, q.y);
                const col = c && colorOf.get(c.id);
                if (!col) return;
                hits++;
                votes.set(col, (votes.get(col) || 0) + 1);
            });
            if (hits < 2) return;
            let best = null, n = 0;
            votes.forEach((v, col) => { if (v > n) { n = v; best = col; } });
            out.push([t.id, best]);
        });
        return out;
    }

    ['copy', 'cut'].forEach((type) => document.addEventListener(type, (e) => {
        if (!gridPickActive() || gridTool !== 'select' || !gridPick.length) return;
        const note = noteById(state.currentNoteId);
        e.preventDefault();
        const cells = gridCellsOf(note);
        gridClipboard = { key: gridKey(note), settings: gridSettings(note), cells: gridPick.map((id) => [id, cells[id]]).filter(([, c]) => c) };
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', GRID_COPY_MARK);
            e.clipboardData.setData('text/html', copyImgHtml(gridPickPng(note))); // pastes as a picture in the text
        }
        if (type === 'cut') deleteGridPick();
        else toast('Copied — Ctrl+V pastes it here (then drag it), or as a picture in the text');
    }));
    document.addEventListener('paste', (e) => {
        if (!gridPickActive() || !gridClipboard) return;
        const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        if (text !== GRID_COPY_MARK) return;
        const note = noteById(state.currentNoteId);
        if (!note || isPrivateLocked(note)) return;
        e.preventDefault();
        // put the copied colours on the cells, selected and ready to be dragged away;
        // copied from another size / shape / angle: draw it again on this grid's cells
        const key = gridKey(note);
        const pasted = gridClipboard.key === key ? gridClipboard.cells : resampleGridCells(gridClipboard, gridOf(note));
        if (!pasted.length) { toast('Nothing to paste: the copied part is too small for this grid'); return; }
        const before = { ...gridCellsOf(note) };
        const cells = { ...before };
        pasted.forEach(([id, c]) => { cells[id] = c; });
        note.grids[key] = cells;
        commitGridChange(note, key, before);
        gridPick = pasted.map(([id]) => id);
        gridCopyMode = true;
        if (gridTool !== 'select') setGridTool('select');
        renderGrid();
        updateGridPickBar();
        toast('Pasted — drag it to where you want it');
    });

    $('gridPen').addEventListener('click', () => setGridTool('pen'));
    $('gridSelect').addEventListener('click', () => setGridTool('select'));
    $('gridPickCopy').addEventListener('click', copyGridPick);
    $('gridPickDelete').addEventListener('click', deleteGridPick);
    $('gridEraser').addEventListener('click', () => setGridTool('eraser'));
    $('gridColorSwatch').addEventListener('click', () => openModal('colorModal'));
    $('gridBg').addEventListener('click', () => $('toolCanvasBg').click());

    $('gridType').addEventListener('change', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.gridType = $('gridType').value;
        gridPick = []; gridCopyMode = false;
        gridHistory = [];
        gridRedo = [];
        updateGridControls(note);
        touch(note);
        renderGrid();
    });

    function updateGridControls(note) {
        const g = gridSettings(note);
        $('gridSize').value = g.size;
        $('gridRotate').textContent = `⟳ ${g.rot}°`;
        $('gridRotate').title = `Turn the grid ${GRID_STEP[g.type]}° (now ${g.rot}°)`;
    }

    $('gridSize').addEventListener('change', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.gridSize = $('gridSize').value;
        gridPick = []; gridCopyMode = false;
        gridHistory = [];
        gridRedo = [];
        updateGridControls(note);
        touch(note);
        renderGrid();
    });

    $('gridRotate').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const g = gridSettings(note);
        note.gridRotation = (g.rot + GRID_STEP[g.type]) % GRID_PERIOD[g.type];
        gridPick = []; gridCopyMode = false;
        gridHistory = [];
        gridRedo = [];
        updateGridControls(note);
        touch(note);
        renderGrid();
    });

    $('gridUndo').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        const stroke = gridHistory.pop();
        if (!note || !stroke) return;
        revertGridChanges(note, stroke);
        gridRedo.push(stroke);
        gridPick = []; gridCopyMode = false; updateGridPickBar();
        touch(note);
        renderGrid();
    });

    function redoGrid() {
        const note = noteById(state.currentNoteId);
        const stroke = gridRedo.pop();
        if (!note || !stroke || !stroke.after) return;
        const cells = note.grids[stroke.type] || (note.grids[stroke.type] = {});
        stroke.after.forEach((value, id) => {
            if (value) cells[id] = value; else delete cells[id];
        });
        gridHistory.push(stroke);
        touch(note);
        renderGrid();
    }

    $('gridClear').addEventListener('click', async () => {
        const note = noteById(state.currentNoteId);
        if (!note || !Object.keys(gridCellsOf(note)).length) return;
        if (!(await askConfirm('Clear grid', 'Clear all filled cells of this grid?', 'Clear'))) return;
        note.grids[gridKey(note)] = {};
        gridHistory = [];
        gridRedo = [];
        touch(note);
        renderGrid();
        renderTree();
    });

    window.addEventListener('resize', fitGrid);


    /* ---------------- kleuren ---------------- */

    function buildPalette(host, onPick) {
        const persistentToast = host.querySelector('.toast[data-persistent="true"]');
        if (!persistentToast) host.innerHTML = '';
        PALETTE.forEach((color) => {
            const b = document.createElement('button');
            b.className = 'palette-color';
            b.style.background = color;
            b.title = (PALETTE_NAMED.find(([c]) => c === color) || [, color])[1];
            b.addEventListener('click', () => {
                onPick(color);
                closeModals();
            });
            host.appendChild(b);
        });
    }

    function openModal(id) {
        $(id).classList.add('active');
    }

    function closeModals() {
        if (dialogResolve) { finishDialog(false); return; }
        if ($('voiceModal').classList.contains('active')) resetVoiceModal();
        if ($('emailHelpModal').classList.contains('active')) { $('emailHelpModal').classList.remove('active'); return; }
        if ($('emailModal').classList.contains('active')) { closeEmailModal(); return; }
        document.querySelectorAll('.modal.active').forEach((m) => m.classList.remove('active'));
    }

    /* In-app dialogs. Browser prompt()/confirm() can be silently blocked
     * (e.g. after ticking "prevent this page from creating dialogs"). */
    let dialogResolve = null;

    function askDialog({ title, message = '', input = null, okLabel = 'OK', danger = false, altLabel = null, password = false }) {
        return new Promise((resolve) => {
            if (dialogResolve) finishDialog(false);
            dialogResolve = resolve;
            $('dialogAlt').hidden = !altLabel;
            $('dialogAlt').textContent = altLabel || '';
            $('dialogTitle').textContent = title;
            $('dialogMessage').textContent = message;
            $('dialogMessage').hidden = !message;
            const field = $('dialogInput');
            field.hidden = input === null;
            field.value = input === null ? '' : input;
            field.type = password ? 'password' : 'text';
            field.autocomplete = password ? 'off' : '';
            field.placeholder = password ? 'Private Note Pass' : '';
            const ok = $('dialogOk');
            ok.textContent = okLabel;
            ok.classList.toggle('btn-danger', danger);
            ok.classList.toggle('btn-primary', !danger);
            $('dialogModal').classList.add('active');
            setTimeout(() => {
                if (input !== null) { field.focus(); field.select(); } else ok.focus();
            }, 30);
        });
    }

    function finishDialog(ok) {
        if (!dialogResolve) return;
        const resolve = dialogResolve;
        dialogResolve = null;
        $('dialogModal').classList.remove('active');
        if (ok === 'alt') { resolve('alt'); return; }
        if ($('dialogInput').hidden) resolve(!!ok);
        else resolve(ok ? $('dialogInput').value : null);
    }

    const askText = (title, value, okLabel = 'OK') => askDialog({ title, input: value || '', okLabel });
    const askConfirm = (title, message, okLabel = 'OK') =>
        askDialog({ title, message, okLabel, danger: /delete|clear|replace/i.test(okLabel) });

    $('dialogOk').addEventListener('click', () => finishDialog(true));
    $('dialogCancel').addEventListener('click', () => finishDialog(false));
    $('dialogAlt').addEventListener('click', () => finishDialog('alt'));
    $('dialogClose').addEventListener('click', () => finishDialog(false));
    $('dialogBackdrop').addEventListener('click', () => finishDialog(false));
    $('dialogInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finishDialog(true); }
    });

    buildPalette($('palette'), (color) => {
        state.draw.color = color;
        $('colorSwatch').style.background = color;
        $('gridColorSwatch').style.background = color;
        $('colorCustom').value = color;
        setTool('pen');
        setGridTool('pen');
    });

    buildPalette($('canvasPalette'), (color) => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.canvasBackground = color;
        $('canvasBgCustom').value = color;
        touch(note);
        renderStrokes();
        renderGrid();
    });

    $('colorSwatch').addEventListener('click', () => openModal('colorModal'));
    $('colorClose').addEventListener('click', closeModals);
    $('colorBackdrop').addEventListener('click', closeModals);

    $('colorCustom').addEventListener('input', (e) => {
        state.draw.color = e.target.value;
        $('colorSwatch').style.background = e.target.value;
        $('gridColorSwatch').style.background = e.target.value;
        setTool('pen');
        setGridTool('pen');
    });

    $('toolCanvasBg').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        if (note) $('canvasBgCustom').value = note.canvasBackground || DEFAULT_CANVAS_BG;
        openModal('canvasBgModal');
    });

    $('canvasBgClose').addEventListener('click', closeModals);
    $('canvasBgBackdrop').addEventListener('click', closeModals);
    $('canvasBgCustom').addEventListener('input', (e) => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.canvasBackground = e.target.value;
        touch(note);
        renderStrokes();
        renderGrid();
    });

    // the Text / Draw / Grid bar sticks to the top; the toolbars stick just below it
    function measureModeBar() {
        const bar = document.querySelector('#viewNote .editor-toolbar');
        if (bar && bar.offsetHeight) document.documentElement.style.setProperty('--modebar-h', `${bar.offsetHeight}px`);
    }
    window.addEventListener('resize', measureModeBar);
    setTimeout(measureModeBar, 0);

    /* ---------------- zijbalk-layout ---------------- */

    const app = $('app');

    function applyLayout() {
        app.style.setProperty('--sidebar-width', `${state.prefs.sidebarWidth}px`);
        app.classList.toggle('sidebar-right', state.prefs.sidebarSide === 'right');
        const collapsed = state.prefs.sidebarCollapsed && !isMobile();
        app.classList.toggle('sidebar-collapsed', collapsed);
        $('toggleSidebarSide').title = isMobile() ? 'Close sidebar' : 'Move sidebar left or right';
        $('expandSidebar').style.display = collapsed ? 'block' : 'none';
        $('expandSidebar').style.left = state.prefs.sidebarSide === 'right' ? 'auto' : '8px';
        $('expandSidebar').style.right = state.prefs.sidebarSide === 'right' ? '8px' : 'auto';
        $('expandSidebar').textContent = String.fromCharCode(state.prefs.sidebarSide === 'right' ? 8249 : 8250);
        $('collapseSidebar').textContent = String.fromCharCode(state.prefs.sidebarSide === 'right' ? 8250 : 8249);
    }

    function toggleSidebarSide() {
        if (isMobile()) {
            app.classList.toggle('mobile-open');
            return;
        }
        state.prefs.sidebarSide = state.prefs.sidebarSide === 'left' ? 'right' : 'left';
        savePrefs();
        applyLayout();
    }

    $('toggleSidebarSide').addEventListener('click', toggleSidebarSide);
    // Hamburger button: opens the settings window
    $('toggleSidebarMain').addEventListener('click', () => openSettings());
    function openSettings(tab) {
        syncHolidayCheckboxes();
        showSettingsTab(tab || state.settingsTab || 'holidays');
        $('settingsModal').classList.add('active');
    }
    function showSettingsTab(tab) {
        state.settingsTab = tab;
        document.querySelectorAll('.settings-tab').forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('[data-settings-panel]').forEach((p) => { p.hidden = p.dataset.settingsPanel !== tab; });
        if (tab === 'pass') updatePassPanel();
    }
    document.querySelectorAll('.settings-tab').forEach((b) => b.addEventListener('click', () => showSettingsTab(b.dataset.tab)));
    $('settingsClose').addEventListener('click', closeModals);
    $('settingsBackdrop').addEventListener('click', closeModals);

    $('collapseSidebar').addEventListener('click', () => {
        if (isMobile()) {
            app.classList.remove('mobile-open');
            return;
        }
        state.prefs.sidebarCollapsed = true;
        savePrefs();
        applyLayout();
    });

    $('expandSidebar').addEventListener('click', () => {
        if (isMobile()) {
            app.classList.add('mobile-open');
            return;
        }
        state.prefs.sidebarCollapsed = false;
        savePrefs();
        applyLayout();
    });

    let dragging = false;
    $('sidebarSplitter').addEventListener('pointerdown', (e) => {
        if (isMobile()) return;
        dragging = true;
        e.preventDefault();
        $('sidebarSplitter').classList.add('dragging');
        document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const width = state.prefs.sidebarSide === 'right' ? window.innerWidth - e.clientX : e.clientX;
        state.prefs.sidebarWidth = Math.min(480, Math.max(180, width));
        applyLayout();
        fitCanvas();
    });

    window.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        $('sidebarSplitter').classList.remove('dragging');
        document.body.style.cursor = '';
        savePrefs();
    });

    window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
        app.classList.remove('mobile-open');
        applyLayout();
        fitCanvas();
    });

    /* ---------------- GitHub-sync ---------------- */

    let githubConfig = readJSON(STORAGE.github, {});
    // The data file used to be called notes.json: switch to remindate.json. The first sync
    // reads the old file once and saves everything as remindate.json (the old file stays untouched).
    if (githubConfig.path === 'notes.json') {
        githubConfig.path = 'remindate.json';
        githubConfig.legacyPath = 'notes.json';
        githubConfig.sha = null;
        writeJSON(STORAGE.github, githubConfig);
    }
    let githubTimer = null;
    let githubBusy = false;

    const githubConfigured = () => !!(githubConfig.owner && githubConfig.repo && githubConfig.path && githubConfig.token);
    let githubPending = false;

    function shortTime(iso) {
        const d = parseDate(iso);
        if (!d) return '–';
        return sameDay(d, new Date()) ? formatTime(toLocalIso(d)) : formatDateTime(toLocalIso(d));
    }

    function updateGithubStatus(message) {
        const el = $('githubStatus');
        if (!el) return;
        if (message) { el.textContent = message; return; }
        const parts = [], tips = [];
        if (githubConfigured()) {
            const where = `${githubConfig.owner}/${githubConfig.repo}/${githubConfig.path}`;
            parts.push(githubConfig.lastSyncAt
                ? `GitHub: synced ${shortTime(githubConfig.lastSyncAt)} • last change ${shortTime(laterIso(state.updatedAt, githubConfig.remoteUpdatedAt))}`
                : `GitHub: ${where} • not synced yet`);
            tips.push(`GitHub: ${where}\nLast sync: ${shortTime(githubConfig.lastSyncAt)}\nLatest version on GitHub: ${shortTime(githubConfig.remoteUpdatedAt)}`);
        }
        if (serverConfigured()) {
            parts.push(serverConfig.lastSyncAt ? `Server: synced ${shortTime(serverConfig.lastSyncAt)}` : 'Server: not synced yet');
            tips.push(`Server: ${serverConfig.url}\nLast sync: ${shortTime(serverConfig.lastSyncAt)}\nLatest version on the server: ${shortTime(serverConfig.remoteUpdatedAt)}`);
        }
        if (!parts.length) { el.textContent = 'Sync: not configured'; el.title = ''; return; }
        el.textContent = parts.join(' • ');
        el.title = `${tips.join('\n\n')}\nLast change on this device: ${shortTime(state.updatedAt)}`;
    }

    function showGithubSettings() {
        $('ghOwner').value = githubConfig.owner || '';
        $('ghRepo').value = githubConfig.repo || '';
        $('ghPath').value = githubConfig.path || 'remindate.json';
        $('ghToken').value = githubConfig.token || '';
        $('ghAutoSync').checked = !!githubConfig.autoSync;
        openModal('githubModal');
    }

    function readGithubForm() {
        return {
            owner: $('ghOwner').value.trim(),
            repo: $('ghRepo').value.trim(),
            path: $('ghPath').value.trim().replace(/^\/+/, ''),
            token: $('ghToken').value.trim(),
            autoSync: $('ghAutoSync').checked,
            sha: githubConfig.sha || null,
            lastSyncAt: githubConfig.lastSyncAt || null,
            remoteUpdatedAt: githubConfig.remoteUpdatedAt || null
        };
    }

    function githubUrl(path = githubConfig.path) {
        return `https://api.github.com/repos/${encodeURIComponent(githubConfig.owner)}/${encodeURIComponent(githubConfig.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    }

    async function githubRequest(method, body, url = githubUrl(), accept = 'application/vnd.github+json') {
        const response = await fetch(url, {
            method,
            // never use a cached copy: we must always see the newest version on GitHub
            cache: 'no-store',
            headers: {
                Accept: accept,
                Authorization: `Bearer ${githubConfig.token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok && response.status !== 404) {
            const data = await response.json().catch(() => ({}));
            const error = new Error(data.message || `GitHub error ${response.status}`);
            error.status = response.status;
            throw error;
        }
        if (response.status === 404) return null;
        return accept.includes('raw') ? response.text() : response.json();
    }

    function decodeGithubFile(encoded) {
        const bytes = Uint8Array.from(atob(encoded.replace(/\s/g, '')), (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    function encodeGithubFile(value) {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
    }

    /* ---- snapshots & merging ----
     * A snapshot is { notes, folders, deleted, updatedAt }.
     * Merging works per note/folder: the version with the newest modifiedAt wins,
     * and an item deleted after its last change stays deleted.
     */

    // JSON with sorted keys, so the same data always gives the same text
    function stableStringify(value) {
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        if (value && typeof value === 'object') {
            return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
                .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
        }
        return JSON.stringify(value === undefined ? null : value);
    }

    const snapshotKey = (snap) => stableStringify({ notes: snap.notes, folders: snap.folders, deleted: snap.deleted });

    function localSnapshot() {
        return JSON.parse(JSON.stringify({
            notes: state.notes,
            folders: state.folders,
            deleted: state.deleted,
            updatedAt: state.updatedAt
        }));
    }

    function normalizeSnapshot(data) {
        const notes = Array.isArray(data) ? data : data.notes;
        if (!Array.isArray(notes)) throw new Error('remindate.json on GitHub does not contain a valid note list');
        const snap = {
            notes: notes.map((n) => { migrateNote(n); return n; }),
            folders: (Array.isArray(data) ? [] : (data.folders || [])).map((f) => { migrateFolder(f); return f; }),
            deleted: normalizeDeleted(Array.isArray(data) ? null : data.deleted),
            updatedAt: Array.isArray(data) ? null : (data.updatedAt || null)
        };
        return snap;
    }

    const timeOf = (iso) => Date.parse(iso) || 0;
    const laterIso = (a, b) => (timeOf(a) >= timeOf(b) ? a : b) || a || b || null;

    function mergeSnapshots(local, remote) {
        const deleted = { notes: {}, folders: {} };
        const cutoff = Date.now() - 180 * 86400000; // forget deletions after ~6 months
        ['notes', 'folders'].forEach((kind) => {
            [remote.deleted[kind], local.deleted[kind]].forEach((list) => {
                Object.entries(list).forEach(([id, at]) => {
                    if (timeOf(at) < cutoff) return;
                    if (!deleted[kind][id] || timeOf(at) > timeOf(deleted[kind][id])) deleted[kind][id] = at;
                });
            });
        });

        const mergeList = (kind, mine, theirs) => {
            const map = new Map();
            const order = [];
            [...mine, ...theirs].forEach((item) => {
                const current = map.get(item.id);
                if (!current) { map.set(item.id, item); order.push(item.id); }
                else if (timeOf(item.modifiedAt) > timeOf(current.modifiedAt)) map.set(item.id, item);
            });
            return order.map((id) => map.get(id)).filter((item) => {
                const gone = deleted[kind][item.id];
                if (!gone) return true;
                if (timeOf(gone) >= timeOf(item.modifiedAt)) return false;
                delete deleted[kind][item.id]; // changed again after the delete: keep it
                return true;
            });
        };

        const folders = mergeList('folders', local.folders, remote.folders)
            .map((f, i) => ({ f, i }))
            .sort((a, b) => ((typeof a.f.order === 'number' ? a.f.order : a.i) - (typeof b.f.order === 'number' ? b.f.order : b.i)) || a.i - b.i)
            .map((x) => x.f);
        const folderIds = new Set(folders.map((f) => f.id));
        const notes = mergeList('notes', local.notes, remote.notes)
            .map((n) => (n.folderId && !folderIds.has(n.folderId) ? { ...n, folderId: null } : n));

        return { notes, folders, deleted, updatedAt: laterIso(local.updatedAt, remote.updatedAt) };
    }

    // Put a merged snapshot into the app without counting it as a new local change
    function applySnapshot(snap) {
        const before = stableStringify(noteById(state.currentNoteId) || null);
        const knownFolders = new Set(state.folders.map((f) => f.id));
        const incomingIds = new Set(snap.notes.map((n) => n.id));
        state.notes.filter((n) => !incomingIds.has(n.id)).forEach(addToTrash);
        state.notes = snap.notes.map((n) => { migrateNote(n); return n; });
        state.folders = snap.folders;
        state.deleted = snap.deleted;
        state.updatedAt = snap.updatedAt;
        writeJSON(STORAGE.notes, state.notes);
        writeJSON(STORAGE.folders, state.folders);
        writeJSON(STORAGE.deleted, state.deleted);
        writeJSON(STORAGE.updatedAt, state.updatedAt);

        state.folders.forEach((f) => {
            // folders that are new on this device start expanded
            if (!knownFolders.has(f.id) && !state.prefs.expandedFolders.includes(f.id)) state.prefs.expandedFolders.push(f.id);
        });
        savePrefs();
        if (!noteById(state.currentNoteId)) {
            state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
            state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
        }
        renderTree();
        if (stableStringify(noteById(state.currentNoteId) || null) !== before) renderEditor();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    async function fetchRemote() {
        let meta = await githubRequest('GET');
        let url = githubUrl();
        let legacy = false;
        if (!meta && githubConfig.legacyPath) {
            // remindate.json doesn't exist yet: start from the old notes.json
            url = githubUrl(githubConfig.legacyPath);
            meta = await githubRequest('GET', null, url);
            legacy = true;
        }
        if (!meta) return null;
        let text;
        if (meta.content && meta.encoding === 'base64') text = decodeGithubFile(meta.content);
        else text = await githubRequest('GET', null, url, 'application/vnd.github.raw+json'); // files > 1 MB
        const data = text && text.trim() ? JSON.parse(text) : [];
        // from the old file: no sha, so the push creates remindate.json, and always push once
        return legacy ? { sha: null, data, legacy: true } : { sha: meta.sha, data };
    }

    async function pushRemote(snap, sha) {
        const payload = {
            app: 'Remindate',
            version: 1,
            updatedAt: snap.updatedAt || new Date().toISOString(),
            folders: snap.folders,
            notes: snap.notes,
            deleted: snap.deleted
        };
        const result = await githubRequest('PUT', {
            message: `Remindate sync ${new Date().toISOString()}`,
            content: encodeGithubFile(JSON.stringify(payload, null, 2)),
            ...(sha ? { sha } : {})
        });
        if (!result || !result.content) {
            throw new Error(`GitHub can't find ${githubConfig.owner}/${githubConfig.repo}, or your token has no write access to it`);
        }
        githubConfig.sha = result.content.sha;
        githubConfig.remoteUpdatedAt = payload.updatedAt;
        delete githubConfig.legacyPath; // remindate.json exists now
    }

    /* ---------------- Server sync (your own server / paid hosting) ----------------
     * Protocol (kept tiny so any server can do it):
     *   GET  <url>  -> 200 + the remindate.json content (ETag header = version), or 404 when empty
     *   PUT  <url>  -> stores the JSON body; with "If-Match: <etag>" it answers 412 if
     *                  someone else saved in between. Answers with the new ETag.
     * Auth: "Authorization: Bearer <token>". scripts/remindate-sync-server.js does exactly this. */
    let serverConfig = readJSON(STORAGE.server, {});
    const serverConfigured = () => !!serverConfig.url;

    async function serverRequest(method, body, ifMatch) {
        let response;
        try {
            response = await fetch(serverConfig.url, {
                method,
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                    ...(serverConfig.token ? { Authorization: `Bearer ${serverConfig.token}` } : {}),
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(ifMatch ? { 'If-Match': ifMatch } : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
        } catch (err) {
            throw new Error(location.protocol === 'https:' && /^http:/i.test(serverConfig.url)
                ? 'the server address must start with https://'
                : "can't reach the server (is it online, and does it allow this website (CORS)?)");
        }
        if (response.status === 404 && method === 'GET') return null;
        if (!response.ok) {
            const error = new Error(response.status === 401 || response.status === 403
                ? 'the server refused the token'
                : response.status === 412 || response.status === 409
                    ? 'someone else saved at the same time'
                    : `server error ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const text = await response.text();
        return { etag: response.headers.get('ETag'), text };
    }

    const syncProviders = {
        github: {
            id: 'github',
            label: 'GitHub',
            configured: () => githubConfigured(),
            cfg: () => githubConfig,
            save: () => writeJSON(STORAGE.github, githubConfig),
            async fetch() {
                const r = await fetchRemote();
                // coming from the old notes.json: always write remindate.json once
                if (r && r.legacy) return { rev: null, data: r.data, forcePush: true };
                return r && { rev: r.sha, data: r.data };
            },
            async push(snap, rev) { await pushRemote(snap, rev); return githubConfig.sha; },
            setRev(rev) { githubConfig.sha = rev; },
            isConflict: (err) => err.status === 409 || err.status === 422
        },
        server: {
            id: 'server',
            label: 'Server',
            configured: () => serverConfigured(),
            cfg: () => serverConfig,
            save: () => writeJSON(STORAGE.server, serverConfig),
            async fetch() {
                const r = await serverRequest('GET');
                if (!r) return null;
                const data = r.text && r.text.trim() ? JSON.parse(r.text) : [];
                return { rev: r.etag || null, data };
            },
            async push(snap, rev) {
                const payload = {
                    app: 'Remindate', version: 1,
                    updatedAt: snap.updatedAt || new Date().toISOString(),
                    folders: snap.folders, notes: snap.notes, deleted: snap.deleted
                };
                const r = await serverRequest('PUT', payload, rev);
                serverConfig.remoteUpdatedAt = payload.updatedAt;
                return r.etag || null;
            },
            setRev(rev) { serverConfig.etag = rev; },
            isConflict: (err) => err.status === 412 || err.status === 409
        }
    };
    const configuredProviders = () => Object.values(syncProviders).filter((p) => p.configured());

    // Sync = 1) fetch the newest version, 2) merge it with this device,
    // 3) push the result back (only if the other side doesn't have it yet).
    let syncPending = new Set();
    async function runSync(p, options = {}) {
        if (!p.configured()) return;
        if (githubBusy) { syncPending.add(p.id); return; }
        githubBusy = true;
        let pulled = false, pushed = false;
        try {
            if (options.flush !== false) flushEditor();
            for (let attempt = 0; attempt < 4; attempt++) {
                updateGithubStatus(`${p.label}: fetching…`);
                const local = localSnapshot();
                const remote = await p.fetch();
                // You edited something while we were fetching: start over with the new data
                if (state.updatedAt !== local.updatedAt) continue;

                let merged = local;
                let remoteSnap = null;
                if (remote) {
                    remoteSnap = normalizeSnapshot(remote.data);
                    merged = mergeSnapshots(local, remoteSnap);
                    p.cfg().remoteUpdatedAt = remoteSnap.updatedAt;
                }
                if (snapshotKey(merged) !== snapshotKey(local)) {
                    applySnapshot(merged);
                    pulled = true;
                }
                if (!remote || remote.forcePush || snapshotKey(merged) !== snapshotKey(remoteSnap)) {
                    updateGithubStatus(`${p.label}: pushing…`);
                    try {
                        p.setRev(await p.push(merged, remote && remote.rev));
                        pushed = true;
                    } catch (err) {
                        // Someone else pushed in between: fetch again and retry
                        if (p.isConflict(err)) continue;
                        throw err;
                    }
                } else {
                    p.setRev(remote.rev);
                }
                p.cfg().lastSyncAt = new Date().toISOString();
                p.save();
                updateGithubStatus();
                // New data came in: pass it on to the other sync targets too
                if (pulled) configuredProviders().forEach((o) => { if (o !== p) syncPending.add(o.id); });
                if (!options.silent) {
                    toast(pulled && pushed ? `Fetched changes from ${p.label} and pushed yours`
                        : pulled ? `Fetched the latest changes from ${p.label}`
                            : pushed ? `Pushed your changes to ${p.label}`
                                : `Already up to date with ${p.label}`);
                }
                return;
            }
            throw new Error('the data kept changing during sync, please try again');
        } catch (err) {
            console.error(`${p.label} sync failed`, err);
            updateGithubStatus(`${p.label}: sync failed`);
            toast(`${p.label} sync failed: ${err.message}`);
        } finally {
            githubBusy = false;
            const next = [...syncPending][0];
            if (next) {
                syncPending.delete(next);
                runSync(syncProviders[next], { silent: true, flush: false });
            }
        }
    }

    const syncGithub = (options) => runSync(syncProviders.github, options);
    const autoProviders = () => configuredProviders().filter((p) => p.cfg().autoSync);
    function syncAll(providers, options = {}) {
        const [first, ...rest] = providers;
        if (!first) return;
        rest.forEach((p) => syncPending.add(p.id));
        runSync(first, options);
    }

    function scheduleGithubSave() {
        if (!autoProviders().length) return;
        clearTimeout(githubTimer);
        githubTimer = setTimeout(() => syncAll(autoProviders(), { silent: true }), 1500);
    }

    // With auto-sync on, also fetch regularly and when you come back to the tab
    let lastAutoPull = 0;
    function autoPull() {
        if (!autoProviders().length || document.hidden) return;
        if (Date.now() - lastAutoPull < 30000) return;
        lastAutoPull = Date.now();
        syncAll(autoProviders(), { silent: true, flush: true });
    }
    window.addEventListener('focus', autoPull);
    document.addEventListener('visibilitychange', autoPull);
    setInterval(autoPull, 120000);

    /* Sync Settings: choose GitHub Sync or Server Sync */
    function showSyncChooser() {
        $('syncChooseGithubState').textContent = githubConfigured() ? (githubConfig.autoSync ? 'On • automatic' : 'On') : 'Not set up';
        $('syncChooseServerState').textContent = serverConfigured() ? (serverConfig.autoSync ? 'On • automatic' : 'On') : 'Not set up';
        openModal('syncChooserModal');
    }
    $('syncChooserClose').addEventListener('click', closeModals);
    $('syncChooserBackdrop').addEventListener('click', closeModals);
    $('syncChooseGithub').addEventListener('click', () => { $('syncChooserModal').classList.remove('active'); showGithubSettings(); });
    $('syncChooseServer').addEventListener('click', () => { $('syncChooserModal').classList.remove('active'); showServerSettings(); });

    function showServerSettings() {
        $('srvUrl').value = serverConfig.url || '';
        $('srvToken').value = serverConfig.token || '';
        $('srvAutoSync').checked = !!serverConfig.autoSync;
        openModal('serverModal');
    }
    function readServerForm() {
        return {
            url: $('srvUrl').value.trim(),
            token: $('srvToken').value.trim(),
            autoSync: $('srvAutoSync').checked,
            // a different address is a different file: forget the old version info
            etag: serverConfig.url === $('srvUrl').value.trim() ? serverConfig.etag || null : null,
            lastSyncAt: serverConfig.url === $('srvUrl').value.trim() ? serverConfig.lastSyncAt || null : null,
            remoteUpdatedAt: serverConfig.url === $('srvUrl').value.trim() ? serverConfig.remoteUpdatedAt || null : null
        };
    }
    function validServerUrl(url) {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
        } catch { return false; }
    }
    $('serverClose').addEventListener('click', closeModals);
    $('serverBackdrop').addEventListener('click', closeModals);
    $('serverSaveBtn').addEventListener('click', () => {
        const next = readServerForm();
        if (!validServerUrl(next.url)) { toast('Enter the full server address, starting with https://'); return; }
        serverConfig = next;
        writeJSON(STORAGE.server, serverConfig);
        updateGithubStatus();
        closeModals();
        toast('Server settings saved');
        if (serverConfig.autoSync) runSync(syncProviders.server, { silent: false });
    });
    $('serverClearBtn').addEventListener('click', () => {
        serverConfig = {};
        localStorage.removeItem(STORAGE.server);
        $('srvUrl').value = '';
        $('srvToken').value = '';
        $('srvAutoSync').checked = false;
        updateGithubStatus();
        toast('Server settings cleared from this browser');
    });
    $('serverTestBtn').addEventListener('click', async () => {
        const prior = serverConfig;
        serverConfig = readServerForm();
        if (!validServerUrl(serverConfig.url)) {
            serverConfig = prior;
            toast('Enter the full server address, starting with https://');
            return;
        }
        try {
            const r = await serverRequest('GET');
            if (r && r.text.trim()) JSON.parse(r.text);
            toast(r ? 'Server connection works' : 'Server connection works (no notes stored there yet)');
        } catch (err) {
            toast(`Connection failed: ${err.message.replace(/^Unexpected.*/, 'the server did not answer with JSON')}`);
        } finally {
            serverConfig = prior;
        }
    });

    $('githubOpenBtn').addEventListener('click', showSyncChooser);
    $('githubClose').addEventListener('click', closeModals);
    $('githubBackdrop').addEventListener('click', closeModals);
    $('githubSaveBtn').addEventListener('click', () => {
        const next = readGithubForm();
        if (!next.owner || !next.repo || !next.path || !next.token) {
            toast('Enter owner, repository, path, and token');
            return;
        }
        githubConfig = next;
        writeJSON(STORAGE.github, githubConfig);
        updateGithubStatus();
        closeModals();
        toast('GitHub settings saved');
    });
    $('githubClearBtn').addEventListener('click', () => {
        githubConfig = {};
        localStorage.removeItem(STORAGE.github);
        $('ghOwner').value = '';
        $('ghRepo').value = '';
        $('ghPath').value = 'remindate.json';
        $('ghToken').value = '';
        $('ghAutoSync').checked = false;
        updateGithubStatus();
        toast('GitHub settings cleared from this browser');
    });
    $('githubTestBtn').addEventListener('click', async () => {
        const prior = githubConfig;
        githubConfig = readGithubForm();
        if (!githubConfigured()) {
            githubConfig = prior;
            toast('Enter owner, repository, path, and token first');
            return;
        }
        try {
            const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(githubConfig.owner)}/${encodeURIComponent(githubConfig.repo)}`, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${githubConfig.token}`,
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (!repoResponse.ok) throw new Error(repoResponse.status === 404
                ? 'Repository not found or token has no access'
                : `GitHub error ${repoResponse.status}`);
            await githubRequest('GET');
            toast('GitHub connection works');
        } catch (err) {
            toast(`Connection failed: ${err.message}`);
        } finally {
            githubConfig = prior;
        }
    });
    $('githubSyncBtn').addEventListener('click', () => {
        const list = configuredProviders();
        if (!list.length) return showSyncChooser();
        flushEditor();
        syncAll(list);
    });

    /* ---------------- back-up ---------------- */

    async function exportData() {
        flushEditor();
        // The file contains everything, also private notes: ask for the Private Note Pass first
        if (!privatePass && state.notes.some((n) => n.private)) {
            toast("Set your 'Private Note Pass' in Settings (Top right)", { label: 'Open Settings', onClick: () => openSettings('pass') });
            return;
        }
        if (privatePass) {
            const pass = await askDialog({
                title: 'Save .json',
                message: 'Enter your Private Note Pass to save all your notes as a file.',
                input: '', password: true, okLabel: 'Save'
            });
            $('dialogInput').type = 'text';
            if (pass === null) return;
            if (!(await checkPass(pass))) { toast('Wrong pass, the file was not saved'); return; }
        }
        const payload = {
            app: 'Remindate',
            version: 1,
            exportedAt: new Date().toISOString(),
            updatedAt: state.updatedAt,
            folders: state.folders,
            notes: state.notes,
            deleted: state.deleted
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `remindate-${dayKey(new Date())}.json`;
        a.rel = 'noopener';
        // Firefox needs the link in the page; Safari/Firefox need the URL to live a moment longer
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Saved your notes as a .json file');
    }

    // Upload a .json file: replace everything, or add it to the notes you already have
    function importData(file) {
        const reader = new FileReader();
        reader.onerror = () => toast('Could not read this file');
        reader.onload = async () => {
            let snap;
            try {
                snap = normalizeSnapshot(JSON.parse(reader.result));
            } catch (err) {
                toast('This is not a Remindate .json file');
                return;
            }
            flushEditor();
            const count = `${snap.notes.length} note${snap.notes.length === 1 ? '' : 's'}` +
                (snap.folders.length ? ` and ${snap.folders.length} folder${snap.folders.length === 1 ? '' : 's'}` : '');
            const choice = await askDialog({
                title: 'Upload .json',
                message: `This file has ${count}. Add them to your notes, or replace everything you have now?`,
                okLabel: 'Add to my notes',
                altLabel: 'Replace all'
            });
            if (!choice) return;
            const now = new Date().toISOString();
            if (choice === 'alt') {
                // replace: the notes/folders that are not in the file count as deleted (also for GitHub sync)
                const keepNotes = new Set(snap.notes.map((n) => n.id));
                const keepFolders = new Set(snap.folders.map((f) => f.id));
                state.notes.forEach((n) => { if (!keepNotes.has(n.id)) { state.deleted.notes[n.id] = now; addToTrash(n); } });
                state.folders.forEach((f) => { if (!keepFolders.has(f.id)) state.deleted.folders[f.id] = now; });
                snap.notes.forEach((n) => { n.modifiedAt = now; delete state.deleted.notes[n.id]; });
                snap.folders.forEach((f) => { f.modifiedAt = now; delete state.deleted.folders[f.id]; });
                state.notes = snap.notes;
                state.folders = snap.folders;
            } else {
                const merged = mergeSnapshots(localSnapshot(), { ...snap, deleted: { notes: {}, folders: {} } });
                state.notes = merged.notes.map((n) => { migrateNote(n); return n; });
                state.folders = merged.folders;
            }
            if (!noteById(state.currentNoteId)) state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
            state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
            state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];
            saveFolders();
            saveNotes();
            savePrefs();
            renderTree();
            renderEditor();
            if (state.prefs.activeTab === 'calendar') renderCalendar();
            toast(choice === 'alt' ? `Replaced with ${count}` : `Added ${count}`);
        };
        reader.readAsText(file);
    }

    $('exportBtn').addEventListener('click', exportData);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
        if (e.target.files[0]) importData(e.target.files[0]);
        e.target.value = '';
    });

    /* ---------------- alarmen ---------------- */

    // An alarm only rings if its time was at most this long ago. Older (missed)
    // alarms, e.g. when the app was closed or after a sync, are skipped silently.
    const ALARM_GRACE_MS = 10 * 60000;
    const ALARM_MAX_SOUND_MS = 20000;
    const ALARM_REPEAT_MS = 60 * 1000;          // ring again every minute…
    const ALARM_GIVE_UP_MS = 2 * 60 * 60 * 1000; // …until stopped, or for at most 2 hours

    // Mark the most recent (already passed) occurrence as handled, so changing a
    // note's schedule never makes it ring immediately for a time in the past.
    function resetAlarmRuntime(note) {
        delete state.alarms[note.id];
        const occ = note.alarmEnabled ? latestOccurrence(note, Date.now()) : null;
        if (occ) state.alarms[note.id] = { dueTime: occ.getTime(), repeatsLeft: 0, snoozeMinutes: note.alarmSnoozeMinutes, nextAt: null };
        saveAlarms();
    }

    function checkAlarms() {
        const now = Date.now();
        // Re-read so several open tabs don't ring the same alarm twice
        state.alarms = readJSON(STORAGE.alarms, {}) || {};
        let changed = false;

        Object.keys(state.alarms).forEach((id) => {
            const n = noteById(id);
            if (!n || !n.alarmEnabled || !n.scheduledAt) { delete state.alarms[id]; changed = true; }
        });

        state.notes.forEach((note) => {
            if (!note.alarmEnabled || !note.scheduledAt) return;
            const occ = latestOccurrence(note, now);
            if (!occ) return;
            const dueTime = occ.getTime();

            let runtime = state.alarms[note.id];
            if (!runtime || runtime.dueTime !== dueTime) {
                runtime = {
                    dueTime,
                    rings: 0,
                    nextAt: now - dueTime > ALARM_GRACE_MS ? null : dueTime
                };
                state.alarms[note.id] = runtime;
                changed = true;
            }

            if (runtime.nextAt === null || runtime.nextAt > now) return;

            // ring now, and again every minute until "Stop alarm" (or snooze) is pressed
            runtime.rings = (runtime.rings || 0) + 1;
            const stillGoing = now - runtime.dueTime < ALARM_GIVE_UP_MS;
            runtime.nextAt = stillGoing ? now + ALARM_REPEAT_MS : null;
            changed = true;
            saveAlarms();
            showAlarm(note, dueTime, runtime.rings, !stillGoing);
        });

        if (changed) saveAlarms();
    }

    function showAlarm(note, dueTime, ring = 1, lastRing = false) {
        const title = note.title.trim() || 'Untitled';
        const body = note.private ? 'Private note' : (note.content.trim().slice(0, 120) || 'Scheduled note');
        notify(`⏰ ${title}`, body, 'remindate-alarm-' + note.id);
        playAlarmSound();
        const snooze = Math.max(1, Number(note.alarmSnoozeMinutes) || 5);
        const runtimeFor = () => {
            state.alarms = readJSON(STORAGE.alarms, {}) || {};
            const r = state.alarms[note.id];
            return r && r.dueTime === dueTime ? r : null;
        };
        toast(`⏰ ${title} – ${formatTime(toLocalIso(new Date(dueTime)))}${ring > 1 ? ` (${ring}×)` : ''}${lastRing ? ' · last reminder' : ''}`, {
            persistent: true,
            key: 'alarm-' + note.id,
            buttons: [
                {
                    label: `Snooze ${snooze} min`,
                    secondary: true,
                    onClick: () => {
                        stopAlarmSound();
                        const r = runtimeFor();
                        const until = Date.now() + snooze * 60000;
                        if (r) { r.nextAt = until; saveAlarms(); }
                        toast(`Snoozed until ${formatTime(toLocalIso(new Date(until)))}`);
                    }
                },
                {
                    label: 'Stop alarm',
                    onClick: () => {
                        stopAlarmSound();
                        const r = runtimeFor();
                        if (r) { r.nextAt = null; saveAlarms(); }
                    }
                }
            ]
        });
    }

    let alarmAudio = null, alarmContext = null, alarmMaster = null, alarmStopTimer = null;

    function getAudioContext() {
        try {
            alarmContext = alarmContext || new (window.AudioContext || window.webkitAudioContext)();
            if (alarmContext.state === 'suspended') alarmContext.resume();
            return alarmContext;
        } catch (_) { return null; }
    }

    function stopAlarmSound() {
        clearTimeout(alarmStopTimer);
        if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; alarmAudio = null; }
        if (alarmMaster) {
            try {
                alarmMaster.gain.cancelScheduledValues(0);
                alarmMaster.gain.value = 0;
                alarmMaster.disconnect();
            } catch (_) {}
            alarmMaster = null;
        }
    }

    // One short "beep" with a soft attack/release so it doesn't click
    function beep(ctx, out, freq, at, dur) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(1, at + 0.012);
        env.gain.setValueAtTime(1, at + dur - 0.03);
        env.gain.linearRampToValueAtTime(0, at + dur);
        osc.connect(env);
        env.connect(out);
        osc.start(at);
        osc.stop(at + dur + 0.02);
    }

    // Standard alarm: a little two-bar tune ("bi-bi-biep  bi-bi-biep  biep-biep-bieeep")
    // repeated with short pauses, for at most 20 seconds.
    const ALARM_TUNE = [
        // [frequency Hz, start (s), duration (s)]
        [1046.5, 0.00, 0.09], [1318.5, 0.14, 0.09], [1568.0, 0.28, 0.20],   // C E G
        [1046.5, 0.70, 0.09], [1318.5, 0.84, 0.09], [1568.0, 0.98, 0.20],   // C E G
        [1568.0, 1.40, 0.09], [1568.0, 1.54, 0.09], [2093.0, 1.68, 0.35]    // G G C'
    ];
    const ALARM_TUNE_LENGTH = 2.6; // seconds, including the pause after the tune

    function playAlarmSound() {
        stopAlarmSound();
        alarmStopTimer = setTimeout(stopAlarmSound, ALARM_MAX_SOUND_MS);
        const saved = localStorage.getItem('remindate.alarmSound.v1');
        if (saved) {
            alarmAudio = new Audio(saved);
            alarmAudio.loop = true;
            const audio = alarmAudio;
            audio.play().catch(() => {
                if (alarmAudio === audio) { alarmAudio = null; playBeepPattern(); }
            });
            return;
        }
        playBeepPattern();
    }

    function playBeepPattern() {
        const ctx = getAudioContext();
        if (!ctx) return;
        alarmMaster = ctx.createGain();
        alarmMaster.gain.value = 0.16;
        alarmMaster.connect(ctx.destination);
        const start = ctx.currentTime + 0.05;
        const maxSec = ALARM_MAX_SOUND_MS / 1000;
        for (let t = 0; t + ALARM_TUNE_LENGTH <= maxSec + 0.5; t += ALARM_TUNE_LENGTH) {
            ALARM_TUNE.forEach(([freq, offset, dur]) => {
                if (t + offset + dur <= maxSec) beep(ctx, alarmMaster, freq, start + t + offset, dur);
            });
        }
    }

    $('alarmSoundFile').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                localStorage.setItem('remindate.alarmSound.v1', reader.result);
                $('alarmSoundStatus').textContent = `Using custom sound: ${file.name}`;
                toast('Custom alarm sound saved');
            } catch (_) { toast('This sound file is too large to store in browser storage'); }
        };
        reader.readAsDataURL(file);
    });
    $('standardAlarmSoundBtn').addEventListener('click', () => {
        localStorage.removeItem('remindate.alarmSound.v1');
        $('alarmSoundFile').value = '';
        $('alarmSoundStatus').textContent = 'Using standard sound';
        toast('Standard alarm sound selected');
    });
    $('testAlarmSoundBtn').addEventListener('click', () => {
        if (alarmAudio || alarmMaster) {
            stopAlarmSound();
            $('testAlarmSoundBtn').textContent = 'Test sound';
            return;
        }
        playAlarmSound();
        $('testAlarmSoundBtn').textContent = 'Stop test';
        setTimeout(() => { $('testAlarmSoundBtn').textContent = 'Test sound'; }, ALARM_MAX_SOUND_MS);
    });
    $('openAlarmSoundSettings').addEventListener('click', () => {
        const customSound = localStorage.getItem('remindate.alarmSound.v1');
        $('alarmSoundStatus').textContent = customSound ? 'Using a custom sound' : 'Using standard sound';
        $('alarmSoundModal').classList.add('active');
    });
    $('alarmSoundClose').addEventListener('click', closeModals);
    $('alarmSoundBackdrop').addEventListener('click', closeModals);

    function notify(title, body, tag) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            try {
                // same tag = replaces the previous one instead of stacking up
                new Notification(title, { body, icon: 'icon.svg', ...(tag ? { tag } : {}) });
            } catch (err) {
                console.warn('Could not show notification', err);
            }
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    /* ---------------- meldingen (toast) ---------------- */

    let toastTimer = null;

    function toast(message, action) {
        let host = $('toastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toastHost';
            document.body.appendChild(host);
        }
        // Keep alarm toasts (persistent) visible; replace everything else
        host.querySelectorAll('.toast').forEach((t) => {
            if (!t.dataset.persistent || (action?.key && t.dataset.key === action.key)) t.remove();
        });

        const el = document.createElement('div');
        el.className = 'toast';
        if (action?.persistent) el.dataset.persistent = 'true';
        if (action?.key) el.dataset.key = action.key;
        const text = document.createElement('span');
        text.textContent = message;
        el.appendChild(text);

        const buttons = action ? (action.buttons || [{ label: action.label, onClick: action.onClick }]) : [];
        buttons.forEach((b) => {
            const btn = document.createElement('button');
            btn.className = 'toast-action' + (b.secondary ? ' secondary' : '');
            btn.textContent = b.label;
            btn.addEventListener('click', () => {
                el.remove();
                b.onClick();
            });
            el.appendChild(btn);
        });

        host.appendChild(el);
        if (!action?.persistent) {
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.remove(), action ? 20000 : 3500);
        }
    }

    /* ---------------- stray drops ---------------- */
    // A file (or a dragged note) let go outside a drop area must not make the browser
    // open/navigate away from the app (Firefox and Safari do that).
    document.addEventListener('dragover', (e) => {
        if (!e.defaultPrevented && Array.from(e.dataTransfer ? e.dataTransfer.types || [] : []).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'none';
        }
    });
    document.addEventListener('drop', (e) => {
        // moving text or a picture inside the note itself is fine
        if (e.target && e.target.closest && e.target.closest('#noteContent')) return;
        if (!e.defaultPrevented) e.preventDefault();
    });

    /* ---------------- action menu (the ⋯ buttons on phones) ---------------- */
    let sheetActions = [];
    function showActionSheet(title, actions) {
        sheetActions = actions;
        $('actionSheetTitle').textContent = title;
        $('actionSheetButtons').innerHTML = actions.map((a, i) =>
            `<button type="button" class="btn action-btn${a.danger ? ' danger' : ''}" data-i="${i}">${escapeHtml(a.label)}</button>`).join('');
        openModal('actionSheet');
    }
    $('actionSheetButtons').addEventListener('click', (e) => {
        const btn = e.target.closest('.action-btn');
        if (!btn) return;
        const action = sheetActions[Number(btn.dataset.i)];
        $('actionSheet').classList.remove('active');
        if (action) action.run();
    });
    $('actionSheetCancel').addEventListener('click', () => $('actionSheet').classList.remove('active'));
    $('actionSheetBackdrop').addEventListener('click', () => $('actionSheet').classList.remove('active'));

    /* ---------------- phone: explorer button + tap next to the sidebar closes it ---------------- */
    $('mobileExplorerBtn').addEventListener('click', () => app.classList.toggle('mobile-open'));
    document.querySelector('.main').addEventListener('pointerdown', (e) => {
        if (!isMobile() || !app.classList.contains('mobile-open')) return;
        if (e.target.closest('#mobileExplorerBtn')) return;
        app.classList.remove('mobile-open');
    });

    /* ---------------- drag & drop on touch screens ----------------
     * Phones don't do HTML drag & drop with a finger. Here a long press (0.3 s)
     * picks an item up and moving the finger drags it; under the hood it fires the
     * same dragstart / dragover / drop / dragend events the mouse version uses,
     * so everything (reorder, move to folder, put on a calendar day) works the same.
     */
    (function setupTouchDragDrop() {
        const LONG_PRESS_MS = 300;
        const MOVE_TOLERANCE = 10;
        let pending = null; // finger is down on a draggable item, waiting for the long press
        let drag = null;    // an item is being dragged

        function fire(type, el, x, y, dt, related) {
            if (!el) return false;
            let ev;
            try {
                ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt, relatedTarget: related || null });
            } catch (_) {
                ev = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperties(ev, {
                    dataTransfer: { value: dt }, clientX: { value: x }, clientY: { value: y }, relatedTarget: { value: related || null }
                });
            }
            el.dispatchEvent(ev);
            return ev.defaultPrevented;
        }

        const touchById = (list, id) => [...list].find((t) => t.identifier === id);

        function cancelPending() {
            if (pending) clearTimeout(pending.timer);
            pending = null;
        }

        function scrollParent(el) {
            for (let n = el; n && n !== document.body; n = n.parentElement) {
                const s = getComputedStyle(n);
                if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
            }
            return null;
        }

        function startDrag() {
            const { source, x, y, id } = pending;
            pending = null;
            if (!document.body.contains(source)) return;
            let dt;
            try { dt = new DataTransfer(); } catch (_) { return; }
            const r = source.getBoundingClientRect();
            drag = { source, dt, id, x, y, startX: x, target: null, accepted: false, dx: x - r.left, dy: y - r.top, raf: 0,
                fromSidebar: !!source.closest('#sidebar') };
            if (fire('dragstart', source, x, y, dt)) { drag = null; return; }
            const ghost = source.cloneNode(true);
            ghost.classList.add('touch-drag-ghost');
            ghost.removeAttribute('id');
            ghost.style.width = `${r.width}px`;
            document.body.appendChild(ghost);
            drag.ghost = ghost;
            document.body.classList.add('touch-dragging');
            source.classList.add('touch-drag-source');
            if (navigator.vibrate) { try { navigator.vibrate(20); } catch (_) { /* ignore */ } }
            moveTo(x, y);
            drag.raf = requestAnimationFrame(autoScroll);
        }

        function moveTo(x, y) {
            drag.x = x;
            drag.y = y;
            drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px)`;
            // On a phone the sidebar covers almost the whole screen. Pull a note sideways
            // (towards the page) and the sidebar slides away so you can drop it on the calendar;
            // moving up and down keeps it open for reordering.
            const appEl = document.getElementById('app');
            if (drag.fromSidebar && appEl.classList.contains('mobile-open')) {
                const sr = document.getElementById('sidebar').getBoundingClientRect();
                const right = !appEl.classList.contains('sidebar-right');
                const pulled = right ? x - drag.startX > 70 : drag.startX - x > 70;
                if (pulled || x > sr.right + 4 || x < sr.left - 4) appEl.classList.remove('mobile-open');
            }
            const target = document.elementFromPoint(x, y);
            if (target !== drag.target) {
                if (drag.target) fire('dragleave', drag.target, x, y, drag.dt, target);
                if (target) fire('dragenter', target, x, y, drag.dt, drag.target);
                drag.target = target;
            }
            drag.accepted = target ? fire('dragover', target, x, y, drag.dt) : false;
        }

        // keep scrolling while the finger rests near the top/bottom edge of a list or page
        function autoScroll() {
            if (!drag) return;
            const scroller = drag.target && scrollParent(drag.target);
            if (scroller) {
                const r = scroller.getBoundingClientRect();
                const edge = 48;
                let dy = 0;
                if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 4);
                else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 4);
                if (dy) { scroller.scrollTop += dy; moveTo(drag.x, drag.y); }
            }
            drag.raf = requestAnimationFrame(autoScroll);
        }

        function endDrag(drop) {
            const d = drag;
            drag = null;
            cancelAnimationFrame(d.raf);
            if (drop && d.accepted && d.target) fire('drop', d.target, d.x, d.y, d.dt);
            fire('dragend', d.source, d.x, d.y, d.dt);
            if (d.ghost) d.ghost.remove();
            d.source.classList.remove('touch-drag-source');
            document.body.classList.remove('touch-dragging');
        }

        document.addEventListener('touchstart', (e) => {
            if (drag) return;
            if (e.touches.length !== 1) { cancelPending(); return; }
            const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
            const source = el && el.closest('[draggable="true"]');
            if (!source || el.closest('button, input, select, textarea, a, .voice-handle')) return;
            const t = e.touches[0];
            cancelPending();
            pending = { source, x: t.clientX, y: t.clientY, id: t.identifier, timer: setTimeout(startDrag, LONG_PRESS_MS) };
        }, { passive: true, capture: true });

        document.addEventListener('touchmove', (e) => {
            if (pending) {
                const t = touchById(e.touches, pending.id);
                if (!t || Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > MOVE_TOLERANCE) cancelPending(); // it's a scroll
                return;
            }
            if (!drag) return;
            const t = touchById(e.touches, drag.id);
            if (!t) return;
            e.preventDefault();
            moveTo(t.clientX, t.clientY);
        }, { passive: false, capture: true });

        document.addEventListener('touchend', (e) => {
            if (pending) { cancelPending(); return; } // a normal tap
            if (!drag || touchById(e.touches, drag.id)) return;
            e.preventDefault(); // no "click" after a drag
            endDrag(true);
        }, { passive: false, capture: true });

        document.addEventListener('touchcancel', () => {
            cancelPending();
            if (drag) endDrag(false);
        }, { capture: true });

        // no long-press menu / text selection while picking something up
        document.addEventListener('contextmenu', (e) => {
            if (pending || drag) e.preventDefault();
        }, { capture: true });

        // some phones start their own drag on long press: ours already handles it
        document.addEventListener('dragstart', (e) => {
            if (e.isTrusted && (pending || drag)) { e.preventDefault(); e.stopImmediatePropagation(); }
        }, { capture: true });
    })();

    /* ---------------- sneltoetsen ---------------- */

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            flushEditor();
            toast('Note saved');
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            newNote();
        }
        // Ctrl+Z / Cmd+Z undoes the last stroke in draw mode and the last fill in grid mode;
        // Ctrl+Y (or Ctrl+Shift+Z) redoes it
        const key = e.key.toLowerCase();
        const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'z';
        const isRedo = (e.ctrlKey || e.metaKey) && !e.altKey && ((key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey));
        if (isUndo || isRedo) {
            const mode = state.prefs.mode;
            const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
            const modalOpen = document.querySelector('.modal.active');
            if ((mode === 'draw' || mode === 'grid') && state.prefs.activeTab !== 'calendar' && !modalOpen
                && !(typing && typing.offsetParent !== null) && state.currentNoteId
                && !isPrivateLocked(noteById(state.currentNoteId))) {
                e.preventDefault();
                if (isUndo) $(mode === 'draw' ? 'toolUndo' : 'gridUndo').click();
                else if (mode === 'draw') redoDraw();
                else redoGrid();
            }
        }
        if (gridTool === 'select' && (gridPick.length || gridCopyMode) && gridPickActive()) {
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteGridPick(); return; }
            if (e.key === 'Escape') { gridPick = []; gridCopyMode = false; renderGrid(); updateGridPickBar(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); copyGridPick(); return; }
        }
        if (drawPick.length && state.draw.tool === 'select' && drawPickActive()) {
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deletePick(); return; }
            if (e.key === 'Escape') { drawPick = []; renderStrokes(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicatePick(); return; }
        }
        if (drawSel && state.prefs.mode === 'draw' && !document.querySelector('.modal.active')) {
            const t = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
            if (!(t && t.offsetParent !== null)) {
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedPicture(); return; }
                if (e.key === 'Escape') { drawSel = null; renderStrokes(); return; }
            }
        }
        if (e.key === 'Escape') closeModals();
    });

    /* ---------------- start ---------------- */

    load();
    applyLayout();
    state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
    state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;

    if (!state.prefs.expandedFolders.length) {
        state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];
    }

    renderTree();
    renderEditor();
    setTab(state.prefs.activeTab === 'calendar' ? 'calendar' : 'note');

    if ('Notification' in window && Notification.permission === 'default') {
        document.addEventListener('click', () => {
            if (Notification.permission === 'default') Notification.requestPermission();
        }, { once: true });
    }

    // Browsers only allow sound after a user interaction: unlock it on the first click
    document.addEventListener('pointerdown', () => { getAudioContext(); }, { once: true });

    checkAlarms();
    setInterval(checkAlarms, 5000);

    window.addEventListener('beforeunload', flushEditor);
    window.addEventListener('resize', () => {
        fitCanvas();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });

    syncReady = true;
    updateGithubStatus();
    if (autoProviders().length) {
        setTimeout(() => syncAll(autoProviders(), { silent: true }), 400);
    }
    window.Remindate = { exportData, importData };
})();
