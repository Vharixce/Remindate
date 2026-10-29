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
        updatedAt: 'remindate.updatedAt.v1',
        github: 'remindate.github.v1'
    };

    const fileSync = {
        handle: null,
        enabled: false
    };

    const PALETTE = [
        '#000000', '#ffffff', '#f87171', '#fb923c', '#fbbf24', '#a3e635',
        '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6',
        '#7f1d1d', '#9a3412', '#854d0e', '#3f6212', '#14532d', '#134e4a',
        '#0c4a6e', '#1e1b4b', '#4c1d95', '#831843', '#a8a29e', '#57534e'
    ];

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
        currentNoteId: null,
        currentFolderId: null,
        calendarCursor: new Date(),
        calendarDay: null,
        draw: {
            tool: 'pen',
            color: '#222222',
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
        note.canvasBackground = note.canvasBackground || '#ffffff';
        note.strokes = Array.isArray(note.strokes) ? note.strokes : [];
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
            : (note.strokes.length ? 'Drawing' : 'Empty note');
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

    function renderTree() {
        ensureNoteOrder();
        treeEl.innerHTML = '';
        const unfiled = sortedNotes(state.notes.filter((n) => !n.folderId));

        state.folders.forEach((folder) => {
            const notes = sortedNotes(state.notes.filter((n) => n.folderId === folder.id));
            const expanded = state.prefs.expandedFolders.includes(folder.id);
            const group = document.createElement('div');
            group.className = 'folder';
            group.innerHTML = `
                <div class="folder-header" data-folder-id="${folder.id}">
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
            canvasBackground: '#ffffff',
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
        toast('Note deleted');
    }

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
        $('noteContent').disabled = empty;
        $('saveNoteBtn').disabled = empty;
        $('deleteNoteBtn').disabled = empty;
        $('noteFolder').disabled = empty;
        $('noteTitle').placeholder = empty ? 'No note selected' : 'Title';
        $('noteContent').placeholder = empty
            ? 'Create a note to get started.'
            : 'Write your note here...';

        if (empty) {
            $('noteTitle').value = '';
            $('noteContent').value = '';
            $('noteFolder').innerHTML = folderOptions('');
            state.draw.strokes = [];
            updateScheduleUi(null);
            setMode('text');
            return;
        }

        $('noteTitle').value = note.title;
        $('noteContent').value = note.content;
        $('noteFolder').innerHTML = folderOptions(note.folderId);
        updateScheduleUi(note);

        state.draw.strokes = note.strokes.map((s) => ({
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: (s.points || []).map((p) => ({ x: p.x, y: p.y }))
        }));

        setMode(state.prefs.mode === 'draw' ? 'draw' : 'text');
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
        const content = $('noteContent').value;
        const folderId = $('noteFolder').value || null;
        const strokes = state.draw.strokes.map((s) => ({
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: s.points.map((p) => ({ x: p.x, y: p.y }))
        }));
        const changed = note.title !== title || note.content !== content || note.folderId !== folderId ||
            JSON.stringify(note.strokes) !== JSON.stringify(strokes);
        if (!changed) return;
        note.title = title;
        note.content = content;
        note.folderId = folderId;
        note.strokes = strokes;
        note.modifiedAt = new Date().toISOString();
        saveNotes();
        renderTree();
    }

    $('noteTitle').addEventListener('input', queueSave);
    $('noteContent').addEventListener('input', queueSave);

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
        const folder = { id: uid(), name: name.trim(), modifiedAt: new Date().toISOString() };
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

    $('calendarDayNotes').addEventListener('click', (e) => {
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

    /* ---------------- tekenen ---------------- */

    const canvas = $('drawCanvas');
    const ctx = canvas.getContext('2d');
    const drawContainer = $('drawContainer');

    function fitCanvas() {
        if (!drawContainer || drawContainer.style.display === 'none') return;
        const width = Math.max(320, drawContainer.clientWidth);
        const height = Math.round(width * 0.75);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            renderStrokes();
        }
    }

    function renderStrokes() {
        const note = noteById(state.currentNoteId);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = note ? (note.canvasBackground || '#ffffff') : '#ffffff';
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
        if (state.prefs.mode !== 'draw') return;
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
            thicknessRatio: state.draw.size / canvas.width,
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
        renderStrokes();
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
        const radius = Math.max(0.006, (state.draw.size / 2) / canvas.width);
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
        state.prefs.mode = mode;
        savePrefs();
        $('modeText').classList.toggle('active', mode === 'text');
        $('modeDraw').classList.toggle('active', mode === 'draw');
        $('noteContent').style.display = mode === 'text' ? 'block' : 'none';
        drawContainer.style.display = mode === 'draw' ? 'block' : 'none';
        $('drawToolbar').style.display = mode === 'draw' ? 'block' : 'none';
        if (mode === 'draw') {
            requestAnimationFrame(() => {
                fitCanvas();
                renderStrokes();
            });
        }
    }

    $('modeText').addEventListener('click', () => setMode('text'));
    $('modeDraw').addEventListener('click', () => setMode('draw'));

    /* ---------------- kleuren ---------------- */

    function buildPalette(host, onPick) {
        const persistentToast = host.querySelector('.toast[data-persistent="true"]');
        if (!persistentToast) host.innerHTML = '';
        PALETTE.forEach((color) => {
            const b = document.createElement('button');
            b.className = 'palette-color';
            b.style.background = color;
            b.title = color;
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

    function askDialog({ title, message = '', input = null, okLabel = 'OK', danger = false }) {
        return new Promise((resolve) => {
            if (dialogResolve) finishDialog(false);
            dialogResolve = resolve;
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
        if ($('dialogInput').hidden) resolve(!!ok);
        else resolve(ok ? $('dialogInput').value : null);
    }

    const askText = (title, value, okLabel = 'OK') => askDialog({ title, input: value || '', okLabel });
    const askConfirm = (title, message, okLabel = 'OK') =>
        askDialog({ title, message, okLabel, danger: /delete|clear|replace/i.test(okLabel) });

    $('dialogOk').addEventListener('click', () => finishDialog(true));
    $('dialogCancel').addEventListener('click', () => finishDialog(false));
    $('dialogClose').addEventListener('click', () => finishDialog(false));
    $('dialogBackdrop').addEventListener('click', () => finishDialog(false));
    $('dialogInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finishDialog(true); }
    });

    buildPalette($('palette'), (color) => {
        state.draw.color = color;
        $('colorSwatch').style.background = color;
        $('colorCustom').value = color;
        setTool('pen');
    });

    buildPalette($('canvasPalette'), (color) => {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        note.canvasBackground = color;
        $('canvasBgCustom').value = color;
        touch(note);
        renderStrokes();
    });

    $('colorSwatch').addEventListener('click', () => openModal('colorModal'));
    $('colorClose').addEventListener('click', closeModals);
    $('colorBackdrop').addEventListener('click', closeModals);

    $('colorCustom').addEventListener('input', (e) => {
        state.draw.color = e.target.value;
        $('colorSwatch').style.background = e.target.value;
        setTool('pen');
    });

    $('toolCanvasBg').addEventListener('click', () => {
        const note = noteById(state.currentNoteId);
        if (note) $('canvasBgCustom').value = note.canvasBackground || '#ffffff';
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

        const folders = mergeList('folders', local.folders, remote.folders);
        const folderIds = new Set(folders.map((f) => f.id));
        const notes = mergeList('notes', local.notes, remote.notes)
            .map((n) => (n.folderId && !folderIds.has(n.folderId) ? { ...n, folderId: null } : n));

        return { notes, folders, deleted, updatedAt: laterIso(local.updatedAt, remote.updatedAt) };
    }

    // Put a merged snapshot into the app without counting it as a new local change
    function applySnapshot(snap) {
        const before = stableStringify(noteById(state.currentNoteId) || null);
        const knownFolders = new Set(state.folders.map((f) => f.id));
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
