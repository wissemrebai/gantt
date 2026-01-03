/* eslint-disable @lwc/lwc/no-async-operation */
/* eslint-disable no-case-declarations */
import { LightningElement, api, track } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';

import { getTimezoneDiff } from 'c/dateUtils';
import { DateTime } from 'c/dateTimeUtils';
import TIMEZONE from '@salesforce/i18n/timeZone';

// At the top of the file
import {
    getWorkWeekDays,
    formatDateMonth,
    formatDateHourMinutes,
    daySlots,
    weekSlots,
    monthSlots,
    yearSlots,
    quarterSlots,
    DateTimeFormatWithExtras
} from 'c/dateUtils';

const PADDING_FIX_SCROLL = 20;
export default class GanttTimeline extends LightningElement {
    // api properties
    @api
    get scrollPosition() {
        return this.tScrollPosition;
    }
    set scrollPosition(value) {
        if (Math.abs(this.tScrollPosition - value) > 1) {
            this.tScrollPosition = value;
            this.scrollToPosition(value);
        }
    }

    @api
    get options() {
        return this.tOptions;
    }
    set options(value) {
        this.tOptions = value;

        if (this.tOptions.zoomLevel !== this.tZoomLevelValue) {
            this.tZoomLevelValue = this.tOptions.zoomLevel;
            if (this.isRendered) {
                this.generateLayout();
            }
        }
    }

    @api
    get taskManager() {
        return this.tTaskManager;
    }
    set taskManager(value) {
        this.tTaskManager = value;
        this.updateTaskTree();
    }

    @api
    get selectedRows() {
        return this.tSelectedRows;
    }
    set selectedRows(value) {
        for (let id of this.selectedRows) {
            this.callbackTask[id]?.setSelected(false);
        }
        this.tSelectedRows = value || [];
        for (let id of this.selectedRows) {
            this.callbackTask[id]?.setSelected(true);
        }
        this.renderDependencies();
    }

    @api
    get expandedRows() {
        return this.tExpandedRows;
    }

    set expandedRows(value) {
        if (!this.isRendered) return;

        const newRows = value || [];
        const oldRows = this.tExpandedRows || [];

        // Use Sets for O(1) lookup instead of O(n) array includes
        const oldSet = new Set(oldRows);
        const newSet = new Set(newRows);

        const toExpand = newRows.filter((id) => !oldSet.has(id));
        const toCollapse = oldRows.filter((id) => !newSet.has(id));

        this.tExpandedRows = [...newRows];

        if (toExpand.length === 0 && toCollapse.length === 0) return;

        if (this.timeSlots?.length > 0) {
            this.toggleRow(toCollapse, false);
            this.toggleRow(toExpand, true);
            return;
        }

        let attempts = 0;
        const maxAttempts = 60;

        const toggleIntervalId = setInterval(() => {
            if (++attempts > maxAttempts || this.timeSlots?.length > 0) {
                clearInterval(toggleIntervalId);

                if (this.timeSlots?.length > 0) {
                    this.toggleRow(toCollapse, false);
                    this.toggleRow(toExpand, true);
                }
            }
        }, 100);
    }

    @api highlightedRows = [];

    @api get fullscreen() {
        return this.tFullScreen;
    }
    set fullscreen(value) {
        this.tFullScreen = value;
        this.adjustHeight();
    }

    @api get selectedView() {
        return this.tSelectedView;
    }
    set selectedView(value) {
        this.tSelectedView = value;

        if (this.isRendered && this.tSelectedView) {
            const currentTime = this.offsetToDate(
                this.refs.timeline.scrollLeft + PADDING_FIX_SCROLL
            );

            this.generateLayout().then((generetad) => {
                if (generetad) {
                    this.scrollToTime(currentTime, true);
                }
            });
        }
    }

    // internal properties
    @track tTaskManager = null;
    @track tOptions = {};
    @track tDateFormatHeader = {};
    @track renderedDependencyMap = new Map();

    @track header1Labels = [];
    @track header2Labels = [];

    @track nextHeader1Labels = [];
    @track nextHeader2Labels = [];

    @track timeSlots = [];
    @track tZoomLevelValue = 1;

    @track isRendered = false;
    @track tFullScreen;
    @track tSelectedView;
    @track fullSelectedView;

    @track tDependencies = [];
    @track tSelectedRows = [];
    @track tExpandedRows = [];

    // task/dragging states
    @track dragState = null;
    @track isDragging;

    @track callbackTask = {};

    // range/timeline states
    @track range = {};
    @track rangeChanged = false;
    @track colgroup = [];
    @track workDays = [];
    @track tableWidth = 0;
    @track refDate = null;

    // timeline
    @track columnsTable = {};

    // dependency draw
    @track startPoint = { x: 0, y: 0 };
    @track endPoint = { x: 0, y: 0 };

    @track taskTree = [];
    @track visibleTasks = [];

    _positionCache = new Map();
    _lastRangeStart = null;
    _lastRangeEnd = null;
    _lastSlotSize = null;

    @track viewportStartIndex = 0;
    @track viewportEndIndex = 50;
    bufferSize = 50;

    @track viewportStartColumn = 0;
    @track viewportEndColumn = 0;
    columnBufferSize = 50;

    horizontalScrollLeft = 0;
    horizontalClientWidth = 0;

    _columnOffsets = [];
    _header1Offsets = [];
    _header2Offsets = [];
    _timeSlotsOffsets = [];

    _depByPredecessor = new Map();
    _depBySuccessor = new Map();

    _scrollYTimeout;
    debouncedRenderDependencies;

    // getters
    tslotSize;
    tScrollPosition = 0;

    updateTaskTree() {
        if (this.taskManager) {
            
            this.taskManager.refreshVisibleTasks();
            this.taskTree = this.taskManager.getTasksTree();
            this.visibleTasks = this.taskManager.getVisibleTasks();

            this.buildDependencyIndex();
        } else {
            this.taskTree = [];
            this.visibleTasks = [];
        }
    }

    buildDependencyIndex() {
        this._depByPredecessor.clear();
        this._depBySuccessor.clear();

        if (!this.taskManager?.dependencies) return;

        for (const dep of this.taskManager.dependencies) {
            const pId = dep.gm__predecessorUID;
            const sId = dep.gm__successorUID;

            if (!this._depByPredecessor.has(pId)) {
                this._depByPredecessor.set(pId, []);
            }
            this._depByPredecessor.get(pId).push(dep);

            if (!this._depBySuccessor.has(sId)) {
                this._depBySuccessor.set(sId, []);
            }
            this._depBySuccessor.get(sId).push(dep);
        }
    }

    get slotSize() {
        return this.tslotSize || 200;
    }

    get currentView() {
        return this.fullSelectedView || this.tSelectedView;
    }

    get renderedRows() {
        const start = Math.max(0, this.viewportStartIndex - this.bufferSize);
        const end = Math.min(
            this.visibleTasks.length,
            this.viewportEndIndex + this.bufferSize
        );

        return this.visibleTasks.slice(start, end).map((taskId, i) => {
            const actualIndex = start + i;
            let classList = ['table-row', 'row-height'];

            if (this.highlightedRows.includes(taskId)) {
                classList.push('highlighted-row');
            }

            if (this.selectedRows.includes(taskId)) {
                classList.push('selected-row');
            }

            if (actualIndex % 2 === 0) {
                classList.push('row-even');
            } else {
                classList.push('row-odd');
            }

            return {
                className: classList.join(' '),
                key: taskId,
                style: `transform: translateY(${actualIndex * this.options.rowHeight}px); position: absolute; width: 100%;`
            };
        });
    }

    // OPTIMIZATION: Getter for rendered columns (horizontal virtual scrolling)
    get renderedColumns() {
        if (!this.columnsTable?.elements || this._columnOffsets.length === 0) {
            return this.columnsTable?.elements || [];
        }

        const elements = this.columnsTable.elements;
        const offsets = this._columnOffsets;

        const start = Math.max(
            0,
            this.viewportStartColumn - this.columnBufferSize
        );
        const end = Math.min(
            elements.length,
            this.viewportEndColumn + this.columnBufferSize
        );

        return elements.slice(start, end).map((col, index) => {
            const actualIndex = start + index;
            const offset = offsets[actualIndex];

            return {
                ...col,
                style: `width: ${offset.width}px; position: absolute; transform: translateX(${offset.left}px); height: 100%;`
            };
        });
    }

    // OPTIMIZATION: Getter for rendered header1 labels (horizontal virtual scrolling)
    get renderedHeader1Labels() {
        if (
            !this.header1Labels ||
            this.header1Labels.length === 0 ||
            this._header1Offsets.length === 0
        ) {
            return this.header1Labels || [];
        }

        const { start, end } = this._getHeaderViewportRange(
            this._header1Offsets
        );

        return this.header1Labels.slice(start, end).map((header, index) => {
            const actualIndex = start + index;
            const offset = this._header1Offsets[actualIndex];

            return {
                ...header,
                style: `width: ${offset.width}px; position: absolute; transform: translateX(${offset.left}px);`
            };
        });
    }

    // OPTIMIZATION: Getter for rendered header2 labels (horizontal virtual scrolling)
    get renderedHeader2Labels() {
        if (
            !this.header2Labels ||
            this.header2Labels.length === 0 ||
            this._header2Offsets.length === 0
        ) {
            return this.header2Labels || [];
        }

        const { start, end } = this._getHeaderViewportRange(
            this._header2Offsets
        );

        return this.header2Labels.slice(start, end).map((header, index) => {
            const actualIndex = start + index;
            const offset = this._header2Offsets[actualIndex];

            return {
                ...header,
                style: `width: ${offset.width}px; position: absolute; transform: translateX(${offset.left}px);`
            };
        });
    }

    // OPTIMIZATION: Getter for rendered time slots (horizontal virtual scrolling)
    get renderedTimeSlots() {
        if (
            !this.timeSlots ||
            this.timeSlots.length === 0 ||
            this._timeSlotsOffsets.length === 0
        ) {
            return this.timeSlots || [];
        }

        const { start, end } = this._getHeaderViewportRange(
            this._timeSlotsOffsets
        );

        return this.timeSlots.slice(start, end).map((slot, index) => {
            const actualIndex = start + index;
            const offset = this._timeSlotsOffsets[actualIndex];

            return {
                ...slot,
                style: `width: ${offset.width}px; position: absolute; transform: translateX(${offset.left}px);`
            };
        });
    }

    // Helper to get viewport range for header elements using binary search
    _getHeaderViewportRange(offsets) {
        if (offsets.length === 0) {
            return { start: 0, end: 0 };
        }

        const scrollLeft = this.horizontalScrollLeft;
        const clientWidth = this.horizontalClientWidth;

        // If no scroll info yet, return all
        if (clientWidth === 0) {
            return { start: 0, end: offsets.length };
        }

        const scrollRight = scrollLeft + clientWidth;

        // Binary search for start
        let low = 0;
        let high = offsets.length - 1;
        let startIndex = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const colRight = offsets[mid].left + offsets[mid].width;

            if (colRight < scrollLeft) {
                low = mid + 1;
            } else if (offsets[mid].left > scrollLeft) {
                high = mid - 1;
            } else {
                startIndex = mid;
                break;
            }
        }
        startIndex = Math.max(0, low - this.columnBufferSize);

        // Binary search for end
        low = startIndex;
        high = offsets.length - 1;
        let endIndex = offsets.length;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);

            if (offsets[mid].left > scrollRight) {
                high = mid - 1;
                endIndex = mid;
            } else {
                low = mid + 1;
            }
        }
        endIndex = Math.min(offsets.length, low + this.columnBufferSize);

        return { start: startIndex, end: endIndex };
    }

    // OPTIMIZATION: Pre-compute column offsets for O(1) lookup during scroll
    buildColumnOffsets() {
        // Build column offsets from columnsTable elements
        if (!this.columnsTable?.elements) {
            this._columnOffsets = [];
        } else {
            const elements = this.columnsTable.elements;
            this._columnOffsets = new Array(elements.length);

            let currentLeft = 0;
            for (let i = 0; i < elements.length; i++) {
                const width = this.parseColumnWidth(elements[i].style);
                this._columnOffsets[i] = {
                    left: currentLeft,
                    width: width
                };
                currentLeft += width;
            }
        }

        // Build header1 offsets - uses offsetWidth from slot data
        this._header1Offsets = this._buildSlotOffsets(this.header1Labels);

        // Build header2 offsets - uses offsetWidth from slot data
        this._header2Offsets = this._buildSlotOffsets(this.header2Labels);

        // Build timeSlots offsets - uses offsetWidth from slot data
        this._timeSlotsOffsets = this._buildSlotOffsets(this.timeSlots);
    }

    // Helper to build offset arrays from slot data (uses offsetWidth and offsetLeft)
    _buildSlotOffsets(items) {
        if (!items || items.length === 0) {
            return [];
        }

        const offsets = new Array(items.length);

        for (let i = 0; i < items.length; i++) {
            offsets[i] = {
                left: items[i].offsetLeft || 0,
                width: items[i].offsetWidth || 0
            };
        }

        return offsets;
    }

    // Helper to parse width from style string
    parseColumnWidth(styleString) {
        const match = styleString?.match(/width:\s*(\d+)px/);
        return match ? parseInt(match[1], 10) : 0;
    }

    // Update viewport columns on horizontal scroll using binary search
    updateViewportColumns(scrollLeft, clientWidth) {
        if (this._columnOffsets.length === 0) return;

        const offsets = this._columnOffsets;
        const scrollRight = scrollLeft + clientWidth;

        // Binary search for start column
        let low = 0;
        let high = offsets.length - 1;
        let startIndex = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const colRight = offsets[mid].left + offsets[mid].width;

            if (colRight < scrollLeft) {
                low = mid + 1;
            } else if (offsets[mid].left > scrollLeft) {
                high = mid - 1;
            } else {
                startIndex = mid;
                break;
            }
        }
        startIndex = Math.max(0, low);

        // Binary search for end column
        low = startIndex;
        high = offsets.length - 1;
        let endIndex = offsets.length;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);

            if (offsets[mid].left > scrollRight) {
                high = mid - 1;
                endIndex = mid;
            } else {
                low = mid + 1;
            }
        }
        endIndex = Math.min(offsets.length, low);

        this.viewportStartColumn = startIndex;
        this.viewportEndColumn = endIndex;
    }

    // Initialize column viewport
    initializeColumnViewport() {
        const timeline = this.refs.timeline;
        if (timeline && this._columnOffsets.length > 0) {
            const scrollLeft = timeline.scrollLeft;
            const clientWidth = timeline.clientWidth;

            // Set tracked values for reactivity
            this.horizontalScrollLeft = scrollLeft;
            this.horizontalClientWidth = clientWidth;

            this.updateViewportColumns(scrollLeft, clientWidth);
        }
    }

    @api
    goToDate(date) {
        this.scrollToTime(date);
    }

    @api
    goToTask(elementId) {
        this.scrollToTask(elementId);
    }

    scrollToPosition(scrollTop) {
        this.refs.gridContent.scrollTop = scrollTop;
    }

    @api
    refreshTasks(action = 'FULL_REFRESH', payload = {}) {
        this.updateTaskTree();

        if (this.requiresFullLayout(action)) {
            this.generateLayout();
            return;
        }

        const affectedTaskIds = this.collectAffectedTasks(action, payload);

        this.updateAffectedTasks(affectedTaskIds);
        this.renderDependencies(affectedTaskIds);

        if (action === 'LOAD_BASELINE' || action === 'DELETE_BASELINE') {
            this.adjustHeight();
            for (const taskUID of this.visibleTasks) {
                if (this.callbackTask[taskUID]) {
                    this.callbackTask[taskUID].updateTask({
                        rowHeight: this.options.rowHeight
                    });
                    this.callbackTask[taskUID].recalculateDerivedData();
                }
            }
        }
    }

    requiresFullLayout(action) {
        const fullLayoutActions = new Set([
            'FULL_REFRESH',
            'TASK_DELETED',
            'TASK_ADDED',
            'SYNC_MISSING'
        ]);

        return fullLayoutActions.has(action) || this.hasRawRangeChanged();
    }

    // Get tasks currently in viewport (with buffer)
    getViewportTaskIds() {
        const start = Math.max(0, this.viewportStartIndex - this.bufferSize);
        const end = Math.min(
            this.visibleTasks.length,
            this.viewportEndIndex + this.bufferSize
        );

        return new Set(this.visibleTasks.slice(start, end));
    }

    collectAffectedTasks(action, payload) {
        const viewportTasks = this.getViewportTaskIds();
        const affected = new Set();
        const tasks = payload?.tasks || {};
        const deps = payload?.dependencies || {};

        // Direct task changes - only if in viewport
        for (const task of [
            ...(tasks.modified || []),
            ...(tasks.added || [])
        ]) {
            const uid = typeof task === 'string' ? task : task.gm__elementUID;
            if (uid && viewportTasks.has(uid)) {
                affected.add(uid);
            }
        }

        // Dependency changes - get all tasks in chain, filtered to viewport
        const changedDepIds = [
            ...(deps.modified || []),
            ...(deps.added || []),
            ...(deps.deleted || [])
        ];

        if (changedDepIds.length > 0) {
            const depAffectedTasks =
                this.getTasksAffectedByDependencies(changedDepIds);
            for (const taskId of depAffectedTasks) {
                if (viewportTasks.has(taskId)) {
                    affected.add(taskId);
                }
            }
        }

        // Rules and reorder - only viewport tasks
        const allTasksActions = new Set([
            'RULE_DELETED',
            'RULE_ADDED',
            'RULE_UPDATED',
            'TASKS_REORDERED'
        ]);

        if (allTasksActions.has(action)) {
            viewportTasks.forEach((id) => affected.add(id));
        }

        return affected;
    }

    /**
     * Get all tasks affected by dependency changes.
     * Traverses dependency graph to find downstream tasks.
     */
    getTasksAffectedByDependencies(changedDepIds) {
        const affected = new Set();
        const visited = new Set();
        const queue = [];

        // Start with direct predecessor/successor of changed dependencies
        for (const depId of changedDepIds) {
            const dep = this.taskManager.dependencies.find(
                (d) => d.gm__dependencyUID === depId
            );

            if (dep) {
                queue.push(dep.gm__predecessorUID);
                queue.push(dep.gm__successorUID);
            }
        }

        // BFS to find all downstream affected tasks
        while (queue.length > 0) {
            const taskId = queue.shift();

            if (visited.has(taskId)) continue;
            visited.add(taskId);
            affected.add(taskId);

            // Find successors (tasks that depend on this task)
            const successorDeps = this._depByPredecessor.get(taskId) || [];
            for (const dep of successorDeps) {
                if (!visited.has(dep.gm__successorUID)) {
                    queue.push(dep.gm__successorUID);
                }
            }

            // Check summary children
            const task = this.taskManager.getTaskById(taskId);
            if (task?.gm__type === 'summary' && task.gm__children) {
                for (const childId of task.gm__children) {
                    if (!visited.has(childId)) {
                        queue.push(childId);
                    }
                }
            }
        }

        return affected;
    }

    updateAffectedTasks(affectedTaskIds) {
        if (affectedTaskIds.size === 0) return;

        this.invalidatePositionCacheIfNeeded();

        for (const taskId of affectedTaskIds) {
            const index = this.visibleTasks.indexOf(taskId);
            if (index !== -1) {
                this.updateSingleTask(taskId, index);
            }
        }
    }

    // Helper to calculate coordinates for a single task
    calculateCoordsForTask(taskId) {
        const index = this.visibleTasks.indexOf(taskId);
        if (index === -1) return null;

        const task = this.taskManager.getTaskById(taskId);
        const positionData = this.calculatePositionAndCoordinates(task, index);

        return positionData?.coordinates || null;
    }

    hasRawRangeChanged() {
        const prevRaw = this.range;
        const nextRaw = this.taskManager.getRange();

        if (!prevRaw || !prevRaw.minDate || !prevRaw.maxDate) {
            return true;
        }

        return (
            prevRaw.minDate.getTime() !== nextRaw.minDate.getTime() ||
            prevRaw.maxDate.getTime() !== nextRaw.maxDate.getTime()
        );
    }

    calculateGrouperHeight(task) {
        if (task.gm__type === 'summary' && task.gm__children?.length > 0) {
            const visibleTasks = task.gm__visibleTasksLength ?? 0;
            return (
                visibleTasks * this.options.rowHeight +
                this.options.rowHeight / 2
            );
        }
        return 0;
    }

    async renderedCallback() {
        if (!this.isRendered) {
            const timeline = this.refs.timeline;
            const gridContent = this.refs.gridContent;

            // Check if we're on desktop (not mobile)
            let isMobile =
                /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                    navigator.userAgent
                );

            if (!isMobile) {
                timeline.addEventListener('mousedown', (e) => {
                    this.handleDragStart(e);

                    const onMouseMove = this.throttle((ev) => {
                        this.handleDrag(ev);
                    }, 25);

                    const onMouseUp = (ev) => {
                        this.handleDragEnd(ev);
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            }

            timeline.addEventListener(
                'scroll',
                this.throttle((e) => {
                    this.handleScrollX(e);
                }, 16)
            );

            gridContent.addEventListener('scroll', (e) => {
                this.handleScrollY(e);
            });

            this.debouncedRenderDependencies = this.debounce(() => {
                this.renderDependencies();
            }, 50);

            this.isRendered = true;
        }
    }

    handleScrollX(event) {
        const { scrollLeft, clientWidth } = event.target;

        this.updateHorizontalViewport(scrollLeft, clientWidth);
    }

    updateHorizontalViewport(scrollLeft, clientWidth) {
        this.horizontalScrollLeft = scrollLeft;
        this.horizontalClientWidth = clientWidth;

        this.updateViewportColumns(scrollLeft, clientWidth);
    }

    async generateLayout() {
        if (!this.isRendered) return false;

        this.setLoading(true);
        try {
            this.initRange();

            if (this.rangeChanged || this.viewChanged) {
                this.timeSlots = [];
                this.header1Labels = [];
                this.header2Labels = [];
                this.prepareSlots();
                this.updateSlotGeometry();
            } else {
                this.nextHeader1Labels = this.header1Labels;
                this.nextHeader2Labels = this.header2Labels;
                this.nextTimeSlots = this.timeSlots;
                this.updateSlotGeometry();
            }

            this.updateSlotDimensions();
            this.buildColumnOffsets();
            this.initializeColumnViewport();

            if (!this.refDate) {
                this.refDate = this.options.referenceDate;
                Promise.resolve().then(() => this.scrollToTime(this.refDate));
            }

            this.renderedDependencyMap.clear();
            this.renderTasksAndDependencies();
            return true;
        } catch (err) {
            console.error(err);
            return false;
        } finally {
            this.setLoading(false);
        }
    }

    async initRange() {
        this.rangeChanged = false;
        const { rangeStart, rangeEnd } = this.range;

        const prevStart = rangeStart?.getTime();
        const prevEnd = rangeEnd?.getTime();

        const newRange = this.taskManager.computeRange();
        this.range = newRange;

        this.calculateSlotSize(this.selectedView);
        this.workDays = getWorkWeekDays(this.options);

        if (prevStart != null && prevEnd != null) {
            if (
                prevStart === newRange.rangeStart.getTime() &&
                prevEnd === newRange.rangeEnd.getTime()
            ) {
                return;
            }
        }
        this.rangeChanged = true;
    }

    async prepareSlots() {
        let header1Labels = [];
        let header2Labels = [];
        let timeSlots = [];

        const { rangeStart, rangeEnd } = this.range;

        let options = {
            ...this.tOptions,
            dateFormat: this.tDateFormatHeader,
            workDays: this.workDays,
            slotSize: this.slotSize
        };

        switch (this.currentView) {
            case 'day':
            case 'week':
                header1Labels = monthSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                header2Labels = weekSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                timeSlots = daySlots(rangeStart, rangeEnd, options, TIMEZONE);
                break;

            case 'month':
                header1Labels = yearSlots(
                    rangeStart,
                    rangeEnd,
                    {
                        ...options,
                        daysSpan: true
                    },
                    TIMEZONE
                );
                header2Labels = monthSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                timeSlots = weekSlots(rangeStart, rangeEnd, options, TIMEZONE);
                break;

            case 'year':
                header1Labels = yearSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                header2Labels = quarterSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                let months = monthSlots(
                    rangeStart,
                    rangeEnd,
                    options,
                    TIMEZONE
                );
                months.forEach((month) => {
                    month.span = 1;
                });
                timeSlots = months;
                break;

            default:
                console.error('Invalid viewType selected');
        }

        timeSlots.forEach((c) => {
            c.id = (Math.random() + 1).toString(36).substring(7);
        });

        this.nextHeader1Labels = header1Labels;
        this.nextHeader2Labels = header2Labels;
        this.nextTimeSlots = timeSlots;
    }

    async updateSlotDimensions() {
        this.timeSlots = this.nextTimeSlots;
        this.header1Labels = this.nextHeader1Labels;
        this.header2Labels = this.nextHeader2Labels;

        this.calculateTableWidth();
        this.createColumnsTable();
        this.calculateColgroup();
        this.calculateCursorPosition();
    }

    updateSlotGeometry() {
        const options = {
            ...this.tOptions,
            dateFormat: this.tDateFormatHeader,
            workDays: this.workDays,
            slotSize: this.slotSize,
            showWorkDays: this.tOptions.showWorkDays
        };

        const v = this.currentView;

        // header1
        if (this.nextHeader1Labels) {
            this.updateSlotOffsets(
                v === 'month' ? 'year' : v === 'year' ? 'year' : 'month',
                this.nextHeader1Labels,
                options
            );
        }

        // header2
        if (this.nextHeader2Labels) {
            this.updateSlotOffsets(
                v === 'year'
                    ? 'quarter'
                    : v === 'month'
                        ? 'month'
                        : 'week-header',
                this.nextHeader2Labels,
                options
            );
        }

        // timeslots
        if (this.nextTimeSlots) {
            this.updateSlotOffsets(
                v === 'day'
                    ? 'day'
                    : v === 'week'
                        ? 'day'
                        : v === 'month'
                            ? 'week'
                            : 'month',
                this.nextTimeSlots,
                options
            );
        }
    }

    updateSlotOffsets(type, slots, options) {
        if (!slots || !slots.length) return;

        let currentLeft = 0;
        const { slotSize, showWorkDays, workDays, dateFormat } = options;
        const workDaysCount = showWorkDays ? workDays.length : 7;

        for (const slot of slots) {
            let newWidth = 0;
            let formatKey = null;

            if (type === 'day') {
                newWidth = slotSize;
                formatKey = 'day';
            } else if (type === 'week') {
                // For timeSlots in month view: each week slot width based on days in that week
                newWidth = (slotSize / workDaysCount) * slot.span;
                formatKey = 'week';
            } else if (type === 'week-header') {
                // For header2 (week labels) in day/week view: spans multiple day columns
                newWidth = slotSize * slot.span;
                formatKey = 'week';
            } else if (type === 'month') {
                if (slot.span === 1) {
                    newWidth = slotSize;
                } else {
                    newWidth = slot.span * slotSize;
                }
                formatKey = 'month';
            } else if (type === 'year') {
                newWidth = slot.span * slotSize;
                formatKey = 'year';
            } else if (type === 'quarter') {
                newWidth = slot.span * slotSize;
                formatKey = 'quarter';
            }

            // Recalculate label if dateFormat is available
            if (formatKey && dateFormat) {
                slot.label = DateTimeFormatWithExtras(
                    LOCALE,
                    dateFormat[formatKey]
                ).format(slot.start);
            }

            slot.offsetWidth = newWidth;
            slot.offsetLeft = currentLeft;
            currentLeft += newWidth;
        }
    }

    renderTasksAndDependencies() {
        this.renderTaskData();
        this.renderDependencies();
        this.adjustHeight();
    }

    async renderTaskData() {
        if (!this.isRendered) return;
        if (!Array.isArray(this.taskTree)) return;
        this.invalidatePositionCacheIfNeeded();

        const totalTasks = this.visibleTasks.length;
        const batchSize = 10;

        for (let i = 0; i < totalTasks; i += batchSize) {
            const end = Math.min(i + batchSize, totalTasks);

            for (let j = i; j < end; j++) {
                let taskId = this.visibleTasks[j];
                this.updateSingleTask(taskId, j);
            }

            if (end < totalTasks) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        }
    }

    async renderDependencies(affectedTaskIds = null) {
        const visibleSet = new Set(this.visibleTasks);
        const viewportTasks = this.getViewportTaskIds();
        const batchSize = 50;

        const tasksToProcess = affectedTaskIds
            ? [...affectedTaskIds].filter((id) => viewportTasks.has(id))
            : [...viewportTasks];

        const taskCoordinates = {};
        for (const taskId of tasksToProcess) {
            if (!visibleSet.has(taskId)) continue;

            const task = this.taskManager?.getTaskById(taskId);
            if (!task) continue;

            const index = this.visibleTasks.indexOf(taskId);

            const positionData = this.calculatePositionAndCoordinates(
                task,
                index
            );

            if (positionData?.coordinates) {
                taskCoordinates[taskId] = positionData.coordinates;
            }
        }

        if (!this.taskManager.dependencies) {
            this.tDependencies = [];
            return;
        }

        const allDeps = this.taskManager.dependencies;
        const totalDeps = allDeps.length;
        const results = [];

        for (let i = 0; i < totalDeps; i += batchSize) {
            const end = Math.min(i + batchSize, totalDeps);

            for (let j = i; j < end; j++) {
                const dep = allDeps[j];

                const isVisible =
                    viewportTasks.has(dep.gm__predecessorUID) ||
                    viewportTasks.has(dep.gm__successorUID);

                if (isVisible) {
                    const pId = dep.gm__predecessorUID;
                    const sId = dep.gm__successorUID;

                    results.push({
                        ...dep,
                        selected: this.selectedRows?.includes(
                            dep.gm__dependencyUID
                        ),
                        predecessorTaskCoords:
                            taskCoordinates[pId] ||
                            this.calculateCoordsForTask(pId),
                        successorTaskCoords:
                            taskCoordinates[sId] ||
                            this.calculateCoordsForTask(sId)
                    });
                }
            }

            if (end < totalDeps) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        }

        this.tDependencies = results;
    }

    calculateTaskCoordinates() {
        return this.visibleTasks.reduce((coordinates, taskId, index) => {
            const task = this.taskManager.getTaskById(taskId);
            const positionData = this.calculatePositionAndCoordinates(
                task,
                index
            );

            if (positionData && positionData.coordinates) {
                coordinates[task.gm__elementUID] = positionData.coordinates;
            }

            return coordinates;
        }, {});
    }

    adjustHeight() {
        if (!this.isRendered) return;

        const host = this.template.host;
        const { rowHeight, displayedTasks, minGanttHeight } = this.options;

        const UNLIMITED_TASKS_THRESHOLD = 999;
        const FULLSCREEN_BOTTOM_MARGIN = 25;

        host.style.setProperty('--row-height', `${rowHeight}px`);

        if (this.fullscreen) {
            const gridContent = this.refs.gridContent;
            const bounds = gridContent?.getBoundingClientRect();
            if (bounds) {
                const dynamicHeight = `calc(100vh - ${bounds.top + FULLSCREEN_BOTTOM_MARGIN}px)`;
                host.style.setProperty(
                    '--gm-grid-content-height',
                    dynamicHeight
                );
            }
            return;
        }

        if (displayedTasks === UNLIMITED_TASKS_THRESHOLD) {
            host.style.setProperty(
                '--gm-grid-content-min-height',
                minGanttHeight
            );
            host.style.removeProperty('--gm-grid-content-height');
            return;
        }

        const calculatedHeight = `${rowHeight * displayedTasks}px`;
        host.style.setProperty('--gm-grid-content-height', calculatedHeight);
        host.style.removeProperty('--gm-grid-content-min-height');
    }

    smoothScrollX(el, left, instant) {
        if (instant) {
            el.scrollLeft = left;
            return;
        }

        try {
            el.scrollTo({ left, behavior: 'smooth' });
        } catch {
            const start = el.scrollLeft;
            const dist = left - start;
            const dur = 100;
            const t0 = performance.now();

            const easeInOutQuad = (p) => {
                return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
            };

            const tick = (t) => {
                const p = Math.min(1, (t - t0) / dur);
                el.scrollLeft = start + dist * easeInOutQuad(p);
                if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    }

    scrollToTime(time, instant = false) {
        if (!this.refs?.timeline || !time) return;

        const timeOffset = Math.round(this.offset(time));
        const taskIndex = this.visibleTasks.findIndex((taskId, i) => {
            const node = this.taskManager.getTaskById(taskId);
            return (
                i > 0 &&
                ((node.gm__start <= time && time <= node.gm__end) ||
                    node.gm__start > time)
            );
        });

        const scrollTop =
            taskIndex > -1 ? Math.round(taskIndex * this.options.rowHeight) : 0;

        const targetX = Math.max(0, timeOffset - 20);

        if (this.tableWidth > targetX && targetX > 0) {
            this.smoothScrollX(this.refs.timeline, targetX, instant);
            this.scrollToPosition(scrollTop);
        }
    }

    scrollToTask(elementId) {
        const task = this.taskManager.getTaskById(elementId);

        // 1. Find vertical index (Row Number)
        const index = this.visibleTasks.indexOf(elementId);

        // Guard: Task must exist, have a position, and be currently visible (not collapsed)
        if (!task || typeof task.left !== 'number' || index === -1) {
            console.warn(
                `Task ${elementId} not found or is currently collapsed/hidden.`
            );
            return;
        }

        // 2. Calculate Targets
        const timeline = this.refs?.timeline;
        const gridContent = this.refs?.gridContent;
        if (!timeline || !gridContent) return;

        const targetX = Math.max(task.left - 20, 0);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.smoothScrollX(timeline, targetX);
            });
        });
    }

    toggleRow(taskIdList, expanded) {
        console.log(
            '🔧 expandedRows setter called (taskIdList):',
            taskIdList?.length
        );

        for (let id of taskIdList) {
            this.callbackTask[id]?.setExpanded(expanded);
        }

        this.updateTaskTree();
        this.renderDependencies();
    }

    // HELPER METHOD: Update a single task
    updateSingleTask(taskId, index) {
        let task = this.taskManager.getTaskById(taskId);

        if (!this.callbackTask[taskId]) return;

        let { position } = this.calculatePositionAndCoordinates(task, index);
        let progress = Number(task.gm__progress ?? 0).toFixed(0);

        let grouperHeight = this.calculateGrouperHeight(task);

        task.left = position?.left || 0;
        task.width = position?.width || 0;
        task.slotSize = this.slotSize;

        const updates = {
            color: task.gm__taskColor,
            rowHeight: this.options.rowHeight,
            type: task.gm__type,
            title: task.gm__title,
            left: task.left,
            width: task.width,
            progress: progress,
            grouperHeight: grouperHeight,
            rules: task.gm__rules,
            start: task.gm__start,
            end: task.gm__end
        };

        this.callbackTask[taskId].updateTask(updates);
    }

    // OPTIMIZATION: Batch cache invalidation
    invalidatePositionCacheIfNeeded() {
        const currentRange = this.range;
        const currentSlotSize = this.slotSize;

        const rangeChanged =
            this._lastRangeStart !== currentRange?.rangeStart?.getTime() ||
            this._lastRangeEnd !== currentRange?.rangeEnd?.getTime() ||
            this._lastSlotSize !== currentSlotSize;

        if (rangeChanged) {
            this._positionCache.clear();
            this._lastRangeStart = currentRange?.rangeStart?.getTime();
            this._lastRangeEnd = currentRange?.rangeEnd?.getTime();
            this._lastSlotSize = currentSlotSize;
        }
    }

    calculatePositionAndCoordinates(task, index) {
        const taskUID = task.gm__elementUID;

        const cacheKey = `${taskUID}_${task.gm__start?.getTime()}_${task.gm__end?.getTime()}_${index}`;

        if (this._positionCache.has(cacheKey)) {
            return this._positionCache.get(cacheKey);
        }

        const position = this.taskPosition(task);
        const milestoneWidth = 20;

        let start = position.left;
        let end = start + position.width;

        if (task.gm__type === 'milestone') {
            start -= milestoneWidth / 2;
            end = start + milestoneWidth;
        }

        const result = {
            position: position,
            coordinates: {
                start,
                end,
                rowIndex: index
            }
        };

        this._positionCache.set(cacheKey, result);

        return result;
    }

    createColumnsTable() {
        let length = this.timeSlots.length;

        let columnCells = new Array(length);
        let totalSpan = 0;

        // Cache frequently used strings
        let baseCellClass = 'table-td';
        let nonWorkingClass = 'nonworking-column';
        let baseLabelClass = 'cell-title';
        let morningClass = 'morning-class';

        for (let i = 0; i < length; i++) {
            let slot = this.timeSlots[i];
            let { span, isNonWorking, isMorning, offsetWidth } = slot;

            // Build class string efficiently
            let cellClass = baseCellClass;
            if (isNonWorking) {
                cellClass += ` ${nonWorkingClass}`;
            }

            // Build cell attributes object
            let cellAttributes = {
                index: `c${i}`,
                className: cellClass,
                style: `width:${offsetWidth}px`
            };

            // Only add colspan if needed
            if (span !== 1) {
                cellAttributes.colspan = span;
            }

            columnCells[i] = cellAttributes;
            totalSpan += span;

            // Build label class efficiently
            let cellLabelClass = baseLabelClass;
            if (isMorning) {
                cellLabelClass += ` ${morningClass}`;
            }

            if (this.currentView !== 'year') {
                let ticksNumber = 0;
                if (this.currentView === 'month') {
                    ticksNumber = slot.span;
                } else {
                    ticksNumber = this.options.showWorkHours
                        ? this.options.workDayEnd - this.options.workDayStart
                        : 24;
                }
                cellLabelClass += ` tick-cell ticks-${ticksNumber}`;

                if (this.currentView === 'day') {
                    cellLabelClass += ` ticks-small-${ticksNumber * 4}`;
                }
            }

            if (
                new Date(slot.start) < new Date() &&
                new Date(slot.end) > new Date()
            ) {
                cellLabelClass += ` cell-today`;
            }

            slot.cellClass = cellLabelClass;
        }

        // Create columns array efficiently
        let columns = new Array(totalSpan);
        for (let i = 0; i < totalSpan; i++) {
            columns[i] = i;
        }

        this.columnsTable = {
            columns: columns,
            elements: columnCells
        };

        // OPTIMIZATION: Rebuild column offsets when columns table changes
        this.buildColumnOffsets();
    }

    calculateSlotSize(selectedView) {
        let mainContainer = this.refs.main;
        let timelineWidth = mainContainer
            ? mainContainer.getBoundingClientRect().width
            : 1200;

        const { rangeStart, rangeEnd } = this.range;

        let duration = rangeEnd - rangeStart;
        let days = duration / (1000 * 60 * 60 * 24);

        // Define slotConfig for each view
        const slotConfig = {
            day: { unitCount: days, minSize: 500 },
            week: { unitCount: days, minSize: this.options.slotSize },
            month: { unitCount: days / 7, minSize: this.options.slotSize },
            year: { unitCount: days / 30, minSize: this.options.slotSize }
        };

        let slotSize, unitCount, config;

        switch (selectedView) {
            case 'full': {
                const { viewType, slotSize: autoSlotSize } =
                    this.taskManager.getAutoViewZoomType(
                        timelineWidth,
                        slotConfig
                    );

                config = slotConfig[viewType];
                unitCount = Math.max(config.unitCount, 1);
                slotSize = autoSlotSize;

                // full is not a real view but it select 1 of the 4 existant
                this.fullSelectedView = viewType;
                this.tslotSize = slotSize;

                this.tDateFormatHeader = this.getDateFormatForSlotSize(
                    viewType,
                    slotSize
                );
                return;
            }
            default:
                this.fullSelectedView = null;
                config = slotConfig[selectedView] || {
                    unitCount: days,
                    minSize: 100
                };
                unitCount = Math.max(config.unitCount, 1);
                slotSize =
                    Math.max(config.minSize, timelineWidth / unitCount) *
                    (this.tZoomLevelValue || 1);
                this.tslotSize = Math.round(slotSize);

                this.tDateFormatHeader = this.getDateFormatForSlotSize(
                    selectedView,
                    slotSize
                );
                break;
        }
    }

    getDateFormatForSlotSize(viewType, slotSize) {
        if (viewType === 'day') {
            return {
                day: { day: 'numeric', weekday: 'long' },
                week: { week: true, weekInterval: 'long' },
                month: { month: 'long', year: 'numeric' }
            };
        }
        if (viewType === 'week') {
            if (slotSize >= 100) {
                return {
                    day: { weekday: 'long', day: 'numeric' },
                    week: { week: true, weekInterval: 'long' },
                    month: { month: 'long', year: 'numeric' }
                };
            } else if (slotSize >= 50) {
                return {
                    day: { weekday: 'short', day: 'numeric' },
                    week: { week: true },
                    month: { month: 'long', year: 'numeric' }
                };
            }

            return {
                day: { day: 'numeric' },
                week: { week: true },
                month: { month: 'long', year: 'numeric' }
            };
        }
        if (viewType === 'month') {
            if (slotSize >= 120) {
                return {
                    week: { week: true, weekInterval: 'long' },
                    month: { month: 'long' },
                    year: { year: 'numeric' }
                };
            }

            if (slotSize >= 100) {
                return {
                    week: { week: true, weekInterval: 'short' },
                    month: { month: 'long' },
                    year: { year: 'numeric' }
                };
            }

            return {
                week: { week: true },
                month: { month: 'long' },
                year: { year: 'numeric' }
            };
        }
        if (viewType === 'year') {
            if (slotSize >= 100) {
                return {
                    month: { month: 'long' },
                    year: { year: 'numeric' },
                    quarter: { quarter: true }
                };
            }

            return {
                month: { month: 'short' },
                year: { year: 'numeric' },
                quarter: { quarter: true }
            };
        }
        // Default fallback
        return {};
    }

    calculateColgroup() {
        let totalSlots = this.nextTimeSlots.length,
            colgroup = [];

        for (let slotIndex = 0; slotIndex < totalSlots; slotIndex++) {
            for (
                let columnSpanIndex = 0;
                columnSpanIndex < this.nextTimeSlots[slotIndex].span;
                columnSpanIndex++
            ) {
                colgroup.push('A' + slotIndex + 'B' + columnSpanIndex);
            }
        }

        this.colgroup = colgroup;
    }

    calculateCursorPosition() {
        let today = DateTime.now().setZone(TIMEZONE).toJSDate();
        let todayCursorPosition = this.offset(today);
        this.template.host.style.setProperty(
            '--gm-today-cursor-position',
            `${todayCursorPosition}px`
        );
    }

    calculateTableWidth() {
        let host = this.template.host;
        let maxSpan = 0;
        let totalSpan = 0;

        for (let index = 0; index < this.nextTimeSlots.length; index++) {
            let span = this.nextTimeSlots[index].span;
            totalSpan += span;
            if (span > maxSpan) {
                maxSpan = span; // Track the maximum span encountered
            }
        }

        let tableWidth = Math.round((totalSpan * this.slotSize) / maxSpan);
        this.tableWidth = tableWidth;
        host.style.setProperty('--gm-container-width', `${tableWidth}px`);
    }

    taskPosition(task) {
        if (!task.gm__start || !task.gm__end) {
            return { left: 0, width: 0 };
        }

        // By this point, dates should already be Date objects in user's timezone
        // from the initial parsing when data was loaded
        let startOffset = Math.round(this.offset(task.gm__start));
        let endOffset = Math.round(this.offset(task.gm__end));

        if (task.milestone) {
            startOffset += 8;
            endOffset += 9;
        }

        return {
            left: startOffset,
            width: endOffset - startOffset
        };
    }

    // ============================
    // Event handlers
    // ============================
    handleTaskAction(event) {
        let { action, value } = event.detail;

        this.dragState = {
            dragStart: true,
            ...this.dragState,
            ...{ action, ...value }
        };

        if (action !== 'select') {
            // Store active interaction in taskManager for all tasks to access
            this.taskManager.setActiveInteraction({
                task: this.taskManager.getTaskById(this.dragState.id),
                type: this.dragState.action,
                activeId: this.dragState.id
            });
        }

        // Handle specific action types
        switch (action) {
            case 'dependency':
                let { clientX, clientY } =
                    this.getClientCoordinatesRelativeToGrid(
                        this.dragState.positionX,
                        this.dragState.positionY
                    );
                this.startPoint = { x: clientX, y: clientY };
                break;

            case 'select':
                let selectedId = this.dragState.id;
                let selectedRows = selectedId ? [selectedId] : [];
                this.applySelection(selectedRows);
                break;
            default:
                break;
        }
    }

    handleDragStart(event) {
        if (event.button !== 0) return;
        if (this.dragState?.dragStart) return;

        let tagName = event.target.tagName.toLowerCase();

        let lwcElem = [
            'c-gantt-dependency-lwc',
            'c-gantt-task-lwc',
            'gmpkg-gantt-dependency-lwc',
            'gmpkg-gantt-task-lwc'
        ];

        if (!lwcElem.includes(tagName)) {
            this.applySelection();
        }
    }

    handleDrag(event) {
        event.preventDefault();

        if (!this.dragState?.dragStart) return;
        this.dragState.dragging = true;
        let { action } = this.dragState;

        switch (action) {
            case 'dependency': {
                this.updateDependencyDragHint(event);
                break;
            }

            case 'progress': {
                this.handleDragProgress(event);
                break;
            }

            case 'resize': {
                this.handleDragResize(event);

                this.handleHeaderRuler(
                    this.dragState.left,
                    this.dragState.width,
                    this.dragState.isResizeStart
                        ? this.dragState.start
                        : this.dragState.end,
                    !this.dragState.isResizeStart
                );
                break;
            }

            case 'slide': {
                this.handleDragSlide(event);

                this.handleHeaderRuler(
                    this.dragState.left,
                    this.dragState.width,
                    this.dragState.start
                );

                break;
            }

            default:
                break;
        }
    }

    handleDragEnd() {
        let task = this.dragState;

        if (!task || !task.id || !this.callbackTask[task.id]) {
            this.dragState = null;
            return;
        }

        let taskObject = this.taskManager.getTaskById(task.id);
        if (task.dragging) {
            switch (task.action) {
                case 'progress': {
                    this.dispatchRowAction('updateTask', {
                        gm__elementUID: task.id,
                        gm__progress: Math.round(task.progress)
                    });
                    break;
                }
                case 'slide':
                case 'resize': {
                    let addTimezoneOffset = (rawDateStr, baseDate) => {
                        let raw = new Date(rawDateStr);
                        let snapped = this.getSnappedDate(raw, baseDate);

                        return new Date(
                            snapped.getTime() +
                            getTimezoneDiff(snapped, TIMEZONE)
                        );
                    };

                    this.dispatchRowAction('updateTask', {
                        gm__elementUID: task.id,
                        ...(task.start && {
                            gm__start: addTimezoneOffset(
                                task.start,
                                taskObject.gm__start
                            )
                        }),
                        ...(task.end && {
                            gm__end: addTimezoneOffset(
                                task.end,
                                taskObject.gm__end
                            )
                        })
                    });

                    break;
                }
                case 'dependency': {
                    this.removeDependencyDragHint();
                    if (!task.successorId || task.successorId === task.id)
                        break;

                    let predType = task.predecessorStart ? 'start' : 'end';
                    let succType = task.successorStart ? 'start' : 'end';

                    this.dispatchRowAction('createDependency', {
                        gmpkg__Type__c: `${predType}-to-${succType}`,
                        gm__predecessorUID: task.id,
                        gm__successorUID: task.successorId
                    });
                    break;
                }
                default:
                    break;
            }
        }

        this.handleHeaderRuler(null);
        this.visibleTasks.forEach((taskId) => {
            this.callbackTask[taskId].reset();
        });
        this.dragState = null;
    }

    handleDragProgress(event) {
        let { id, left, width } = this.dragState;

        let coords = this.getClientCoordinatesRelativeToGrid(
            event.clientX,
            event.clientY
        );
        let clientX = coords.clientX;

        let progressWidth = Math.max(0, Math.min(width, clientX - left));
        let progress = (progressWidth / width) * 100;

        this.dragState = { ...this.dragState, progress };
        this.callbackTask[id].handleProgressUpdate({ progress });
    }

    handleDragResize(event) {
        let { id, isResizeStart, width, left } = this.dragState;
        let task = this.taskManager.getTaskById(id);

        // Get the current time based on mouse position
        let time = this.timeByPosition(event.clientX, false, isResizeStart);

        let { clientX } = this.getClientCoordinatesRelativeToGrid(
            event.clientX,
            event.clientY
        );

        let newLeft, newWidth, newValue;

        if (isResizeStart) {
            newLeft = clientX;
            newWidth = width + left - clientX;
            newValue = Math.min(time, task.gm__end.getTime());
        } else {
            newLeft = left;
            newWidth = clientX - left;
            newValue = Math.max(time, task.gm__start.getTime());
        }

        this.dragState = {
            ...this.dragState,
            left: newLeft,
            width: newWidth,
            ...(isResizeStart && {
                start: newValue
            }),
            ...(!isResizeStart && {
                end: newValue
            })
        };

        // Apply updates to the task element
        this.callbackTask[id].handleResizeAction({
            startOffset: newLeft,
            endOffset: newLeft + newWidth
        });
    }

    handleDragSlide(event) {
        let { id, relativeLeft, width } = this.dragState;

        let leftPosition = event.clientX - relativeLeft;

        // Calculate proposed times
        let timeStart = this.timeByPosition(leftPosition, false, true);
        let timeEnd = this.timeByPosition(leftPosition + width, false, true);

        let newLeft = this.offset(timeStart);

        this.dragState = {
            ...this.dragState,
            left: newLeft,
            start: timeStart,
            end: timeEnd
        };

        this.callbackTask[id].handleSlideAction({
            startOffset: newLeft
        });
    }

    handleRegistration(event) {
        event.stopPropagation();

        let {
            reset,
            setSelected,
            setExpanded,
            handleProgressUpdate,
            handleResizeAction,
            handleSlideAction,
            updateTask,
            recalculateDerivedData,
            key
        } = event.detail;

        this.callbackTask[key] = {
            setSelected,
            setExpanded,
            handleProgressUpdate,
            handleResizeAction,
            handleSlideAction,
            updateTask,
            recalculateDerivedData,
            reset
        };

        const index = this.visibleTasks.indexOf(key);
        if (index !== -1) {
            this.updateSingleTask(key, index);
        }
    }

    handleScrollY(event) {
        let { scrollTop, clientHeight } = event.target;

        const rowHeight = this.options?.rowHeight || 1;
        if (rowHeight <= 0) return;

        const maxIndex = this.visibleTasks?.length || 0;
        const newStart = Math.floor(scrollTop / rowHeight);
        const newEnd = Math.ceil((scrollTop + clientHeight) / rowHeight);

        this.dispatchEvent(
            new CustomEvent('timelinescroll', {
                detail: { scrollTop }
            })
        );

        const THRESHOLD = 5;
        if (
            Math.abs(this.viewportStartIndex - newStart) < THRESHOLD &&
            Math.abs(this.viewportEndIndex - newEnd) < THRESHOLD
        ) {
            return;
        }

        this.viewportStartIndex = Math.max(0, newStart);
        this.viewportEndIndex = Math.min(maxIndex, newEnd);

        // Call debounced function
        if (this.debouncedRenderDependencies) {
            this.debouncedRenderDependencies();
        }

        if (this.options.enableHScroll) {
            clearTimeout(this._scrollYTimeout);
            this._scrollYTimeout = setTimeout(() => {
                let index = Math.round(scrollTop / rowHeight);
                if (index >= 0 && index < this.visibleTasks.length) {
                    let elementId = this.visibleTasks[index];
                    this.scrollToTask(elementId);
                }
            }, 50);
        }
    }

    // ===========================
    // Position
    // ===========================

    // Calculate the time based on the position
    timeByPosition(positionX, isEnd, isStart) {
        let timeSlot = this.slotByPosition(positionX);

        if (isEnd) {
            return isStart ? timeSlot.end : timeSlot.start;
        }

        let coords = this.getClientCoordinatesRelativeToGrid(positionX);
        let relativePosition = coords.clientX;

        let totalDuration = timeSlot.end - timeSlot.start;
        let offset =
            totalDuration *
            ((relativePosition - timeSlot.offsetLeft) / timeSlot.offsetWidth);

        let newStartDate = new Date(timeSlot.start.getTime() + offset);
        return newStartDate;
    }

    // Get the time slot based on position
    slotByPosition(positionX) {
        let coords = this.getClientCoordinatesRelativeToGrid(positionX);
        let relativePosition = coords.clientX;
        let slotIndex = this.slotIndex('offsetLeft', relativePosition);

        return this.timeSlots[slotIndex];
    }

    // ===========================
    // Selection
    // ===========================
    applySelection(rows = []) {
        try {
            this.dispatchRowAction('select', rows);
        } catch (err) {
            console.error('Error applying selection:', err);
        }
    }

    dispatchRowAction(action, value) {
        this.dispatchEvent(
            new CustomEvent('rowaction', {
                detail: {
                    action,
                    value
                }
            })
        );
    }

    // ===========================
    // Dependency
    // ===========================
    updateDependencyDragHint(event) {
        let coords = this.getClientCoordinatesRelativeToGrid(
            event.clientX,
            event.clientY
        );

        this.endPoint = { x: coords.clientX, y: coords.clientY };

        this.removeDependencyDragHint();
        this.createDependencyDragHint(this.startPoint, this.endPoint);
    }

    createDependencyDragHint(startPoint, endPoint) {
        let deltaX = endPoint.x - startPoint.x;
        let deltaY = endPoint.y - startPoint.y;
        let lineLength = Math.hypot(deltaX, deltaY); // More concise calculation
        let angle = Math.atan2(deltaY, deltaX); // Handles all quadrants directly

        let lineElement = this.template.querySelector('.gantt-dependency-hint');
        if (lineElement) {
            Object.assign(lineElement.style, {
                top: `${startPoint.y}px`,
                left: `${startPoint.x}px`,
                width: `${lineLength}px`,
                transformOrigin: '0% 0',
                transform: `rotate(${angle}rad)`
            });
        }
    }

    removeDependencyDragHint() {
        let lineElement = this.template.querySelector('.gantt-dependency-hint');
        if (lineElement) {
            Object.assign(lineElement.style, {
                top: '0px',
                left: '0px',
                width: '0px',
                transformOrigin: '0% 0',
                transform: 'rotate(0rad)'
            });
        }
    }

    // ============================
    // Utils
    // ============================
    _rulerRAF;
    handleHeaderRuler(left, width, date, isEnd) {
        const ruler = this.refs.taskRuler;
        const taskdate = this.refs.taskDate;

        if (this._rulerRAF) {
            cancelAnimationFrame(this._rulerRAF);
            this._rulerRAF = null;
        }

        if (left === null) {
            ruler.style.display = 'none';
            taskdate.style.display = 'none';
            return;
        }

        const snappedDate = this.getSnappedDate(date);
        const taskDatePosition = left + (isEnd ? width : 0);

        // Format date in user's timezone
        const dateText =
            this.currentView === 'day' || this.currentView === 'week'
                ? formatDateHourMinutes(LOCALE, snappedDate)
                : formatDateMonth(LOCALE, snappedDate);

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._rulerRAF = requestAnimationFrame(() => {
            this._rulerRAF = null;

            ruler.style.cssText = `
            display: block;
            transform: translateX(${left}px);
            width: ${width}px;
            height: 100%;
        `;

            taskdate.style.cssText = `
            display: block;
            transform: translateX(${taskDatePosition}px);
        `;
            taskdate.textContent = dateText;
        });
    }

    getSnappedDate(value, baseDate) {
        let date = new Date(value);

        switch (this.currentView) {
            case 'day': {
                let snappedMinutes = Math.floor(date.getMinutes() / 15) * 15;
                date.setMinutes(snappedMinutes, 0, 0);
                break;
            }

            case 'week':
                date.setMinutes(0, 0, 0);
                break;

            default: {
                if (baseDate) {
                    let base = new Date(
                        baseDate.getTime() - getTimezoneDiff(baseDate, TIMEZONE)
                    );
                    date.setHours(base.getHours());
                    date.setMinutes(base.getMinutes());
                    date.setSeconds(base.getSeconds());
                }
                break;
            }
        }

        return date;
    }

    getClientCoordinatesRelativeToGrid(positionX, positionY) {
        let gridContent = this.refs.gridContent;
        let bounds = gridContent.getBoundingClientRect();

        let coords = {};
        coords.clientX = positionX + gridContent.scrollLeft - bounds.left;
        coords.clientY = positionY
            ? positionY + gridContent.scrollTop - bounds.top
            : null;
        return coords;
    }

    // Find the index of a slot based on a property and value
    slotIndex(property, value) {
        let start = 0;
        let end = this.timeSlots.length - 1;

        while (start < end) {
            let mid = Math.ceil((start + end) / 2);
            let propertyVal = this.timeSlots[mid][property];

            if (property === 'start' && this.timeSlots[mid].min) {
                propertyVal = new Date(propertyVal).setHours(0, 0, 0, 0);
            }

            if (value >= propertyVal) {
                start = mid;
            } else {
                end = mid - 1;
            }
        }

        return start;
    }

    // Calculate the offset for a given date
    offset(date) {
        let slotIndex = this.slotIndex('start', date);
        let timeSlot = this.timeSlots[slotIndex];

        // Calculate position within the step
        let offsetLeft;
        if (date > timeSlot.end) {
            offsetLeft = timeSlot.offsetLeft + timeSlot.offsetWidth;
        } else if (timeSlot.start > date) {
            offsetLeft = timeSlot.offsetLeft;
        } else {
            let duration = timeSlot.end - timeSlot.start;
            let positionRatio = (date - timeSlot.start) / duration;
            offsetLeft =
                timeSlot.offsetLeft + positionRatio * timeSlot.offsetWidth;
        }

        return offsetLeft;
    }

    offsetToDate(offsetLeft) {
        if (!this.timeSlots || this.timeSlots.length === 0) return null;

        const slots = this.timeSlots;

        const minLeft = slots[0].offsetLeft;
        const maxLeft =
            slots[slots.length - 1].offsetLeft +
            slots[slots.length - 1].offsetWidth;

        if (offsetLeft <= minLeft) {
            return new Date(slots[0].start);
        }
        if (offsetLeft >= maxLeft) {
            return new Date(slots[slots.length - 1].end);
        }

        let slot = null;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            const left = s.offsetLeft;
            const right = s.offsetLeft + s.offsetWidth;

            if (offsetLeft >= left && offsetLeft <= right) {
                slot = s;
                break;
            }
        }

        if (!slot) {
            slot = slots.reduce((best, s) => {
                const center = s.offsetLeft + s.offsetWidth / 2;
                return Math.abs(offsetLeft - center) <
                    Math.abs(
                        offsetLeft - (best.offsetLeft + best.offsetWidth / 2)
                    )
                    ? s
                    : best;
            }, slots[0]);
        }

        const { start, end, offsetLeft: slotLeft, offsetWidth } = slot;

        const ratio = (offsetLeft - slotLeft) / offsetWidth;
        const durationMs = end.getTime() - start.getTime();
        const exactTime = start.getTime() + ratio * durationMs;

        return new Date(exactTime);
    }

    throttle(callback, limit) {
        let waiting = false;

        return function (...args) {
            if (!waiting) {
                callback.apply(this, args);
                waiting = true;

                setTimeout(() => {
                    waiting = false;
                }, limit);
            }
        };
    }

    // OPTIMIZATION: Debounce utility for expensive operations
    debounce(fn, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    setLoading(loading) {
        let loadingEvent = new CustomEvent('toggleloading', {
            detail: { loading }
        });

        this.dispatchEvent(loadingEvent);
    }
}
