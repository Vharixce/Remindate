/* Remindate Web
 * Notes, folders, calendar and drawing. All data is stored locally in the browser
 * (local storage), so no server or account is required.
 */
(() => {
    'use strict';

    const STORAGE = {
        notes: 'remindate.notes.v1',
        folders: 'remindate.folders.v1',
        prefs: 'remindate.prefs.v1',
        alarms: 'remindate.alarms.v1',
        fileHandle: 'remindate.fileHandle.v1',
        deleted: 'remindate.deleted.v1',
        trash: 'remindate.trash.v1',
        updatedAt: 'remindate.updatedAt.v1',
        github: 'remindate.github.v1'
    };

    const fileSync = {
        handle: null,
        enabled: false
    };

    // [color, name] in display order
    const PALETTE_NAMED = [
        ['#000000', 'Black'], ['#4b5563', 'Dark grey'], ['#d1d5db', 'Light grey'], ['#ffffff', 'White'],
        ['#fca5a5', 'Light red'], ['#ef4444', 'Bright red'], ['#991b1b', 'Dark red'],
        ['#fdba74', 'Light orange'], ['#f97316', 'Bright orange'], ['#c2410c', 'Dark orange'],
        ['#facc15', 'Yellow'],
        ['#86efac', 'Light green'], ['#22c55e', 'Bright green'], ['#166534', 'Dark green'],
        ['#14b8a6', 'Turquoise'], ['#22d3ee', 'Cyan'],
        ['#3b82f6', 'Blue'], ['#1e3a8a', 'Dark blue'],
        ['#c4b5fd', 'Light purple'], ['#8b5cf6', 'Purple'], ['#d946ef', 'Magenta'], ['#6366f1', 'Blue-purple']
    ];
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
    }

    function migrateNote(note) {
        note.id = note.id || uid();
        note.title = note.title || '';
        note.content = note.content || '';
        note.createdAt = note.createdAt || new Date().toISOString();
        note.modifiedAt = note.modifiedAt || note.createdAt;
        note.scheduledAt = note.scheduledAt || null;
        note.folderId = note.folderId || null;
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
    }

    // Every local change records "now" as the time of the latest local version
    function markChanged() {
        state.updatedAt = new Date().toISOString();
        writeJSON(STORAGE.updatedAt, state.updatedAt);
        writeJSON(STORAGE.deleted, state.deleted);
        if (typeof updateGithubStatus === 'function' && !githubBusy) updateGithubStatus();
    }
    const saveNotes = () => {
        writeJSON(STORAGE.notes, state.notes);
        markChanged();
        scheduleFileSave();
        scheduleGithubSave();
    };
    const saveFolders = () => {
        writeJSON(STORAGE.folders, state.folders);
        markChanged();
        scheduleFileSave();
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
        const preview = note.content.trim()
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
        return `<div class="note-item ${note.id === state.currentNoteId ? 'active' : ''}" data-note-id="${note.id}">
            <span class="item-actions">
                <button class="folder-action-btn note-rename" data-note-id="${note.id}" title="Rename note">Rename</button>
                <button class="folder-action-btn folder-delete note-delete" data-note-id="${note.id}" title="Delete note">Delete</button>
            </span>
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

        sortedFolders().forEach((folder) => {
            const notes = sortedNotes(state.notes.filter((n) => n.folderId === folder.id));
            const expanded = state.prefs.expandedFolders.includes(folder.id);
            const group = document.createElement('div');
            group.className = 'folder';
            group.innerHTML = `
                <div class="folder-header" data-folder-id="${folder.id}" draggable="true" title="Drag to reorder">
                    <span class="folder-chevron">${expanded ? '&#9662;' : '&#9656;'}</span>
                    <span class="folder-name">${escapeHtml(folder.name || 'Folder')}</span>
                    <span class="folder-actions">
                        <button class="folder-action-btn folder-rename" data-folder-id="${folder.id}" title="Rename folder">Rename</button>
                        <button class="folder-action-btn folder-delete" data-folder-id="${folder.id}" title="Delete folder">Delete</button>
                    </span>
                    <button class="folder-add" data-folder-id="${folder.id}" title="New note in this folder">+</button>
                </div>
                ${expanded ? `<div class="folder-items">${notes.length ? notes.map(noteItemHtml).join('') : '<div class="folder-empty">Empty</div>'}</div>` : ''}
            `;
            treeEl.appendChild(group);
        });

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

    function moveFolderNextTo(folderId, targetId, after) {
        if (folderId === targetId) return;
        const list = sortedFolders();
        const folder = list.find((f) => f.id === folderId);
        if (!folder) return;
        const rest = list.filter((f) => f.id !== folderId);
        let index = targetId === '__none' ? rest.length : rest.findIndex((f) => f.id === targetId) + (after ? 1 : 0);
        if (index < 0) index = rest.length;
        rest.splice(index, 0, folder);
        const now = new Date().toISOString();
        rest.forEach((f, i) => { if (f.order !== i) { f.order = i; f.modifiedAt = now; } });
        state.folders = rest;
        saveFolders();
        renderTree();
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
        treeEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
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
            if (target.dataset.folderId === draggedFolderId) return;
            const rect = target.getBoundingClientRect();
            const after = target.dataset.folderId === '__none' ? false : e.clientY > rect.top + rect.height / 2;
            target.classList.add(after ? 'drop-after' : 'drop-before');
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
        if (!draggedTreeNoteId && !e.dataTransfer.types.includes('text/plain')) return;
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
            const id = draggedFolderId;
            draggedFolderId = null;
            clearTreeDropMarkers();
            if (!target) return;
            e.preventDefault();
            moveFolderNextTo(id, target.dataset.folderId, after);
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
            const preview = (t.note.content || '').replace(/\s+/g, ' ').trim().slice(0, 70) ||
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
        return '<option value="">No folder</option>' + state.folders.map((f) =>
            `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
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

        if (empty) {
            $('noteTitle').value = '';
            editorEl.innerHTML = '';
            $('noteFolder').innerHTML = folderOptions('');
            state.draw.strokes = [];
            updateScheduleUi(null);
            setMode('text');
            return;
        }

        $('noteTitle').value = note.title;
        stopVoicePlayback();
        editorEl.innerHTML = sanitizeHtml(note.html);
        decorateVoiceChips();
        $('gridType').value = currentGridType(note);
        $('noteFolder').innerHTML = folderOptions(note.folderId);
        updateScheduleUi(note);

        state.draw.strokes = note.strokes.map((s) => ({
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: (s.points || []).map((p) => ({ x: p.x, y: p.y }))
        }));

        setMode(state.prefs.mode);
        fitCanvas();
        renderStrokes();
    }

    let editorTimer = null;
    function queueSave() {
        clearTimeout(editorTimer);
        editorTimer = setTimeout(flushEditor, 600);
    }

    function flushEditor() {
        clearTimeout(editorTimer);
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const title = $('noteTitle').value;
        let html = note.html;
        let content = note.content;
        if (textDirty) {
            html = sanitizeHtml(editorEl.innerHTML);
            content = htmlToText(html);
        }
        const folderId = $('noteFolder').value || null;
        const strokes = state.draw.strokes.map((s) => ({
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: s.points.map((p) => ({ x: p.x, y: p.y }))
        }));
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
        'IMG', 'SPAN', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);
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
        return root.innerHTML;
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
    }

    editorEl.addEventListener('input', markTextChanged);

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

    async function insertImageFiles(files) {
        if (!noteById(state.currentNoteId)) return;
        const images = [...files].filter((f) => f.type.startsWith('image/'));
        if (!images.length) return;
        for (const file of images) {
            try {
                const src = await imageFileToDataUrl(file);
                ensureCaretInEditor();
                // the image gets its own line, and you continue typing below it
                const ok = document.execCommand('insertHTML', false, `<div><img src="${src}" alt=""></div><div><br></div>`);
                if (!ok) {
                    const img = document.createElement('img');
                    img.src = src;
                    insertNodeAtCaret(img);
                }
            } catch (err) {
                toast(`Could not load image: ${file.name}`);
            }
        }
        textDirty = true;
        flushEditor();
    }

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
        if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
    });
    editorEl.addEventListener('drop', (e) => {
        if (draggingAppItem()) { e.preventDefault(); return; }
        const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
        const audio = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('audio/'));
        if (!files.length && !audio.length) return;
        e.preventDefault();
        placeCaretAtPoint(e.clientX, e.clientY);
        if (files.length) insertImageFiles(files);
        if (audio.length) insertAudioFiles(audio);
    });

    function selectImage(img) {
        editorEl.querySelectorAll('img.selected').forEach((i) => i.classList.remove('selected'));
        selectedImg = img || null;
        if (selectedImg) selectedImg.classList.add('selected');
        $('imageTools').hidden = !selectedImg;
    }

    editorEl.addEventListener('click', (e) => {
        if (e.target.closest('.voice-chip')) { handleVoiceChipClick(e); return; }
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
    // Toolbar buttons must not take the focus away from the text
    $('textToolbar').addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) e.preventDefault();
    });
    $('textToolbar').addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]');
        if (cmd) {
            if (!noteById(state.currentNoteId)) return;
            editorEl.focus();
            document.execCommand(cmd.dataset.cmd, false, null);
            markTextChanged();
            return;
        }
        const size = e.target.closest('[data-img-size]');
        if (size && selectedImg) {
            selectedImg.style.width = `${size.dataset.imgSize}%`;
            markTextChanged();
        }
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
        return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']
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

    $('newFolderBtn').addEventListener('click', async () => {
        const name = await askText('New folder', 'New folder', 'Create');
        if (!name || !name.trim()) return;
        const folder = { id: uid(), name: name.trim(), modifiedAt: new Date().toISOString(),
            order: state.folders.reduce((m, f) => Math.max(m, typeof f.order === 'number' ? f.order : 0), -1) + 1 };
        state.folders.push(folder);
        state.prefs.expandedFolders.push(folder.id);
        saveFolders();
        savePrefs();
        renderTree();
        if (state.currentNoteId) $('noteFolder').innerHTML = folderOptions(noteById(state.currentNoteId)?.folderId);
    });

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
        const ok = await askConfirm('Delete folder', `Delete folder "${folder.name}"? The notes in it are kept and moved to "No folder".`, 'Delete');
        if (!ok || !state.folders.includes(folder)) return;
        const now = new Date().toISOString();
        state.folders = state.folders.filter((f) => f.id !== id);
        state.deleted.folders[id] = now;
        state.notes.forEach((n) => { if (n.folderId === id) { n.folderId = null; n.modifiedAt = now; } });
        state.prefs.expandedFolders = state.prefs.expandedFolders.filter((f) => f !== id);
        if (state.currentFolderId === id) state.currentFolderId = null;
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
            $('repeatCount').value = 0;
            $('snoozeMinutes').value = 5;
            $('repeatCountLabel').textContent = '0';
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
        $('repeatCount').value = note.alarmRepeatCount;
        $('snoozeMinutes').value = note.alarmSnoozeMinutes;
        $('repeatCountLabel').textContent = note.alarmRepeatCount;
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

    const NOTE_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#22d3ee', '#3b82f6',
        '#1e3a8a', '#8b5cf6', '#d946ef', '#fca5a5', '#86efac', '#4b5563', '#d1d5db'];

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
            ? `🔔 Alarm on${note.alarmRepeatCount ? `, rings ${note.alarmRepeatCount + 1}× (every ${note.alarmSnoozeMinutes} min)` : ''}`
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
        note.alarmRepeatCount = Number($('repeatCount').value);
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
        notes.push('One-time setup: the email workflow must be set up on GitHub (see <b>EMAIL-SETUP.md</b> in the Remindate folder). Emails can arrive a few minutes late.');
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
    $('emailSave').addEventListener('click', saveEmailSettings);
    $('emailAddress').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveEmailSettings(); } });
    $('emailCancel').addEventListener('click', closeEmailModal);
    $('emailClose').addEventListener('click', closeEmailModal);
    $('emailBackdrop').addEventListener('click', closeEmailModal);
    $('emailTurnOff').addEventListener('click', () => {
        if (emailTarget) emailTarget.off();
        closeEmailModal();
    });
    $('repeatCount').addEventListener('input', () => {
        $('repeatCountLabel').textContent = $('repeatCount').value;
    });
    $('repeatCount').addEventListener('change', scheduleChanged);
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
        state.prefs.activeTab = tab;
        savePrefs();
        $('tabNote').classList.toggle('active', tab === 'note');
        $('tabCalendar').classList.toggle('active', tab === 'calendar');
        $('viewNote').style.display = tab === 'note' ? 'flex' : 'none';
        $('viewCalendar').style.display = tab === 'calendar' ? 'flex' : 'none';
        if (tab === 'calendar') renderCalendar();
    }

    $('tabNote').addEventListener('click', () => setTab('note'));
    $('tabCalendar').addEventListener('click', () => setTab('calendar'));

    /* ---------------- calendar ---------------- */

    $('calendarWeekdays').innerHTML = WEEKDAYS
        .map((d) => `<div class="calendar-weekday">${d}</div>`).join('');

    function renderCalendar() {
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
            `<button class="btn btn-primary calendar-add-note" id="calendarAddNote" type="button" title="New note on this day">+ Note</button></div>` +
            holidayHtml + (notes.length
            ? notes.map((n) => `<div class="calendar-note-item${n.color ? ' colored' : ''}" draggable="true" data-note-id="${n.id}" style="${n.color ? `border-left-color:${n.color}` : ''}" title="Click to open – drag to another day">
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
        { code: 'GB', label: 'British', short: 'UK' },
        { code: 'NL', label: 'Dutch', short: 'NL' },
        { code: 'FR', label: 'French', short: 'FR' },
        { code: 'SE', label: 'Swedish', short: 'SE' },
        { code: 'DE', label: 'German', short: 'DE' },
        { code: 'JP', label: 'Japanese', short: 'JP' }
    ];

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

    function holidayList(code, y) {
        const E = easterSunday(y);
        const H = (date, name, local) => ({ date, name, local: local || '', obs: false });
        // observance: a special day, but not a day off
        const O = (date, name, local) => ({ date, name, local: local || '', obs: true });
        const lastSunday = (m) => lastWeekday(y, m, 0);
        switch (code) {
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
        if (chip) {
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
        if (!draggedTreeNoteId && !e.dataTransfer.types.includes('text/plain')) return;
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

    $('calendarDayNotes').addEventListener('click', (e) => {
        if (e.target.closest('#calendarAddNote')) {
            const d = state.calendarDay;
            if (!d) return;
            newNote({ scheduledAt: toLocalIso(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0)) });
            toast(`New note on ${d.getDate()} ${MONTHS[d.getMonth()]} – give it a title`);
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
        $('planFromTreeRepeat').value = note.alarmRepeatCount || 0;
        $('planFromTreeSnooze').value = note.alarmSnoozeMinutes || 5;
        $('planFromTreeRepeatLabel').textContent = $('planFromTreeRepeat').value;
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

    $('planFromTreeRepeat').addEventListener('input', () => {
        $('planFromTreeRepeatLabel').textContent = $('planFromTreeRepeat').value;
    });
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
        note.alarmRepeatCount = Number($('planFromTreeRepeat').value);
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
    function createZoom(viewport, content, onPinchStart) {
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
        state.draw.strokes.forEach(drawStroke);
    }

    function drawStroke(stroke) {
        if (!stroke.points.length) return;
        ctx.strokeStyle = stroke.color || '#000000';
        ctx.lineWidth = Math.max(1, (stroke.thicknessRatio || 0.006) * canvas.width);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const first = stroke.points[0];
        ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = stroke.points[i];
            ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
        }
        if (stroke.points.length === 1) {
            ctx.lineTo(first.x * canvas.width + 0.01, first.y * canvas.height);
        }
        ctx.stroke();
    }

    function pointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
        };
    }

    function startStroke(e) {
        if (state.prefs.mode !== 'draw' || drawZoom.isPinching()) return;
        e.preventDefault();
        const note = noteById(state.currentNoteId);
        if (!note) return;

        if (state.draw.tool === 'fill') {
            note.canvasBackground = state.draw.color;
            touch(note);
            renderStrokes();
            return;
        }

        const pos = pointerPos(e);
        if (state.draw.tool === 'eraser') {
            state.draw.drawing = true;
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
        state.draw.strokes.push(state.draw.current);
        state.draw.drawing = true;
        renderStrokes();
    }

    function moveStroke(e) {
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
        if (!state.draw.drawing) return;
        state.draw.drawing = false;
        state.draw.current = null;
        flushEditor();
    }

    function eraseAt(pos) {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const radius = Math.max(0.006, (state.draw.size / 2) / (canvas.clientWidth || canvas.width));
        const before = state.draw.strokes.length;
        state.draw.strokes = state.draw.strokes.filter((stroke) =>
            !stroke.points.some((p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= radius)
        );
        if (state.draw.strokes.length !== before) {
            renderStrokes();
            flushEditor();
        }
    }

    canvas.addEventListener('pointerdown', startStroke);
    canvas.addEventListener('pointermove', moveStroke);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    window.addEventListener('resize', fitCanvas);

    function setTool(tool) {
        state.draw.tool = tool;
        $('toolPen').classList.toggle('active', tool === 'pen');
        $('toolEraser').classList.toggle('active', tool === 'eraser');
        $('toolFill').classList.toggle('active', tool === 'fill');
        canvas.style.cursor = tool === 'eraser' ? 'cell' : (tool === 'fill' ? 'copy' : 'crosshair');
    }

    $('toolPen').addEventListener('click', () => setTool('pen'));
    $('toolEraser').addEventListener('click', () => setTool('eraser'));
    $('toolFill').addEventListener('click', () => setTool('fill'));

    $('toolUndo').addEventListener('click', () => {
        state.draw.strokes.pop();
        renderStrokes();
        flushEditor();
    });

    $('toolClear').addEventListener('click', async () => {
        if (!state.draw.strokes.length) return;
        if (!(await askConfirm('Clear drawing', 'Clear the entire drawing?', 'Clear'))) return;
        state.draw.strokes = [];
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
    let gridHistory = [];    // undo steps for the open note

    // All cell polygons for a grid type, in coordinates 0..1 (the canvas is square)
    function buildGrid(type) {
        if (gridCache[type]) return gridCache[type];
        const cells = [];
        const add = (id, pts) => {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
            if (x1 <= 0 || y1 <= 0 || x0 >= 1 || y0 >= 1) return;
            cells.push({ id, pts, x0, y0, x1, y1 });
        };
        const A = GRID_CELL_AREA;

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
                for (let k = 0; k < 6; k++) {
                    const t = (Math.PI / 180) * (60 * k - 90);
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

        // bucket index for fast "which cell is under the pen?"
        const B = 40;
        const buckets = Array.from({ length: B * B }, () => []);
        const clampB = (v) => Math.min(B - 1, Math.max(0, Math.floor(v * B)));
        cells.forEach((c) => {
            for (let by = clampB(c.y0); by <= clampB(c.y1); by++) {
                for (let bx = clampB(c.x0); bx <= clampB(c.x1); bx++) buckets[by * B + bx].push(c);
            }
        });
        const byId = new Map(cells.map((c) => [c.id, c]));
        gridCache[type] = { cells, buckets, B, clampB, byId };
        return gridCache[type];
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
        const type = currentGridType(note);
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

    function tracePoly(c) {
        const W = gridCanvas.width, H = gridCanvas.height;
        gctx.moveTo(c.pts[0][0] * W, c.pts[0][1] * H);
        for (let i = 1; i < c.pts.length; i++) gctx.lineTo(c.pts[i][0] * W, c.pts[i][1] * H);
        gctx.closePath();
    }

    function renderGrid() {
        const note = noteById(state.currentNoteId);
        const bg = (note && note.canvasBackground) || DEFAULT_CANVAS_BG;
        const W = gridCanvas.width, H = gridCanvas.height;
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.fillStyle = bg;
        gctx.fillRect(0, 0, W, H);
        if (!note) return;
        const grid = buildGrid(currentGridType(note));
        const cells = gridCellsOf(note);
        grid.cells.forEach((c) => {
            const color = cells[c.id];
            if (!color) return;
            gctx.beginPath();
            tracePoly(c);
            gctx.fillStyle = color;
            gctx.fill();
        });
        gctx.beginPath();
        grid.cells.forEach(tracePoly);
        gctx.strokeStyle = gridLineColor(bg);
        gctx.lineWidth = Math.max(1, W / 1600);
        gctx.stroke();
    }

    function paintGridCell(c, color, bg) {
        gctx.beginPath();
        tracePoly(c);
        gctx.fillStyle = color || bg;
        gctx.fill();
        gctx.strokeStyle = gridLineColor(bg);
        gctx.lineWidth = Math.max(1, gridCanvas.width / 1600);
        gctx.stroke();
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
        const grid = buildGrid(currentGridType(note));
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
        gridStroke = { changes: new Map(), last: pos, type: currentGridType(note) };
        gridPaintAt(note, pos);
    });

    gridCanvas.addEventListener('pointermove', (e) => {
        if (!gridStroke) return;
        e.preventDefault();
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const pos = gridPos(e);
        const { last } = gridStroke;
        const dist = Math.hypot(pos.x - last.x, pos.y - last.y);
        const steps = Math.max(1, Math.ceil(dist / (Math.sqrt(GRID_CELL_AREA) * 0.25)));
        for (let i = 1; i <= steps; i++) {
            gridPaintAt(note, { x: last.x + (pos.x - last.x) * (i / steps), y: last.y + (pos.y - last.y) * (i / steps) });
        }
        gridStroke.last = pos;
    });

    function endGridStroke() {
        if (!gridStroke) return;
        const stroke = gridStroke;
        gridStroke = null;
        const note = noteById(state.currentNoteId);
        if (!note || !stroke.changes.size) return;
        gridHistory.push(stroke);
        if (gridHistory.length > 100) gridHistory.shift();
        touch(note);
        renderTree();
    }

    function revertGridChanges(note, stroke) {
        const cells = note.grids[stroke.type] || (note.grids[stroke.type] = {});
        stroke.changes.forEach((prev, id) => {
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

    const gridZoom = createZoom(gridContainer, gridCanvas, cancelGridStroke);

    function setGridTool(tool) {
        gridTool = tool;
        $('gridPen').classList.toggle('active', tool === 'pen');
        $('gridEraser').classList.toggle('active', tool === 'eraser');
        gridCanvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
    }

    $('gridPen').addEventListener('click', () => setGridTool('pen'));
    $('gridEraser').addEventListener('click', () => setGridTool('eraser'));
    $('gridColorSwatch').addEventListener('click', () => openModal('colorModal'));
    $('gridBg').addEventListener('click', () => $('toolCanvasBg').click());

    $('gridType').addEventListener('change', () => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.gridType = $('gridType').value;
        gridHistory = [];
        touch(note);
        renderGrid();
    });

    $('gridUndo').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        const stroke = gridHistory.pop();
        if (!note || !stroke) return;
        revertGridChanges(note, stroke);
        touch(note);
        renderGrid();
    });

    $('gridClear').addEventListener('click', async () => {
        const note = noteById(state.currentNoteId);
        if (!note || !Object.keys(gridCellsOf(note)).length) return;
        if (!(await askConfirm('Clear grid', 'Clear all filled cells of this grid?', 'Clear'))) return;
        note.grids[currentGridType(note)] = {};
        gridHistory = [];
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
        if ($('emailModal').classList.contains('active')) { closeEmailModal(); return; }
        document.querySelectorAll('.modal.active').forEach((m) => m.classList.remove('active'));
    }

    /* In-app dialogs. Browser prompt()/confirm() can be silently blocked
     * (e.g. after ticking "prevent this page from creating dialogs"). */
    let dialogResolve = null;

    function askDialog({ title, message = '', input = null, okLabel = 'OK', danger = false, altLabel = null }) {
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
    $('toggleSidebarMain').addEventListener('click', () => {
        syncHolidayCheckboxes();
        $('settingsModal').classList.add('active');
    });
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
        if (!githubConfigured()) { el.textContent = 'GitHub: not configured'; el.title = ''; return; }
        const where = `${githubConfig.owner}/${githubConfig.repo}/${githubConfig.path}`;
        el.textContent = githubConfig.lastSyncAt
            ? `GitHub: synced ${shortTime(githubConfig.lastSyncAt)} • last change ${shortTime(laterIso(state.updatedAt, githubConfig.remoteUpdatedAt))}`
            : `GitHub: ${where} • not synced yet`;
        el.title = `${where}\nLast sync: ${shortTime(githubConfig.lastSyncAt)}\nLast change on this device: ${shortTime(state.updatedAt)}\nLatest version on GitHub: ${shortTime(githubConfig.remoteUpdatedAt)}`;
    }

    function showGithubSettings() {
        $('ghOwner').value = githubConfig.owner || '';
        $('ghRepo').value = githubConfig.repo || '';
        $('ghPath').value = githubConfig.path || 'notes.json';
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

    function githubUrl() {
        return `https://api.github.com/repos/${encodeURIComponent(githubConfig.owner)}/${encodeURIComponent(githubConfig.repo)}/contents/${githubConfig.path.split('/').map(encodeURIComponent).join('/')}`;
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
        if (!Array.isArray(notes)) throw new Error('notes.json on GitHub does not contain a valid note list');
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
        scheduleFileSave();

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
        const meta = await githubRequest('GET');
        if (!meta) return null;
        let text;
        if (meta.content && meta.encoding === 'base64') text = decodeGithubFile(meta.content);
        else text = await githubRequest('GET', null, githubUrl(), 'application/vnd.github.raw+json'); // files > 1 MB
        return { sha: meta.sha, data: text && text.trim() ? JSON.parse(text) : [] };
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
        githubConfig.sha = result.content.sha;
        githubConfig.remoteUpdatedAt = payload.updatedAt;
    }

    // Sync = 1) fetch the newest version from GitHub, 2) merge it with this
    // device, 3) push the result back (only if GitHub doesn't have it yet).
    async function syncGithub(options = {}) {
        if (!githubConfigured()) return;
        if (githubBusy) { githubPending = true; return; }
        githubBusy = true;
        let pulled = false, pushed = false;
        try {
            if (options.flush !== false) flushEditor();
            for (let attempt = 0; attempt < 4; attempt++) {
                updateGithubStatus('GitHub: fetching…');
                const local = localSnapshot();
                const remote = await fetchRemote();
                // You edited something while we were fetching: start over with the new data
                if (state.updatedAt !== local.updatedAt) continue;

                let merged = local;
                let remoteSnap = null;
                if (remote) {
                    remoteSnap = normalizeSnapshot(remote.data);
                    merged = mergeSnapshots(local, remoteSnap);
                    githubConfig.remoteUpdatedAt = remoteSnap.updatedAt;
                }
                if (snapshotKey(merged) !== snapshotKey(local)) {
                    applySnapshot(merged);
                    pulled = true;
                }
                if (!remote || snapshotKey(merged) !== snapshotKey(remoteSnap)) {
                    updateGithubStatus('GitHub: pushing…');
                    try {
                        await pushRemote(merged, remote && remote.sha);
                        pushed = true;
                    } catch (err) {
                        // Someone else pushed in between (409/422): fetch again and retry
                        if (err.status === 409 || err.status === 422) continue;
                        throw err;
                    }
                } else {
                    githubConfig.sha = remote.sha;
                }
                githubConfig.lastSyncAt = new Date().toISOString();
                writeJSON(STORAGE.github, githubConfig);
                updateGithubStatus();
                if (!options.silent) {
                    toast(pulled && pushed ? 'Fetched changes from GitHub and pushed yours'
                        : pulled ? 'Fetched the latest changes from GitHub'
                            : pushed ? 'Pushed your changes to GitHub'
                                : 'Already up to date with GitHub');
                }
                return;
            }
            throw new Error('the data kept changing during sync, please try again');
        } catch (err) {
            console.error('GitHub sync failed', err);
            updateGithubStatus('GitHub: sync failed');
            toast(`GitHub sync failed: ${err.message}`);
        } finally {
            githubBusy = false;
            if (githubPending) {
                githubPending = false;
                syncGithub({ silent: true, flush: false });
            }
        }
    }

    function scheduleGithubSave() {
        if (!githubConfig.autoSync || !githubConfigured()) return;
        clearTimeout(githubTimer);
        githubTimer = setTimeout(() => syncGithub({ silent: true }), 1500);
    }

    // With auto-sync on, also fetch from GitHub regularly and when you come back to the tab
    let lastAutoPull = 0;
    function autoPull() {
        if (!githubConfig.autoSync || !githubConfigured() || document.hidden) return;
        if (Date.now() - lastAutoPull < 30000) return;
        lastAutoPull = Date.now();
        syncGithub({ silent: true, flush: true });
    }
    window.addEventListener('focus', autoPull);
    document.addEventListener('visibilitychange', autoPull);
    setInterval(autoPull, 120000);

    $('githubOpenBtn').addEventListener('click', showGithubSettings);
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
        $('ghPath').value = 'notes.json';
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
        if (!githubConfigured()) return showGithubSettings();
        syncGithub();
    });

    /* ---------------- back-up ---------------- */

    function exportData() {
        flushEditor();
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
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `remindate-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importData(file) {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                const notes = Array.isArray(data) ? data : data.notes;
                const folders = Array.isArray(data) ? [] : (data.folders || []);
                if (!Array.isArray(notes)) throw new Error('No notes found');

                if (!(await askConfirm('Restore backup', 'This replaces your current notes and folders. Continue?', 'Replace'))) return;

                state.notes = notes.map((n) => { migrateNote(n); return n; });
                state.folders = Array.isArray(folders) ? folders : [];
                state.folders.forEach(migrateFolder);
                state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
                state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
                state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];

                saveNotes();
                saveFolders();
                savePrefs();
                renderTree();
                renderEditor();
                toast('Backup imported');
            } catch (err) {
                toast('Could not read this file: ' + err.message);
            }
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
                    repeatsLeft: note.alarmRepeatCount,
                    snoozeMinutes: note.alarmSnoozeMinutes,
                    nextAt: now - dueTime > ALARM_GRACE_MS ? null : dueTime
                };
                state.alarms[note.id] = runtime;
                changed = true;
            }

            if (runtime.nextAt === null || runtime.nextAt > now) return;

            if (runtime.repeatsLeft > 0) {
                runtime.repeatsLeft -= 1;
                runtime.nextAt = now + runtime.snoozeMinutes * 60000;
            } else {
                runtime.nextAt = null;
            }
            changed = true;
            saveAlarms();
            showAlarm(note, dueTime);
        });

        if (changed) saveAlarms();
    }

    function showAlarm(note, dueTime) {
        const title = note.title.trim() || 'Untitled';
        const body = note.content.trim().slice(0, 120) || 'Scheduled note';
        notify(title, body);
        playAlarmSound();
        toast(`Alarm: ${title} - ${formatTime(toLocalIso(new Date(dueTime)))}`, {
            label: 'Stop alarm',
            persistent: true,
            key: 'alarm-' + note.id,
            onClick: () => {
                stopAlarmSound();
                const runtime = state.alarms[note.id];
                if (runtime && runtime.dueTime === dueTime) {
                    runtime.nextAt = null;
                    runtime.repeatsLeft = 0;
                    saveAlarms();
                }
            }
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
            alarmAudio.play().catch(() => {});
            return;
        }
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

    function notify(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            try {
                new Notification(title, { body, icon: 'icon.svg' });
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

        if (action) {
            const btn = document.createElement('button');
            btn.className = 'toast-action';
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                action.onClick();
                el.remove();
            });
            el.appendChild(btn);
        }

        host.appendChild(el);
        if (!action?.persistent) {
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.remove(), action ? 20000 : 3500);
        }
    }

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

    function updateSyncStatus() {
        const el = $('syncStatus');
        if (!el) return;
        if (fileSync.enabled && fileSync.handle) {
            el.textContent = `Linked to notes.json • Auto-save • ${fileSync.handle.name || ''}`;
        } else {
            el.textContent = 'No file linked • Local storage only • Use “Choose notes.json” or export/import';
        }
    }

    function buildNotesPayload() {
        return {
            app: 'Remindate',
            version: 1,
            updatedAt: state.updatedAt,
            folders: state.folders,
            notes: state.notes,
            deleted: state.deleted
        };
    }

    function applyNotesPayload(data) {
        const notes = Array.isArray(data) ? data : data.notes;
        const folders = Array.isArray(data) ? [] : (data.folders || []);
        if (!Array.isArray(notes)) throw new Error('No notes found in notes.json');
        state.notes = notes.map((n) => { migrateNote(n); return n; });
        state.folders = Array.isArray(folders) ? folders : [];
        state.folders.forEach(migrateFolder);
        if (!Array.isArray(data)) state.deleted = normalizeDeleted(data.deleted);
        state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
        state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
        state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];
        saveNotes();
        saveFolders();
        renderTree();
        renderEditor();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    async function writeToFileHandle() {
        if (!fileSync.enabled || !fileSync.handle) return;
        if (typeof fileSync.handle.queryPermission === 'function') {
            const perm = await fileSync.handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const req = await fileSync.handle.requestPermission({ mode: 'readwrite' });
                if (req !== 'granted') {
                    toast('No write access to notes.json');
                    return;
                }
            }
        }
        try {
            const writable = await fileSync.handle.createWritable();
            await writable.write(JSON.stringify(buildNotesPayload(), null, 2));
            await writable.close();
        } catch (err) {
            console.error('Could not write to notes.json', err);
            toast('Could not write to notes.json');
        }
    }

    let fileSaveTimer = null;
    function scheduleFileSave() {
        if (!fileSync.enabled || !fileSync.handle) return;
        clearTimeout(fileSaveTimer);
        fileSaveTimer = setTimeout(writeToFileHandle, 800);
    }

    async function pickNotesFile() {
        if (!('showOpenFilePicker' in window)) {
            toast('File System Access API is not supported in this browser');
            alert('Choosing notes.json is supported in Chrome, Edge, or Opera on desktop. Safari and iOS do not support it.');
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Remindate notes',
                    accept: { 'application/json': ['.json'] }
                }],
                multiple: false
            });
            fileSync.handle = handle;
            fileSync.enabled = true;
            updateSyncStatus();
            const file = await handle.getFile();
            const text = await file.text();
            try {
                const data = JSON.parse(text);
                applyNotesPayload(data);
                toast('notes.json loaded and linked');
            } catch (err) {
                console.error(err);
                toast('Could not read notes.json');
            }
            await writeToFileHandle();
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error(err);
            toast('Could not open notes.json');
        }
    }

    async function loadFromSameDir() {
        if (!('showOpenFilePicker' in window)) {
            toast('Not supported in this browser');
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Remindate notes.json',
                    accept: { 'application/json': ['.json'] }
                }],
                startIn: 'documents',
                multiple: false
            });
            fileSync.handle = handle;
            fileSync.enabled = true;
            updateSyncStatus();
            const file = await handle.getFile();
            const text = await file.text();
            applyNotesPayload(JSON.parse(text));
            toast('notes.json loaded from selected file');
            await writeToFileHandle();
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error(err);
        }
    }

    $('pickNotesFileBtn').addEventListener('click', pickNotesFile);
    $('loadFromDirBtn').addEventListener('click', loadFromSameDir);
    $('saveToFileBtn').addEventListener('click', async () => {
        if (!fileSync.enabled) {
            toast('Choose notes.json first');
            return;
        }
        await writeToFileHandle();
        toast('Saved to notes.json');
    });

    window.addEventListener('beforeunload', flushEditor);
    window.addEventListener('resize', () => {
        fitCanvas();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    });

    updateSyncStatus();
    updateGithubStatus();
    if (githubConfig.autoSync && githubConfigured()) {
        setTimeout(() => syncGithub({ silent: true }), 400);
    }
    window.Remindate = { exportData, importData };
})();
