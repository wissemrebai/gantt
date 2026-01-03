import { LightningElement, api } from 'lwc';
import { loadStyle } from 'lightning/platformResourceLoader';
import { DragGhost } from './dragGhost.js';
import treeStyles from '@salesforce/resourceUrl/tree';
import Search from '@salesforce/label/c.Search';
import GanttCriticalPathAbbr from '@salesforce/label/c.GanttCriticalPathAbbr';

const HEADER_HEIGHT = 100;
const HEADER_OFFSET = 34;
const SEARCH_DEBOUNCE_TIME = 300;
const TREE_HEADER_HEIGHT = 34;

export default class GanttTreeListLwc extends LightningElement {
    labels = {
        Search,
        CriticalPathAbbr: GanttCriticalPathAbbr
    };

    // --- API Properties ---
    @api taskManager = null;
    @api expandedRows = [];
    @api highlightedRows = [];
    @api selectedRows = [];

    @api
    get scrollPosition() {
        return this.tScrollPosition;
    }
    set scrollPosition(value) {
        if (Math.abs(this.tScrollPosition - value) > 1) {
            this.tScrollPosition = value;
            this.treelist?.scrollToTop(value);
        }
    }

    @api
    get fullscreen() {
        return this.tFullScreen;
    }
    set fullscreen(value) {
        this.tFullScreen = value;
        if (this.rendered) {
            this.setTreeHeight();
        }
    }

    @api
    get options() {
        return this.toptions;
    }
    set options(value) {
        this.toptions = value || {};
        this.initializeGridColumns();
    }

    // --- Private Properties ---
    keyField = 'gm__elementUID';
    toptions = {};
    gridColumns = [];
    taskTree = [];
    tScrollPosition = 0;

    // Search Optimization
    tCachedFlattenedTasks = null;
    searchTimeout = null;

    tFullScreen = false;
    tdragGhost = new DragGhost();
    tdragState = null;
    draftValues = [];
    rendered = false;
    viewportHeight = 0;

    // Drag Animation Frame Lock
    _rAFPending = false;

    // --- Getters ---
    get rowHeight() {
        return this.options?.rowHeight || 30;
    }
    get displayedTasks() {
        return this.options?.displayedTasks || 10;
    }
    get treelist() {
        return this.refs.treelist;
    }

    // --- Public Methods ---

    @api
    refreshTasks() {
        this.taskTree = [...this.taskManager.getTasksTree()];
        this.tCachedFlattenedTasks = null;
        this.initializeStyles();
        this.setTreeHeight();
    }

    // --- Lifecycle ---

    async connectedCallback() {
        // Load styles asynchronously, but don't block render
        loadStyle(this, treeStyles).catch((err) =>
            console.error('Error loading styles', err)
        );

        if (this.taskManager) {
            this.taskTree = [...this.taskManager.getTasksTree()];
        }
    }

    renderedCallback() {
        if (!this.rendered) {
            this.rendered = true;
            this.initializeStyles();
            this.setTreeHeight();
        }
    }

    // --- Event Handlers ---

    handleScroll(e) {
        // Use requestAnimationFrame for scroll events if you do heavy lifting here
        // Currently it just dispatches, which is fine.
        const { scrollTop } = e.detail;
        this.dispatchEvent(
            new CustomEvent('treescroll', { detail: { scrollTop } })
        );
    }

    handleToggle(event) {
        this.dispatchRowAction('toggle', event.detail);
    }

    handleRowSelection(event) {
        const selectedRows = event.detail.selectedRows.map(
            (row) => row[this.keyField]
        );
        this.dispatchRowAction('select', selectedRows);
    }

    handleCellChange(event) {
        const draftValues = event.detail.draftValues;

        // Ensure dates are actual Date objects
        if (draftValues[0]) {
            if (draftValues[0].gm__end)
                draftValues[0].gm__end = new Date(draftValues[0].gm__end);
            if (draftValues[0].gm__start)
                draftValues[0].gm__start = new Date(draftValues[0].gm__start);
        }

        this.draftValues = []; // Clear draft immediately to prevent UI locking
        this.dispatchRowAction('updateTask', draftValues);
    }

    handleRowAction(event) {
        const { action, row } = event.detail;
        this.dispatchRowAction(action.name, row);
    }

    // --- Search Logic (Optimized) ---

    handleSearch(event) {
        const value = this.sanitizeSearchInput(event.detail.value);

        this.clearPreviousSearch();

        if (!value) {
            this.dispatchRowAction('highlight', []);
            return;
        }

        this.debounceSearch(value);
    }

    debounceSearch(inputValue) {
        this.searchTimeout = setTimeout(() => {
            this.performSearch(inputValue);
        }, SEARCH_DEBOUNCE_TIME);
    }

    performSearch(inputValue) {
        // Optimization: Only fetch flattened tasks from manager if cache is empty
        if (!this.tCachedFlattenedTasks) {
            this.tCachedFlattenedTasks = this.taskManager.getFlattenedTasks();
        }

        const matchingTaskIds = this.tCachedFlattenedTasks
            .filter((task) =>
                task.gm__title?.toLowerCase().includes(inputValue)
            )
            .map((task) => task.gm__elementUID);

        this.dispatchRowAction('highlight', matchingTaskIds);
    }

    // --- Styling & Height ---

    setTreeHeight() {
        const host = this.template.host;
        const { rowHeight } = this.options;
        const displayedTasks = this.displayedTasks; // use getter

        const FULLSCREEN_HEIGHT_PERCENTAGE = '73vh';

        // Batch style updates
        if (this.fullscreen) {
            host.style.cssText += `--gm-tree-height: ${FULLSCREEN_HEIGHT_PERCENTAGE}; --gm-tree-max-height: none;`;
            host.style.removeProperty('--gm-tree-min-height');

            // viewportHeight * 73%
            this.viewportHeight = Math.floor(window.innerHeight * 0.73);
        } else {
            const calculatedHeight = `${displayedTasks * rowHeight + TREE_HEADER_HEIGHT}px`;
            host.style.cssText += `--gm-tree-height: ${calculatedHeight};`;
            host.style.removeProperty('--gm-tree-min-height');
            host.style.removeProperty('--gm-tree-max-height');

            this.viewportHeight =
                this.options.displayedTasks * this.options.rowHeight;
        }
    }

    initializeStyles() {
        // Use cssText to set multiple vars at once
        this.template.host.style.cssText += `
            --gm-row-height: ${this.rowHeight}px;
            --gm-header-height: ${HEADER_HEIGHT - HEADER_OFFSET}px;
        `;
    }

    // --- Drag & Drop (Optimized with requestAnimationFrame) ---

    handleReorderStart(event) {
        const { sourceRowKey } = event.detail;

        this.tdragState = {
            hasValidTarget: { valid: false },
            ...event.detail
        };

        // If dragging a parent, collapse it first to avoid visual clutter
        if (this.expandedRows.includes(sourceRowKey)) {
            this.dispatchRowAction('toggle', {
                name: sourceRowKey,
                isExpanded: false
            });
            this.tdragState.toggleState = true;
        }

        const task = this.taskManager.getTaskById(sourceRowKey);
        this.tdragGhost.create(task?.gm__title || 'Task');
    }

    handleReorderMove(event) {
        // If logic is already pending a frame render, skip this event
        if (!this.tdragState || this._rAFPending) return;

        this._rAFPending = true;

        const { sourceRowKey, targetRowKey, position } = event.detail;

        // Run visual updates in the next animation frame
        requestAnimationFrame(() => {
            if (!this.tdragState) {
                this._rAFPending = false;
                return;
            }

            const {
                hasValidTarget: lastHasValidTarget,
                targetRowKey: lastTargetRowKey
            } = this.tdragState;

            // Clear old border
            if (lastHasValidTarget?.valid && this.refs.treelist) {
                this.refs.treelist.updateReorderBorder(lastTargetRowKey, null);
            }

            // Check validity (Assuming taskManager is fast synchronous logic)
            const hasValidTarget = this.taskManager.reorderRows(
                sourceRowKey,
                targetRowKey,
                position
            );

            // Update Ghost
            this.tdragGhost.updateStyle(hasValidTarget.valid, position);

            // Draw new border
            if (hasValidTarget.valid && this.refs.treelist) {
                this.refs.treelist.updateReorderBorder(targetRowKey, position);
            }

            // Update State
            this.tdragState = {
                ...this.tdragState,
                targetRowKey, // Important: update the target key for the next frame
                position,
                hasValidTarget
            };

            this._rAFPending = false;
        });
    }

    handleReorderEnd() {
        // Cancel any pending frames
        this._rAFPending = false;

        if (!this.tdragState) return;

        const { sourceRowKey, hasValidTarget, toggleState } = this.tdragState;

        if (hasValidTarget.valid) {
            const updateDetail = {
                Id: hasValidTarget.sourceRowId,
                gm__elementUID: sourceRowKey,
                gm__orderId: hasValidTarget.newIndex,
                gm__expanded: toggleState
            };

            if (hasValidTarget.newParentId) {
                updateDetail.gm__parentUID = hasValidTarget.newParentId;
            }

            this.dispatchRowAction('reorderRows', updateDetail);
        } else if (toggleState) {
            // Re-expand if dropped invalidly
            this.dispatchRowAction('toggle', {
                name: sourceRowKey,
                isExpanded: true
            });
        }

        this.tdragState = null;
        this.tdragGhost.destroy();
    }

    // --- Helpers ---

    initializeGridColumns() {
        this.gridColumns = [...(this.toptions?.columns || [])];

        if (this.toptions?.showCriticalPath) {
            this.addCriticalPathColumn();
        } else {
            this.removeCriticalPathColumn();
        }
    }

    addCriticalPathColumn() {
        // Optimization: Don't add if already exists
        if (
            this.gridColumns.some(
                (col) => col.fieldName === 'gm__isCriticalPathIcon'
            )
        )
            return;

        const treeColumnIndex = this.gridColumns.findIndex(
            (col) => col.treeColumn
        );
        if (treeColumnIndex >= 0) {
            this.gridColumns.splice(treeColumnIndex + 1, 0, {
                label: this.labels.CriticalPathAbbr,
                fieldName: 'gm__isCriticalPathIcon',
                type: 'text',
                cellAttributes: { class: 'slds-text-color_error' }
            });
        }
    }

    removeCriticalPathColumn() {
        // Filter creates a new array, triggering reactivity correctly
        this.gridColumns = this.gridColumns.filter(
            (col) => col.fieldName !== 'gm__isCriticalPathIcon'
        );
    }

    dispatchRowAction(action, value) {
        this.dispatchEvent(
            new CustomEvent('rowaction', {
                detail: { action, value }
            })
        );
    }

    sanitizeSearchInput(value) {
        return value?.trim()?.toLowerCase() || '';
    }

    clearPreviousSearch() {
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
    }
}
