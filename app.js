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

        state.notes.forEach(migrateNote);
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

    const saveNotes = () => {
        writeJSON(STORAGE.notes, state.notes);
        scheduleFileSave();
        scheduleGithubSave();
    };
    const saveFolders = () => {
        writeJSON(STORAGE.folders, state.folders);
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

    const noteById = (id) => state.notes.find((n) => n.id === id) || null;

    function touch(note) {
        note.modifiedAt = new Date().toISOString();
        saveNotes();
    }

    /* ---------------- sidebar / folder tree ---------------- */

    const treeEl = $('tree');
    const emptyEl = $('emptyExplorer');

    function sortedNotes(notes) {
        return notes.slice().sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    }

    function noteItemHtml(note) {
        const preview = note.content.trim()
            ? note.content.replace(/\s+/g, ' ').trim().slice(0, 60)
            : (note.strokes.length ? 'Drawing' : 'Empty note');
        const meta = note.scheduledAt ? ` Â· ${formatDateTime(note.scheduledAt)}` : '';
        return `<div class="note-item ${note.id === state.currentNoteId ? 'active' : ''}" data-note-id="${note.id}">
            <div class="note-item-title">${escapeHtml(note.title.trim() || 'Untitled')}</div>
            <div class="note-item-meta">${escapeHtml(preview)}${meta}</div>
        </div>`;
    }

    function renderTree() {
        treeEl.innerHTML = '';
        const unfiled = sortedNotes(state.notes.filter((n) => !n.folderId));

        state.folders.forEach((folder) => {
            const notes = sortedNotes(state.notes.filter((n) => n.folderId === folder.id));
            const expanded = state.prefs.expandedFolders.includes(folder.id);
            const group = document.createElement('div');
            group.className = 'folder';
            group.innerHTML = `
                <div class="folder-header" data-folder-id="${folder.id}">
                    <span class="folder-chevron">${expanded ? 'â–¾' : 'â–¸'}</span>
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
                    <span class="folder-chevron">${expanded ? 'â–¾' : 'â–¸'}</span>
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

    function onTreeNoteDragEnd() {
        draggedTreeNoteId = null;
        document.querySelectorAll('.calendar-day.drag-over').forEach((el) => el.classList.remove('drag-over'));
    }

    treeEl.addEventListener('click', (e) => {
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

    treeEl.addEventListener('dragover', (e) => {
        const header = e.target.closest('.folder-header');
        if (!header) return;
        if (!draggedTreeNoteId && !e.dataTransfer.types.includes('text/plain')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        header.classList.add('drag-over');
    });
    treeEl.addEventListener('dragleave', (e) => {
        const header = e.target.closest('.folder-header');
        if (header && !header.contains(e.relatedTarget)) header.classList.remove('drag-over');
    });
    treeEl.addEventListener('drop', (e) => {
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
            strokes: []
        };
        state.notes.push(note);
        saveNotes();
        state.currentNoteId = note.id;
        renderTree();
        setTab('note');
        renderEditor();
        $('noteTitle').focus();
        if (isMobile()) app.classList.remove('mobile-open');
    }

    function deleteNote() {
        const note = noteById(state.currentNoteId);
        if (!note) return;
        if (!confirm(`Note "${note.title.trim() || 'Untitled'}" delete?`)) return;
        state.notes = state.notes.filter((n) => n.id !== note.id);
        delete state.alarms[note.id];
        saveNotes();
        saveAlarms();
        state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
        renderTree();
        renderEditor();
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
        note.title = $('noteTitle').value;
        note.content = $('noteContent').value;
        note.folderId = $('noteFolder').value || null;
        note.strokes = state.draw.strokes.map((s) => ({
            color: s.color,
            thicknessRatio: s.thicknessRatio,
            points: s.points.map((p) => ({ x: p.x, y: p.y }))
        }));
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

    $('deleteNoteBtn').addEventListener('click', deleteNote);


    $('newNoteBtn').addEventListener('click', newNote);

    /* ---------------- folders ---------------- */

    $('newFolderBtn').addEventListener('click', () => {
        const name = prompt('New folder name:', 'New folder');
        if (!name || !name.trim()) return;
        const folder = { id: uid(), name: name.trim() };
        state.folders.push(folder);
        state.prefs.expandedFolders.push(folder.id);
        saveFolders();
        savePrefs();
        renderTree();
        if (state.currentNoteId) $('noteFolder').innerHTML = folderOptions(noteById(state.currentNoteId)?.folderId);
    });

    function renameFolder(id) {
        const folder = state.folders.find((f) => f.id === id);
        if (!folder) return;
        const name = prompt('New name:', folder.name);
        if (!name || !name.trim()) return;
        folder.name = name.trim();
        saveFolders();
        renderTree();
        if (noteById(state.currentNoteId)?.folderId === id) {
            $('noteFolder').innerHTML = folderOptions(id);
        }
    }

    function deleteFolder(id) {
        const folder = state.folders.find((f) => f.id === id);
        if (!folder) return;
        if (!confirm(`Delete folder "${folder.name}"? Notes will be moved to "No folder".`)) return;
        state.folders = state.folders.filter((f) => f.id !== id);
        state.notes.forEach((n) => { if (n.folderId === id) n.folderId = null; });
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
        $('scheduleChevron').textContent = collapsed ? 'â–¸' : 'â–¾';
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
        if (!note.alarmEnabled || !note.scheduledAt) delete state.alarms[note.id];
        saveAlarms();
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
        delete state.alarms[note.id];
        saveAlarms();
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
            const scheduled = state.notes.filter((n) => n.scheduledAt && sameDay(parseDate(n.scheduledAt), day));
            const isToday = sameDay(day, today);
            const isSelected = sameDay(day, state.calendarDay);

            const cell = document.createElement('div');
            cell.className = 'calendar-day' + (inMonth ? '' : ' other-month') +
                (isToday ? ' today' : '') + (isSelected ? ' selected' : '');
            cell.dataset.date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
            cell.innerHTML = `<div class="calendar-day-number">${day.getDate()}</div>` +
                (scheduled.length
                    ? `<div class="calendar-count">${scheduled.length} ${scheduled.length === 1 ? 'note' : 'notes'}</div><div class="calendar-dot"></div>`
                    : '');
            grid.appendChild(cell);
        }

        renderCalendarDay();
    }

    function renderCalendarDay() {
        const host = $('calendarDayNotes');
        const day = state.calendarDay;
        if (!day) {
            host.innerHTML = '<div class="calendar-hint">Click a day to view scheduled notes.</div>';
            return;
        }
        const notes = state.notes
            .filter((n) => n.scheduledAt && sameDay(parseDate(n.scheduledAt), day))
            .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
        const label = `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
        host.innerHTML = `<div class="calendar-day-title">${label}</div>` + (notes.length
            ? notes.map((n) => `<div class="calendar-note-item" data-note-id="${n.id}">
                    <div>${escapeHtml(n.title.trim() || 'Untitled')}</div>
                    <div class="calendar-note-time">${formatTime(n.scheduledAt)}${n.alarmEnabled ? ' - alarm' : ''}</div>
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
        const noteId = e.dataTransfer.getData('text/plain') || draggedTreeNoteId;
        if (!noteId) return;
        const [y, m, d] = cell.dataset.date.split('-').map(Number);
        openPlanFromTreeModal(noteId, new Date(y, m - 1, d));
        draggedTreeNoteId = null;
    });

    $('calendarDayNotes').addEventListener('click', (e) => {
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

    $('weekdayOptions').innerHTML = WEEKDAYS.map((day, index) =>
        `<label><input type="checkbox" value="${index}"> ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][index]}</label>`
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
        $('advancedSettings').hidden = true;
        $('advancedSettingsToggle').setAttribute('aria-expanded', 'false');
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
        if (!note.alarmEnabled || !note.scheduledAt) delete state.alarms[note.id];
        else delete state.alarms[note.id];
        saveAlarms();
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

    $('toolClear').addEventListener('click', () => {
        if (!state.draw.strokes.length) return;
        if (!confirm('Clear the entire drawing?')) return;
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
        document.querySelectorAll('.modal.active').forEach((m) => m.classList.remove('active'));
    }

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
        $('toggleSidebarMain').title = isMobile() ? 'Open sidebar' : 'Move sidebar left or right';
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
    $('toggleSidebarMain').addEventListener('click', () => {
        if (isMobile()) app.classList.toggle('mobile-open');
        else toggleSidebarSide();
    });

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
    const githubData = () => JSON.stringify({ folders: state.folders, notes: state.notes });

    function updateGithubStatus(message) {
        const el = $('githubStatus');
        if (!el) return;
        el.textContent = message || (githubConfigured()
            ? `GitHub: ${githubConfig.owner}/${githubConfig.repo}/${githubConfig.path}`
            : 'GitHub: not configured');
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
            baseline: githubConfig.baseline || null
        };
    }

    function githubUrl() {
        return `https://api.github.com/repos/${encodeURIComponent(githubConfig.owner)}/${encodeURIComponent(githubConfig.repo)}/contents/${githubConfig.path.split('/').map(encodeURIComponent).join('/')}`;
    }

    async function githubRequest(method, body, url = githubUrl()) {
        const response = await fetch(url, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${githubConfig.token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok && response.status !== 404) {
            const data = await response.json().catch(() => ({}));
            const error = new Error(data.message || `GitHub gaf fout ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return response.status === 404 ? null : response.json();
    }

    function decodeGithubFile(encoded) {
        const bytes = Uint8Array.from(atob(encoded.replace(/\s/g, '')), (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    function encodeGithubFile(value) {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    async function writeGithubData(sha) {
        const content = JSON.stringify(buildNotesPayload(), null, 2);
        const result = await githubRequest('PUT', {
            message: 'Remindate sync',
            content: encodeGithubFile(content),
            ...(sha ? { sha } : {})
        });
        githubConfig.sha = result.content.sha;
        githubConfig.baseline = githubData();
        writeJSON(STORAGE.github, githubConfig);
        updateGithubStatus('GitHub: synced');
    }

    function useRemoteData(data) {
        applyNotesPayload(data);
        githubConfig.baseline = githubData();
        renderTree();
        renderEditor();
    }

    async function syncGithub(options = {}) {
        if (!githubConfigured() || githubBusy) return;
        githubBusy = true;
        updateGithubStatus('GitHub: syncingâ€¦');
        try {
            if (options.flush !== false) flushEditor();
            let remote = await githubRequest('GET');
            const local = githubData();

            if (!remote) {
                await writeGithubData(null);
                toast('Notes uploaded to GitHub');
                return;
            }

            const remoteText = decodeGithubFile(remote.content);
            const remoteData = JSON.parse(remoteText);
            const remoteNotes = Array.isArray(remoteData) ? remoteData : remoteData.notes;
            if (!Array.isArray(remoteNotes)) throw new Error('notes.json does not contain a valid note list');
            const remoteComparable = JSON.stringify({ folders: Array.isArray(remoteData) ? [] : (remoteData.folders || []), notes: remoteNotes });

            if (!githubConfig.sha) {
                if (remoteComparable === local) {
                    githubConfig.sha = remote.sha;
                    githubConfig.baseline = local;
                    writeJSON(STORAGE.github, githubConfig);
                } else if (!state.notes.length && !state.folders.length) {
                    useRemoteData(remoteData);
                    githubConfig.sha = remote.sha;
                    writeJSON(STORAGE.github, githubConfig);
                } else if (confirm('GitHub already contains notes. OK uploads and replaces them with this browser version. Cancel loads the GitHub version on this device.')) {
                    await writeGithubData(remote.sha);
                    toast('Local notes uploaded to GitHub');
                    return;
                } else {
                    useRemoteData(remoteData);
                    githubConfig.sha = remote.sha;
                    writeJSON(STORAGE.github, githubConfig);
                    toast('Notes loaded from GitHub');
                    return;
                }
            } else if (remote.sha === githubConfig.sha) {
                if (local !== (githubConfig.baseline || '')) await writeGithubData(remote.sha);
            } else {
                const base = githubConfig.baseline || '';
                const localChanged = local !== base;
                const remoteChanged = remoteComparable !== base;
                if (local === remoteComparable) {
                    githubConfig.sha = remote.sha;
                    githubConfig.baseline = local;
                    writeJSON(STORAGE.github, githubConfig);
                } else if (localChanged && remoteChanged) {
                    const keepLocal = confirm('Sync conflict: both this browser and GitHub changed. OK keeps this browser version. Cancel loads the GitHub version.');
                    if (keepLocal) await writeGithubData(remote.sha);
                    else {
                        useRemoteData(remoteData);
                        githubConfig.sha = remote.sha;
                        writeJSON(STORAGE.github, githubConfig);
                    }
                    toast('Sync conflict resolved');
                    return;
                } else if (localChanged) {
                    await writeGithubData(remote.sha);
                } else {
                    useRemoteData(remoteData);
                    githubConfig.sha = remote.sha;
                    githubConfig.baseline = githubData();
                    writeJSON(STORAGE.github, githubConfig);
                }
            }
            updateGithubStatus('GitHub: synced');
            if (!options.silent) toast('GitHub sync complete');
        } catch (err) {
            console.error('GitHub sync failed', err);
            updateGithubStatus('GitHub: sync failed');
            toast(`GitHub sync failed: ${err.message}`);
        } finally {
            githubBusy = false;
        }
    }

    function scheduleGithubSave() {
        if (!githubConfig.autoSync || !githubConfigured()) return;
        clearTimeout(githubTimer);
        githubTimer = setTimeout(() => syncGithub({ silent: true }), 1200);
    }

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
                : `GitHub gaf fout ${repoResponse.status}`);
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
            folders: state.folders,
            notes: state.notes
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
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                const notes = Array.isArray(data) ? data : data.notes;
                const folders = Array.isArray(data) ? [] : (data.folders || []);
                if (!Array.isArray(notes)) throw new Error('No notes found');

                if (!confirm('This replaces your current notes and folders. Continue?')) return;

                state.notes = notes.map((n) => { migrateNote(n); return n; });
                state.folders = Array.isArray(folders) ? folders : [];
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
                alert('Could not read this file: ' + err.message);
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

    function checkAlarms() {
        const now = Date.now();
        let changed = false;

        state.notes.forEach((note) => {
            if (!note.alarmEnabled || !note.scheduledAt) return;
            const due = parseDate(note.scheduledAt);
            if (!due) return;
            const dueTime = due.getTime();

            let runtime = state.alarms[note.id];
            if (!runtime || runtime.dueTime !== dueTime) {
                if (dueTime > now) return;
                runtime = {
                    dueTime,
                    repeatsLeft: note.alarmRepeatCount,
                    snoozeMinutes: note.alarmSnoozeMinutes,
                    nextAt: dueTime
                };
                state.alarms[note.id] = runtime;
                changed = true;
            }

            if (runtime.nextAt === null) return;
            if (runtime.nextAt > now) return;

            showAlarm(note, runtime);

            if (runtime.repeatsLeft > 0) {
                runtime.repeatsLeft -= 1;
                runtime.nextAt = now + runtime.snoozeMinutes * 60000;
            } else {
                runtime.nextAt = null;
            }
            changed = true;
        });

        if (changed) saveAlarms();
    }

    function showAlarm(note, runtime) {
        const title = note.title.trim() || 'Untitled';
        const body = note.content.trim().slice(0, 120) || 'Scheduled note';
        notify(title, body);
        playAlarmSound();
        toast(`Alarm: ${title} - ${formatTime(note.scheduledAt)}`, {
            label: 'Stop alarm',
            persistent: true,
            onClick: () => {
                stopAlarmSound();
                runtime.nextAt = null;
                runtime.repeatsLeft = 0;
                saveAlarms();
                if (note.repeatWeekdays && note.repeatWeekdays.length) {
                    const next = nextWeekdayOccurrence(note, Date.now());
                    if (next) { note.scheduledAt = toLocalIso(next); delete state.alarms[note.id]; touch(note); saveAlarms(); }
                }
            }
        });
    }

    let alarmAudio = null, alarmContext = null, alarmOscillator = null;
    function stopAlarmSound() {
        if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; alarmAudio = null; }
        if (alarmOscillator) { try { alarmOscillator.stop(); } catch (_) {} alarmOscillator = null; }
    }
    function playAlarmSound() {
        stopAlarmSound();
        const saved = localStorage.getItem('remindate.alarmSound.v1');
        if (saved) { alarmAudio = new Audio(saved); alarmAudio.loop = true; alarmAudio.play().catch(() => {}); return; }
        try {
            alarmContext = alarmContext || new (window.AudioContext || window.webkitAudioContext)();
            if (alarmContext.state === 'suspended') alarmContext.resume();
            const osc = alarmContext.createOscillator(), gain = alarmContext.createGain();
            osc.type = 'sine'; osc.frequency.value = 880; gain.gain.value = 0.12;
            osc.connect(gain); gain.connect(alarmContext.destination); osc.start(); alarmOscillator = osc;
        } catch (_) {}
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
    $('openAlarmSoundSettings').addEventListener('click', () => {
        const customSound = localStorage.getItem('remindate.alarmSound.v1');
        $('alarmSoundStatus').textContent = customSound ? 'Using a custom sound' : 'Using standard sound';
        $('alarmSoundModal').classList.add('active');
    });
    $('alarmSoundClose').addEventListener('click', closeModals);
    $('alarmSoundBackdrop').addEventListener('click', closeModals);
    function nextWeekdayOccurrence(note, afterTime) {
        const base = parseDate(note.scheduledAt); if (!base) return null;
        const weekdays = new Set(note.repeatWeekdays || []);
        for (let offset = 1; offset <= 3660; offset++) {
            const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, base.getHours(), base.getMinutes(), base.getSeconds());
            const dayIndex = (d.getDay() + 6) % 7;
            const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
            if (note.repeatEndDate && key > note.repeatEndDate) return null;
            if (weekdays.has(dayIndex) && d.getTime() > afterTime) return d;
        }
        return null;
    }

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
        host.innerHTML = '';

        const el = document.createElement('div');
        el.className = 'toast';
        if (action?.persistent) el.dataset.persistent = 'true';
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
        clearTimeout(toastTimer);
        if (!action?.persistent) toastTimer = setTimeout(() => el.remove(), action ? 20000 : 3500);
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

    checkAlarms();
    setInterval(checkAlarms, 20000);

    function updateSyncStatus() {
        const el = $('syncStatus');
        if (!el) return;
        if (fileSync.enabled && fileSync.handle) {
            el.textContent = `Linked to notes.json â€¢ Auto-save â€¢ ${fileSync.handle.name || ''}`;
        } else {
            el.textContent = 'No file linked â€¢ Local storage only â€¢ Use "Choose notes.json" or export/import';
        }
    }

    function buildNotesPayload() {
        return {
            app: 'Remindate',
            version: 1,
            updatedAt: new Date().toISOString(),
            folders: state.folders,
            notes: state.notes
        };
    }

    function applyNotesPayload(data) {
        const notes = Array.isArray(data) ? data : data.notes;
        const folders = Array.isArray(data) ? [] : (data.folders || []);
        if (!Array.isArray(notes)) throw new Error('No notes found in notes.json');
        state.notes = notes.map((n) => { migrateNote(n); return n; });
        state.folders = Array.isArray(folders) ? folders : [];
        state.currentNoteId = sortedNotes(state.notes)[0]?.id || null;
        state.currentFolderId = noteById(state.currentNoteId)?.folderId || null;
        if (!state.prefs.expandedFolders.length) {
            state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];
        } else {
            state.prefs.expandedFolders = ['__none', ...state.folders.map((f) => f.id)];
        }
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
