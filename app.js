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
        note.alarmRepeatCount = Number(note.alarmRepeatCount) || 0;
        note.alarmSnoozeMinutes = Number(note.alarmSnoozeMinutes) || 5;
        note.repeatWeekdays = Array.isArray(note.repeatWeekdays) ? note.repeatWeekdays : [];
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
    function isRecurring(note) {
        return Array.isArray(note.repeatWeekdays) && note.repeatWeekdays.length > 0;
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
        if (!note.repeatWeekdays.includes((day.getDay() + 6) % 7)) return null;
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
        for (let i = 0; i < 400; i++) {
            const occ = occurrenceOn(note, new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
            if (occ && occ.getTime() > time) return occ;
        }
        return null;
    }

    const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    function repeatSummary(note) {
        if (!isRecurring(note)) return '';
        const days = note.repeatWeekdays.slice().sort().map((i) => WEEKDAY_FULL[i].slice(0, 2)).join(' ');
        return `repeats ${days}${note.repeatEndDate ? ` until ${formatDateTime(note.repeatEndDate + 'T00:00:00').slice(0, -6)}` : ''}`;
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
            : (hasImages(note) ? 'Image' : note.strokes.length ? 'Drawing'
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
        state.currentNoteId = id;
        state.currentFolderId = noteById(id)?.folderId || null;
        renderTree();
        renderEditor();
    }

    function newNote() {
        flushEditor();
        setTab('note');
        const now = new Date().toISOString();
        state.currentFolderId = null;
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
            scheduledAt: null,
            folderId: null,
            alarmEnabled: false,
            alarmRepeatCount: 0,
            alarmSnoozeMinutes: 5,
            repeatWeekdays: [],
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
        editorEl.innerHTML = sanitizeHtml(note.html);
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
                const block = /^(DIV|P|LI|H1|H2|H3|BLOCKQUOTE|UL|OL)$/.test(ch.tagName);
                if (block && out && !out.endsWith('\n')) out += '\n';
                walk(ch);
                if (block && out && !out.endsWith('\n')) out += '\n';
            });
        })(body);
        return out.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    function hasImages(note) {
        return /<img\b/i.test(note.html || '');
    }

    function markTextChanged() {
        textDirty = true;
        queueSave();
    }

    editorEl.addEventListener('input', markTextChanged);

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
        if (files.length) {
            e.preventDefault();
            insertImageFiles(files);
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
        if (!files.length) return;
        e.preventDefault();
        placeCaretAtPoint(e.clientX, e.clientY);
        insertImageFiles(files);
    });

    function selectImage(img) {
        editorEl.querySelectorAll('img.selected').forEach((i) => i.classList.remove('selected'));
        selectedImg = img || null;
        if (selectedImg) selectedImg.classList.add('selected');
        $('imageTools').hidden = !selectedImg;
    }

    editorEl.addEventListener('click', (e) => {
        const img = e.target.closest('img');
        selectImage(img && editorEl.contains(img) ? img : null);
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


    $('saveNoteBtn').addEventListener('click', () => {
        flushEditor();
        toast('Note saved');
    });

    $('deleteNoteBtn').addEventListener('click', () => deleteNote());


    $('newNoteBtn').addEventListener('click', newNote);

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
        $('repeatCount').value = note.alarmRepeatCount;
        $('snoozeMinutes').value = note.alarmSnoozeMinutes;
        $('repeatCountLabel').textContent = note.alarmRepeatCount;
        $('snoozeMinutesLabel').textContent = note.alarmSnoozeMinutes;
        applyScheduleCollapse();
    }

    function scheduleChanged() {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        const date = $('scheduleDate').value;
        const time = $('scheduleTime').value || '00:00:00';

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
        resetAlarmRuntime(note);
        touch(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') renderCalendar();
    }

    $('scheduleDate').addEventListener('change', scheduleChanged);
    $('scheduleTime').addEventListener('change', scheduleChanged);
    $('alarmEnabled').addEventListener('change', scheduleChanged);
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
        note.repeatWeekdays = [];
        note.repeatEndDate = '';
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
            const chips = scheduled.slice(0, 2).map((n) =>
                `<div class="calendar-chip${isRecurring(n) ? ' recurring' : ''}" draggable="true" data-note-id="${n.id}" title="${escapeHtml(n.title.trim() || 'Untitled')} – drag to another day">${escapeHtml(n.title.trim() || 'Untitled')}</div>`
            ).join('');
            cell.innerHTML = `<div class="calendar-day-number">${day.getDate()}</div>` +
                (scheduled.length
                    ? `<div class="calendar-chips">${chips}${scheduled.length > 2 ? `<div class="calendar-more">+${scheduled.length - 2} more</div>` : ''}</div><div class="calendar-dot"></div>`
                    : '');
            grid.appendChild(cell);
        }

        renderCalendarDay();
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
        const label = `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
        host.innerHTML = `<div class="calendar-day-title">${label}</div>` + (notes.length
            ? notes.map((n) => `<div class="calendar-note-item" draggable="true" data-note-id="${n.id}" title="Click to open – drag to another day">
                    <span class="item-actions">
                        <button class="folder-action-btn note-unschedule" data-note-id="${n.id}" title="Remove this note/alarm from this date">Remove from date</button>
                        <button class="folder-action-btn note-rename" data-note-id="${n.id}" title="Rename note">Rename</button>
                        <button class="folder-action-btn folder-delete note-delete" data-note-id="${n.id}" title="Delete note">Delete</button>
                    </span>
                    <div>${escapeHtml(n.title.trim() || 'Untitled')}</div>
                    <div class="calendar-note-time">${formatTime(n.scheduledAt)}${n.alarmEnabled ? ' · alarm' : ''}${isRecurring(n) ? ' · ' + repeatSummary(n) : ''}</div>
                </div>`).join('')
            : '<div class="calendar-hint">No notes scheduled for this day.</div>');
    }

    $('calendarGrid').addEventListener('click', (e) => {
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
            note.repeatWeekdays = [];
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
        planModal.classList.add('active');
    }

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
        note.repeatWeekdays = [...$('weekdayOptions').querySelectorAll('input:checked')].map((el) => Number(el.value));
        note.repeatEndDate = $('repeatEndDate').value;
        resetAlarmRuntime(note);
        touch(note);
        renderTree();
        if (state.prefs.activeTab === 'calendar') {
            state.calendarDay = new Date(pendingPlan.day.getFullYear(), pendingPlan.day.getMonth(), pendingPlan.day.getDate());
            renderCalendar();
        }
        closePlanFromTreeModal();
        toast('Note scheduled');
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
    const GRID_TYPES = ['triangle', 'square', 'pentagon', 'hexagon', 'octagon'];
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
            const a = Math.sqrt(4 * A / Math.sqrt(3));
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
        } else if (type === 'pentagon') {
            // "house" pentagons: rows pointing up and down whose roofs interlock
            const w = Math.sqrt(A / 0.85);
            const h = 0.6 * w;      // wall height
            const rf = 0.5 * w;     // roof height
            const P = 2 * h + rf;   // height of one down-row + up-row pair
            const pairs = Math.ceil(1 / P) + 1;
            const cols = Math.ceil(1 / w) + 1;
            for (let p = 0; p <= pairs; p++) {
                const Y = p * P + h;
                for (let i = -1; i <= cols; i++) {
                    const dx = (i + 0.5) * w;
                    add(`d${i}.${p}`, [[dx - w / 2, Y - h], [dx + w / 2, Y - h], [dx + w / 2, Y], [dx, Y + rf], [dx - w / 2, Y]]);
                    const ux = i * w;
                    add(`u${i}.${p}`, [[ux, Y], [ux + w / 2, Y + rf], [ux + w / 2, Y + rf + h], [ux - w / 2, Y + rf + h], [ux - w / 2, Y + rf]]);
                }
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
