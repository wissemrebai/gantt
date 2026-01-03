import LightningDatatable from 'lightning/datatable';
import { api } from 'lwc';

import progress from './progressRing.html';
import percentFixed from './percentFixed.html';
import userAvatar from './userAvatar.html';
import customTreeCellEditTemplate from './customTreeCellEdit.html';

// Constants for better maintainability
const SCROLL_DEBOUNCE_DELAY = 0; // ~60fps
const DRAG_START_DELAY = 200;
const SPINNER_HEIGHT = '40px';

// Drag position thresholds
const POSITION_THRESHOLDS = {
    TOP: 0.33,
    BOTTOM: 0.67
};

// Visual styles
const DRAG_STYLES = {
    SOURCE_OPACITY: '0.4',
    HOVER_COLOR: 'rgba(1, 118, 211, 0.15)',
    HOVER_LIGHT: 'rgba(1, 118, 211, 0.05)',
    BORDER_COLOR: '#0176d3',
    BORDER_SIZE: '8px'
};

export default class DatatableLwc extends LightningDatatable {
    static customTypes = {
        tree: {
            editTemplate: customTreeCellEditTemplate,
            standardCellLayout: true
        },
        progress: {
            template: progress,
            typeAttributes: ['value']
        },
        'avatar-group': {
            template: userAvatar,
            typeAttributes: [
                'value',
                'maxVisible',
                'variant',
                'size',
                'overlap',
                'ariaLabel'
            ]
        },
        'percent-fixed': {
            template: percentFixed,
            typeAttributes: [
                'value',
                'maximum-fraction-digits',
                'maximum-significant-digits',
                'minimum-fraction-digits',
                'minimum-significant-digits',
                'minimum-integer-digits'
            ]
        }
    };

    // Private state
    _highlightedRows = [];
    _dragState = null;
    _mouseDownTimeout = null;
    _rowBoundsMap = new Map();
    _scrollHandler = null;
    _debouncedScrollHandler = null;
    _mouseDownHandler = null;
    _mouseMoveHandler = null;
    _mouseUpHandler = null;
    _dragDelegateAttached = false; // Track if event delegation is set up

    connectedCallback() {
        super.connectedCallback();
        this._initializeEventHandlers();
    }

    renderedCallback() {
        console.time('DatatableLwc:renderedCallback:total');

        super.renderedCallback();
        this._data = super.data;

        this._updateSpinnerHeight();

        this._setupScrollListener();

        this._setupDragAndDrop();

        console.timeEnd('DatatableLwc:renderedCallback:total');
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanupEventListeners();
    }

    /*
     * ------------------------------------------------------------
     *  PUBLIC PROPERTIES
     * -------------------------------------------------------------
     */

    @api applyMethod;
    @api orderable = false;

    @api
    get columnWidthsMode() {
        return super.columnWidthsMode;
    }
    set columnWidthsMode(value) {
        super.columnWidthsMode = value;
    }

    @api
    get columns() {
        return super.columns;
    }
    set columns(value) {
        super.columns = value;
        this._columns = super.columns;
    }

    @api
    get defaultSortDirection() {
        return super.defaultSortDirection;
    }
    set defaultSortDirection(value) {
        super.defaultSortDirection = value;
    }

    @api
    get draftValues() {
        return super.draftValues;
    }
    set draftValues(value) {
        super.draftValues = value;
    }

    @api
    get enableInfiniteLoading() {
        return super.enableInfiniteLoading;
    }
    set enableInfiniteLoading(value) {
        super.enableInfiniteLoading = value;
    }

    @api
    get errors() {
        return super.errors;
    }
    set errors(value) {
        super.errors = value;
    }

    @api
    get hideCheckboxColumn() {
        return super.hideCheckboxColumn;
    }
    set hideCheckboxColumn(value) {
        super.hideCheckboxColumn = value;
    }

    @api
    get hideTableHeader() {
        return super.hideTableHeader;
    }
    set hideTableHeader(value) {
        super.hideTableHeader = value;
    }

    @api
    get isLoading() {
        return super.isLoading;
    }
    set isLoading(value) {
        super.isLoading = value;
    }

    @api
    get keyField() {
        return super.keyField;
    }
    set keyField(value) {
        super.keyField = value;
    }

    @api
    get loadMoreOffset() {
        return super.loadMoreOffset;
    }
    set loadMoreOffset(value) {
        if (value === undefined) return;
        super.loadMoreOffset = value;
    }

    @api
    get maxColumnWidth() {
        return super.maxColumnWidth;
    }
    set maxColumnWidth(value) {
        if (value === undefined) return;
        super.maxColumnWidth = value;
    }

    @api
    get maxRowSelection() {
        return super.maxRowSelection;
    }
    set maxRowSelection(value) {
        // Patch for Lightning Datatable bug with maxRowSelection
        if (
            this.maxRowSelection === 1 &&
            (value === undefined || value === null)
        ) {
            super.maxRowSelection = 2;
        }
        super.maxRowSelection = value;
    }

    @api
    get minColumnWidth() {
        return super.minColumnWidth;
    }
    set minColumnWidth(value) {
        if (value === undefined) return;
        super.minColumnWidth = value;
    }

    @api
    get primitiveWidthsData() {
        return super.widthsData;
    }

    @api
    get records() {
        return super.data;
    }
    set records(value) {
        console.time('DatatableLwc:records:super.data');
        super.data = value;
        console.timeEnd('DatatableLwc:records:super.data');
    }
    @api
    get resizeColumnDisabled() {
        return super.resizeColumnDisabled;
    }
    set resizeColumnDisabled(value) {
        super.resizeColumnDisabled = value;
    }

    @api
    get resizeStep() {
        return super.resizeStep;
    }
    set resizeStep(value) {
        if (value === undefined) return;
        super.resizeStep = value;
    }

    @api
    get rowNumberOffset() {
        return super.rowNumberOffset;
    }
    set rowNumberOffset(value) {
        if (value === undefined) return;
        super.rowNumberOffset = value;
    }

    @api
    get scrollerX() {
        return this.template.querySelector('.slds-scrollable_x');
    }

    @api
    get scrollerY() {
        return this.template.querySelector('.slds-scrollable_y');
    }

    @api
    get selectedRows() {
        return super.selectedRows;
    }
    set selectedRows(value) {
        if (value === undefined) return;
        super.selectedRows = value;
    }

    @api
    get showRowNumberColumn() {
        return super.showRowNumberColumn;
    }
    set showRowNumberColumn(value) {
        super.showRowNumberColumn = value;
    }

    @api
    get sortedBy() {
        return super.sortedBy;
    }
    set sortedBy(value) {
        super.sortedBy = value;
    }

    @api
    get sortedDirection() {
        return super.sortedDirection;
    }
    set sortedDirection(value) {
        super.sortedDirection = value;
    }

    @api
    get suppressBottomBar() {
        return super.suppressBottomBar;
    }
    set suppressBottomBar(value) {
        super.suppressBottomBar = value;
    }

    @api
    get wrapTextMaxLines() {
        return super.wrapTextMaxLines;
    }
    set wrapTextMaxLines(value) {
        if (value === undefined) return;
        super.wrapTextMaxLines = value;
    }

    @api
    get wrapTableHeader() {
        return super.wrapTableHeader;
    }
    set wrapTableHeader(value) {
        super.wrapTableHeader = value;
    }

    @api
    get highlightedRows() {
        return this._highlightedRows;
    }
    set highlightedRows(value) {
        this._highlightedRows = value || [];
        this._applyHighlightedRows();
    }

    /*
     * ------------------------------------------------------------
     *  PRIVATE PROPERTIES
     * -------------------------------------------------------------
     */

    get wrapText() {
        return this.state.wrapText;
    }

    /*
     * ------------------------------------------------------------
     *  PUBLIC METHODS
     * -------------------------------------------------------------
     */

    @api
    focusRow(rowKeyField) {
        const row = this.template.querySelector(
            `[data-row-key-value="${rowKeyField}"]`
        );
        if (!row) return;

        const cell = row.querySelector(':first-child');
        if (cell) {
            const colKeyValue = cell.dataset.colKeyValue;
            this.setActiveCell(rowKeyField, colKeyValue);
            this.state.cellClicked = true;
            cell.focus();
        }
    }

    @api
    getRowHeight(rowKeyField) {
        const row = this.template.querySelector(
            `tr[data-row-key-value="${rowKeyField}"]`
        );

        if (row) {
            const isFirstRow = rowKeyField === this.data[0]?.[this.keyField];
            return isFirstRow ? row.offsetHeight + 1 : row.offsetHeight;
        }
        return null;
    }

    @api
    resizeColumn(event) {
        super.handleResizeColumn(event);
    }

    @api
    setRowHeight(rowKeyField, height) {
        const row = this.template.querySelector(
            `tr[data-row-key-value="${rowKeyField}"]`
        );

        if (row) {
            row.style.height = height ? `${height}px` : '';
        }
    }

    @api
    setRowColor(rowKeyField, colorVarValue) {
        const row = this.template.querySelector(
            `tr[data-row-key-value="${rowKeyField}"]`
        );

        if (row) {
            row.style.setProperty('--row-color', colorVarValue);
            row.style.backgroundColor = `var(--row-color, transparent)`;
        }
    }

    @api
    scrollToTop(y = 0) {
        const scrollableY = this.scrollerY;
        if (scrollableY) {
            scrollableY.scrollTop = y;
        }
    }

    @api
    updateReorderBorder(targetRowKey, position) {
        if (!targetRowKey) {
            this._clearAllRowBorders();
            return;
        }

        const rowBounds = this._rowBoundsMap.get(targetRowKey);
        if (rowBounds?.element) {
            this._applyHoverShadow(rowBounds.element, position);
        }
    }

    /*
     * ------------------------------------------------------------
     *  PRIVATE INITIALIZATION METHODS
     * -------------------------------------------------------------
     */

    _initializeEventHandlers() {
        // Bind handlers once
        this._mouseMoveHandler = this._handleMouseMove.bind(this);
        this._mouseUpHandler = this._handleMouseUp.bind(this);
        this._mouseDownHandler = this._handleMouseDown.bind(this);
    }

    _updateSpinnerHeight() {
        if (!this.isLoading) return;

        const spinner = this.template.querySelector(
            'lightning-primitive-datatable-loading-indicator'
        );
        if (spinner) {
            spinner.style.height = SPINNER_HEIGHT;
        }
    }

    _setupScrollListener() {
        const scrollerY = this.scrollerY;
        if (!scrollerY || this._scrollHandler) return;

        this._debouncedScrollHandler = this._debounce(
            this._handleScroll.bind(this),
            SCROLL_DEBOUNCE_DELAY
        );
        scrollerY.addEventListener('scroll', this._debouncedScrollHandler, { passive: true });
        this._scrollHandler = true;
    }

    /**
     * OPTIMIZED: Uses event delegation instead of individual listeners per row
     * Reduces from 216 listeners to 1 listener on tbody
     */
    _setupDragAndDrop() {
        if (!this.orderable || this._dragDelegateAttached) return;

        const tbody = this.template.querySelector('tbody');
        if (!tbody) return;

        // Single event listener on tbody instead of one per row
        tbody.addEventListener('mousedown', this._mouseDownHandler);
        this._dragDelegateAttached = true;
    }

    _cleanupEventListeners() {
        // Clean up scroll listener
        if (this._debouncedScrollHandler) {
            const scrollerY = this.scrollerY;
            if (scrollerY) {
                scrollerY.removeEventListener(
                    'scroll',
                    this._debouncedScrollHandler
                );
            }
            this._scrollHandler = null;
            this._debouncedScrollHandler = null;
        }

        // Clean up drag listener (single tbody listener)
        if (this._dragDelegateAttached) {
            const tbody = this.template.querySelector('tbody');
            if (tbody) {
                tbody.removeEventListener('mousedown', this._mouseDownHandler);
            }
            this._dragDelegateAttached = false;
        }

        // Clean up drag state
        this._cleanupDragState();
    }

    /*
     * ------------------------------------------------------------
     *  PRIVATE UTILITY METHODS
     * -------------------------------------------------------------
     */

    _debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    getBulkSelectionState(selected) {
        const total = this.maxRowSelection || this.state.rows.length;
        if (selected === 0) return 'none';
        if (selected === total) return 'all';
        return 'some';
    }

    updateBulkSelectionState(selected) {
        const selectBoxesColumnIndex = this.state.columns.findIndex(
            (column) => column.type === 'SELECTABLE_CHECKBOX'
        );

        if (selectBoxesColumnIndex >= 0) {
            this.state.columns[selectBoxesColumnIndex] = {
                ...this.state.columns[selectBoxesColumnIndex],
                bulkSelection: this.getBulkSelectionState(selected)
            };
        }
    }

    /**
     * OPTIMIZED: Uses CSS classes instead of inline styles
     * Only queries the specific rows that need highlighting
     */
    _applyHighlightedRows() {
        if (!this._highlightedRows.length) {
            // Clear all highlights if no rows should be highlighted
            const highlightedRows =
                this.template.querySelectorAll('.row-highlighted');
            highlightedRows.forEach((row) =>
                row.classList.remove('row-highlighted')
            );
            return;
        }

        // Remove old highlights
        const previouslyHighlighted =
            this.template.querySelectorAll('.row-highlighted');
        previouslyHighlighted.forEach((row) => {
            if (!this._highlightedRows.includes(row.dataset.rowKeyValue)) {
                row.classList.remove('row-highlighted');
            }
        });

        // Add new highlights - only query the rows we need
        this._highlightedRows.forEach((rowKey) => {
            const row = this.template.querySelector(
                `tr[data-row-key-value="${rowKey}"]`
            );
            if (row && !row.classList.contains('row-highlighted')) {
                row.classList.add('row-highlighted');
            }
        });
    }

    /*
     * ------------------------------------------------------------
     *  EVENT HANDLERS
     * -------------------------------------------------------------
     */

    handleEditCell = (event) => {
        event.stopPropagation();
        const { colKeyValue, rowKeyValue, value } = event.detail;
        const dirtyValues = this.state.inlineEdit.dirtyValues;

        if (!dirtyValues[rowKeyValue]) {
            dirtyValues[rowKeyValue] = {};
        }

        dirtyValues[rowKeyValue][colKeyValue] = value;

        if (
            value !== this.state.inlineEdit.editedValue ||
            this.state.inlineEdit.massEditEnabled
        ) {
            super.updateRowsState(this.state);
        }
    };

    _handleScroll(event) {
        // 1. Safety check: Ensure event exists
        if (!event) return;

        // 2. Use currentTarget (the element listening) instead of target (the element that triggered).
        // If both are missing (edge case), fall back to querying the scroller directly.
        const target = event.currentTarget || event.target || this.scrollerY;

        // 3. Safety check: Ensure we actually have an element to measure
        if (!target) return;

        // 4. Calculate logic
        // Use Optional Chaining (?.) just in case target exists but properties are 0/null
        const scrollTop = target.scrollTop || 0;
        const scrollHeight = target.scrollHeight || 0;
        const clientHeight = target.clientHeight || 0;

        // Avoid division by zero if height is 0
        const maxScroll = scrollHeight - clientHeight;
        const scrollPercentage = maxScroll > 0 ? scrollTop / maxScroll : 0;

        this.applyMethod({
            methodName: 'handleScroll',
            scrollTop: scrollTop,
            scrollHeight: scrollHeight,
            clientHeight: clientHeight,
            scrollPercentage: scrollPercentage
        });
    }

    handleDispatchEvents(event) {
        event.stopPropagation();
        this.dispatchEvent(
            new CustomEvent(event.detail.type, {
                detail: event.detail.detail,
                bubbles: event.detail.bubbles,
                composed: event.detail.composed,
                cancelable: event.detail.cancelable
            })
        );
    }

    /*
     * ------------------------------------------------------------
     *  DRAG AND DROP HANDLERS
     * -------------------------------------------------------------
     */

    /**
     * OPTIMIZED: Now uses event delegation - finds the row from event target
     */
    _handleMouseDown(event) {
        // Only handle left mouse button
        if (event.button !== 0 || !this.orderable) return;

        // Find the row using event delegation
        const dragRow = event.target.closest('tr[data-row-key-value]');
        if (!dragRow) return;

        const target = event.target;
        const cellFactory = target.closest('lightning-primitive-cell-factory');
        const cellCheckbox = target.closest(
            'lightning-primitive-cell-checkbox'
        );

        // Don't interfere with cell actions or checkboxes
        if (cellFactory || cellCheckbox) return;

        event.stopPropagation();
        event.preventDefault();

        this._clearDragTimeout();
        window.addEventListener('mouseup', this._mouseUpHandler);

        // Reduced delay for better UX
        this._mouseDownTimeout = setTimeout(() => {
            this._initializeDragState(event, dragRow);
        }, DRAG_START_DELAY);
    }

    _initializeDragState(event, dragRow) {
        const rowKey = dragRow.dataset.rowKeyValue;

        this._dragState = {
            clientY: event.clientY,
            hoveredKey: rowKey,
            currentPosition: null,
            currentTargetRowKey: null
        };

        this._applySourceRowOpacity(rowKey);
        window.addEventListener('mousemove', this._mouseMoveHandler);

        if (this.applyMethod) {
            this.applyMethod({
                methodName: 'handleReorderStart',
                sourceRowKey: rowKey
            });
        }
    }

    _handleMouseMove = (event) => {
        if (!this._dragState || !this.orderable) return;
        event.preventDefault();

        const mouseY = event.clientY;

        // Lazy-load row bounds only when needed
        if (!this._rowBoundsMap.size) {
            this._captureAllRowBounds();
        }

        const { targetRowKey, position } = this._findTargetRow(mouseY);

        // Only dispatch if something changed
        if (this._hasTargetChanged(targetRowKey, position)) {
            this._updateDragState(targetRowKey, position);
        }
    };

    _findTargetRow(mouseY) {
        for (const [rowKey, bounds] of this._rowBoundsMap) {
            if (mouseY >= bounds.top && mouseY <= bounds.bottom) {
                // Don't target the dragged row itself
                if (rowKey === this._dragState.hoveredKey) {
                    return { targetRowKey: null, position: null };
                }

                const position = this._calculatePosition(mouseY, bounds);
                return { targetRowKey: rowKey, position };
            }
        }
        return { targetRowKey: null, position: null };
    }

    _calculatePosition(mouseY, bounds) {
        const offsetY = mouseY - bounds.top;
        const relativePosition = offsetY / bounds.height;

        if (relativePosition < POSITION_THRESHOLDS.TOP) return 'top';
        if (relativePosition < POSITION_THRESHOLDS.BOTTOM) return 'middle';
        return 'bottom';
    }

    _hasTargetChanged(targetRowKey, position) {
        return (
            targetRowKey !== this._dragState.currentTargetRowKey ||
            position !== this._dragState.currentPosition
        );
    }

    _updateDragState(targetRowKey, position) {
        this._dragState.currentTargetRowKey = targetRowKey;
        this._dragState.currentPosition = position;

        if (this.applyMethod) {
            this.applyMethod({
                methodName: 'handleReorderMove',
                sourceRowKey: this._dragState.hoveredKey,
                targetRowKey,
                position
            });
        }
    }

    _handleMouseUp = () => {
        this._clearDragTimeout();

        if (!this._dragState || !this.orderable) {
            this._cleanupDragState();
            return;
        }

        if (this.applyMethod) {
            this.applyMethod({
                methodName: 'handleReorderEnd',
                sourceRowKey: this._dragState.hoveredKey,
                targetRowKey: this._dragState.currentTargetRowKey,
                position: this._dragState.currentPosition
            });
        }

        this._cleanupDragState();
    };

    _clearDragTimeout() {
        if (this._mouseDownTimeout) {
            clearTimeout(this._mouseDownTimeout);
            this._mouseDownTimeout = null;
        }
    }

    _cleanupDragState() {
        window.removeEventListener('mousemove', this._mouseMoveHandler);
        window.removeEventListener('mouseup', this._mouseUpHandler);

        this._clearAllRowBorders();
        this._clearSourceRowOpacity();
        this._rowBoundsMap.clear();
        this._dragState = null;
    }

    _captureAllRowBounds() {
        this._rowBoundsMap.clear();
        const allRows = this.template.querySelectorAll(
            'tr[data-row-key-value]'
        );

        allRows.forEach((row) => {
            const rowKey = row.dataset.rowKeyValue;
            const rect = row.getBoundingClientRect();
            this._rowBoundsMap.set(rowKey, {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
                element: row
            });
        });
    }

    /*
     * ------------------------------------------------------------
     *  VISUAL FEEDBACK METHODS
     * -------------------------------------------------------------
     */

    _applySourceRowOpacity(sourceRowKey) {
        this._clearSourceRowOpacity();
        if (!sourceRowKey) return;

        const sourceRow = this.template.querySelector(
            `tr[data-row-key-value="${sourceRowKey}"]`
        );
        if (sourceRow) {
            sourceRow.style.opacity = DRAG_STYLES.SOURCE_OPACITY;
            sourceRow.classList.add('drag-source-row');
        }
    }

    _clearSourceRowOpacity() {
        const dragSourceRows =
            this.template.querySelectorAll('.drag-source-row');
        dragSourceRows.forEach((row) => {
            row.style.opacity = '';
            row.classList.remove('drag-source-row');
        });
    }

    _clearRowBorder(rowKey) {
        if (!rowKey) return;

        const rowBounds = this._rowBoundsMap.get(rowKey);
        if (rowBounds?.element) {
            this._applyHoverShadow(rowBounds.element, null);
        }
    }

    _clearAllRowBorders() {
        this._rowBoundsMap.forEach((bounds) => {
            this._applyHoverShadow(bounds.element, null);
        });
    }

    _applyHoverShadow(row, position) {
        if (!row) return;

        const cells = row.querySelectorAll('td, th');

        if (!position) {
            // Clear styles
            cells.forEach((cell) => {
                cell.style.boxShadow = '';
                cell.style.backgroundColor = '';
            });
            return;
        }

        const styles = this._getPositionStyles(position);
        cells.forEach((cell) => {
            Object.assign(cell.style, styles);
        });
    }

    _getPositionStyles(position) {
        const baseStyles = { boxShadow: '', backgroundColor: '' };

        switch (position) {
            case 'top':
                return {
                    boxShadow: `inset 0px ${DRAG_STYLES.BORDER_SIZE} 0px 0px ${DRAG_STYLES.BORDER_COLOR}`,
                    backgroundColor: DRAG_STYLES.HOVER_LIGHT
                };
            case 'middle':
                return {
                    backgroundColor: DRAG_STYLES.HOVER_COLOR
                };
            case 'bottom':
                return {
                    boxShadow: `inset 0px -${DRAG_STYLES.BORDER_SIZE} 0px 0px ${DRAG_STYLES.BORDER_COLOR}`,
                    backgroundColor: DRAG_STYLES.HOVER_LIGHT
                };
            default:
                return baseStyles;
        }
    }
}
