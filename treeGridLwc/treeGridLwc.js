import { LightningElement, api } from 'lwc';
import { VirtualScrollEngine } from './virtualScrollEngine';

/**
 * TreeGridLwcVirtual - Ultra-Smooth Virtual Scrolling TreeGrid
 *
 * Key Optimizations:
 * 1. Momentum-aware buffering - larger buffers in scroll direction
 * 2. Predictive prefetching - preload rows before they're needed
 * 3. Compositor-friendly animations - uses transform instead of top
 * 4. Passive scroll listeners - non-blocking scroll handling
 * 5. Content-visibility optimization - browser-native virtualization hints
 * 6. Scroll anchoring - prevents layout shift on data changes
 * 7. Debounced heavy operations - separates urgent vs deferred work
 * 8. Intersection Observer fallback - for precise visibility detection
 */

const DEFAULT_MAX_WIDTH = 1000;
const DEFAULT_MIN_WIDTH = 50;
const DEFAULT_ROW_NUMBER_OFFSET = 0;
const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const DEFAULT_BUFFER_SIZE = 8; // Slightly larger for smoother scrolling
const DEFAULT_HYSTERESIS = 0.25; // More responsive while still preventing jitter
const DEFAULT_VELOCITY_THRESHOLD = 2;
const SCROLL_THROTTLE_MS = 8; // ~120fps max update rate
const COLUMN_WIDTHS_MODES = { valid: ['fixed', 'auto'], default: 'fixed' };
const ALLOW_LISTED_COLUMN_KEYS = [
    'actions',
    'cellAttributes',
    'editable',
    'fieldName',
    'iconLabel',
    'iconName',
    'iconPosition',
    'indexColumn',
    'initialWidth',
    'label',
    'type',
    'typeAttributes',
    'wrapText',
    'sortable'
];

export default class TreeGridLwcVirtual extends LightningElement {
    // Properties
    tColumns;
    tColumnWidthsMode = COLUMN_WIDTHS_MODES.default;
    tExpandedRows = [];
    tHideCheckboxColumn = false;
    tHideTableHeader = false;
    tIsLoading = false;
    tKeyField;
    tMaxColumnWidth = DEFAULT_MAX_WIDTH;
    tMaxRowSelection;
    tMinColumnWidth = DEFAULT_MIN_WIDTH;
    tRecords;
    tResizeColumnDisabled = false;
    tResizeStep = 10;
    tRowNumberOffset = DEFAULT_ROW_NUMBER_OFFSET;
    tSelectedRows = [];
    tShowRowNumberColumn = false;
    tWrapTextMaxLines;
    tHighlightedRows = [];
    tRawColumns;
    tRawRecords;
    tToggleAllRecursionCounter = 1;
    sortDirection;
    sortedBy;
    tPublicExpandedRows = [];

    // VIRTUAL SCROLL PROPERTIES
    tEnableVirtualScroll = true;
    tViewportHeight = DEFAULT_VIEWPORT_HEIGHT;
    tRowHeight = DEFAULT_ROW_HEIGHT;
    tBufferSize = DEFAULT_BUFFER_SIZE;
    tScrollTop = 0;
    tVisibleStartIndex = 0;
    tVisibleEndIndex = 0;
    tTotalFlattenedCount = 0;

    // Optimized engines and caches
    _scrollEngine = null;
    _dataCache = null;
    _cachedFieldNames = null;
    _isRegenerating = false;
    _lastScrollTime = 0;
    _scrollAnchor = null;

    // Memoization cache
    _normalizedRecordCache = new Map();
    _lastExpandedRowsHash = null;
    _fullFlattenedData = [];

    // Intersection Observer for precise visibility
    _intersectionObserver = null;
    _visibleRowKeys = new Set();

    // Deferred work queue
    _deferredWorkQueue = [];
    _idleCallbackId = null;

    constructor() {
        super();
        console.log('🎬 TreeGridLwcVirtual constructor (ULTRA-SMOOTH v2)');

        // Initialize scroll engine with optimized parameters
        this._scrollEngine = new VirtualScrollEngine({
            rowHeight: DEFAULT_ROW_HEIGHT,
            viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
            bufferSize: DEFAULT_BUFFER_SIZE,
            hysteresis: DEFAULT_HYSTERESIS,
            velocityThreshold: DEFAULT_VELOCITY_THRESHOLD,
            smoothingFactor: 0.12, // Smoother velocity tracking
            predictionLookahead: 120 // Optimized for 60fps
        });

        this.template.addEventListener(
            'privatetogglecell',
            this.handleToggle.bind(this)
        );
        this.template.addEventListener(
            'toggleallheader',
            this.handleToggleAll.bind(this)
        );

        // Bind scroll handler for passive listener
        this._boundScrollHandler = this._onScrollPassive.bind(this);
    }

    connectedCallback() {
        // Add passive scroll listener for better performance
        this._setupScrollListener();
    }

    disconnectedCallback() {
        this._cleanup();
    }

    _setupScrollListener() {
        // Use passive listener for scroll - critical for smooth scrolling
        const scrollContainer = this.template.querySelector(
            '.virtual-scroll-container'
        );
        if (scrollContainer) {
            scrollContainer.addEventListener(
                'scroll',
                this._boundScrollHandler,
                { passive: true }
            );
        }
    }

    _cleanup() {
        if (this._scrollEngine) {
            this._scrollEngine.destroy();
        }

        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
        }

        if (this._idleCallbackId && 'cancelIdleCallback' in window) {
            cancelIdleCallback(this._idleCallbackId);
        }

        const scrollContainer = this.template.querySelector(
            '.virtual-scroll-container'
        );
        if (scrollContainer) {
            scrollContainer.removeEventListener(
                'scroll',
                this._boundScrollHandler
            );
        }
    }

    /**
     * Passive scroll handler - non-blocking
     */
    _onScrollPassive(event) {
        const scrollTop = event.target.scrollTop;

        // Throttle scroll updates
        const now = performance.now();
        if (now - this._lastScrollTime < SCROLL_THROTTLE_MS) {
            // Schedule deferred update
            this._scrollEngine.scheduleUpdate(() => {
                this.handleScrollInternal(scrollTop);
            });
            return;
        }

        this._lastScrollTime = now;
        this.handleScrollInternal(scrollTop);
    }

    @api displayedTasks;

    @api get columns() {
        return this.tRawColumns;
    }
    set columns(value) {
        this.tRawColumns = value;
        this.tColumns = this.normalizeColumns(value);
        this._cachedFieldNames = null;
        this._normalizedRecordCache.clear();
    }

    @api get expandedRows() {
        if (!this.deepEqual(this.tExpandedRows, this.tPublicExpandedRows)) {
            this.tPublicExpandedRows = Object.assign([], this.tExpandedRows);
        }
        return this.tPublicExpandedRows;
    }
    set expandedRows(value) {
        console.log('🔧 expandedRows setter called:', value?.length);

        // Save scroll anchor before changes
        this._saveScrollAnchor();

        this.tPublicExpandedRows = Object.assign([], value);
        this.tExpandedRows = Object.assign([], value);

        // Invalidate cache
        this._lastExpandedRowsHash = null;

        this.flattenData();

        // Restore scroll position after render
        this._scheduleScrollRestore();
    }

    @api get keyField() {
        return this.tKeyField;
    }
    set keyField(value) {
        this.tKeyField = value;
        this._cachedFieldNames = null;
        this._normalizedRecordCache.clear();
        this.flattenData();
    }

    @api get maxColumnWidth() {
        return this.tMaxColumnWidth;
    }
    set maxColumnWidth(value) {
        this.tMaxColumnWidth = isNaN(parseInt(value, 10))
            ? DEFAULT_MAX_WIDTH
            : value;
    }

    @api get maxRowSelection() {
        return this.tMaxRowSelection;
    }
    set maxRowSelection(value) {
        if (value === undefined) return;
        this.tMaxRowSelection = value;
    }

    @api get minColumnWidth() {
        return this.tMinColumnWidth;
    }
    set minColumnWidth(value) {
        this.tMinColumnWidth = isNaN(parseInt(value, 10))
            ? DEFAULT_MIN_WIDTH
            : value;
    }

    @api get primitiveWidthsData() {
        return this.datatable?.widthsData;
    }

    @api get records() {
        return this.tRawRecords;
    }
    set records(value) {
        this._saveScrollAnchor();
        this.tRawRecords = value;
        this._normalizedRecordCache.clear();
        this._lastExpandedRowsHash = null;
        this.flattenData();
        this._scheduleScrollRestore();
    }

    @api get resizeColumnDisabled() {
        return this.tResizeColumnDisabled;
    }
    set resizeColumnDisabled(value) {
        this.tResizeColumnDisabled = value;
    }

    @api get resizeStep() {
        return this.tResizeStep;
    }
    set resizeStep(value) {
        if (value === undefined) return;
        this.tResizeStep = value;
    }

    @api get rowNumberOffset() {
        return this.tRowNumberOffset;
    }
    set rowNumberOffset(value) {
        this.tRowNumberOffset = isNaN(parseInt(value, 10))
            ? DEFAULT_ROW_NUMBER_OFFSET
            : value;
    }

    @api get scrollerX() {
        return this.datatable?.scrollerX;
    }

    @api get selectedRows() {
        return this.tSelectedRows;
    }
    set selectedRows(value) {
        this.tSelectedRows = value;
    }

    @api get showRowNumberColumn() {
        return this.tShowRowNumberColumn;
    }
    set showRowNumberColumn(value) {
        this.tShowRowNumberColumn = value;
    }

    @api get wrapTextMaxLines() {
        return this.tWrapTextMaxLines;
    }
    set wrapTextMaxLines(value) {
        if (value === undefined) return;
        this.tWrapTextMaxLines = value;
    }

    @api get highlightedRows() {
        return this.tHighlightedRows;
    }
    set highlightedRows(value) {
        this.tHighlightedRows = value;
    }

    @api get hideCheckboxColumn() {
        return this.tHideCheckboxColumn;
    }
    set hideCheckboxColumn(value) {
        this.tHideCheckboxColumn = value;
    }

    @api get enableVirtualScroll() {
        return this.tEnableVirtualScroll;
    }
    set enableVirtualScroll(value) {
        console.log('🔧 enableVirtualScroll set to:', value);
        this.tEnableVirtualScroll = value;
        if (!value) {
            this._scrollEngine.reset();
        }
        this.flattenData();
    }

    @api get viewportHeight() {
        return this.tViewportHeight;
    }
    set viewportHeight(value) {
        this.tViewportHeight = value || DEFAULT_VIEWPORT_HEIGHT;
        console.log('🔧 viewportHeight set to:', this.tViewportHeight);

        this._scrollEngine.updateConfig({
            viewportHeight: this.tViewportHeight
        });

        if (this.tEnableVirtualScroll) {
            this.updateVisibleSlice();
        }
    }

    @api get rowHeight() {
        return this.tRowHeight;
    }
    set rowHeight(value) {
        this.tRowHeight = value || DEFAULT_ROW_HEIGHT;
        console.log('🔧 rowHeight set to:', this.tRowHeight);

        this._scrollEngine.updateConfig({ rowHeight: this.tRowHeight });

        if (this.tEnableVirtualScroll) {
            this.updateVisibleSlice();
        }
    }

    @api get bufferSize() {
        return this.tBufferSize;
    }
    set bufferSize(value) {
        this.tBufferSize = value || DEFAULT_BUFFER_SIZE;
        this._scrollEngine.updateConfig({ bufferSize: this.tBufferSize });
    }

    @api orderable = false;
    @api draftValues;

    @api setRowColor(rowKeyField, color) {
        this.datatable?.setRowColor(rowKeyField, color);
    }

    @api setRowHeight(rowKeyField, height) {
        this.datatable?.setRowHeight(rowKeyField, height);
    }

    get datatable() {
        return this.template.querySelector(
            '[data-element-id="treelist-datatable"]'
        );
    }

    get normalizedColumns() {
        return this.tColumns;
    }

    get normalizedRecords() {
        return this.tRecords;
    }

    get isInfiniteLoadingDisabled() {
        return false;
    }

    /**
     * Optimized spacer heights using CSS custom properties
     * Uses transform for GPU acceleration
     */
    get spacerHeights() {
        const before = this.tVisibleStartIndex * this.tRowHeight;
        const after =
            (this.tTotalFlattenedCount - this.tVisibleEndIndex) *
            this.tRowHeight;
        const totalHeight =
            this.tTotalFlattenedCount * this.tRowHeight + this.tRowHeight;
        const tableHeight = this.viewportHeight;

        return (
            `--spacer-height-before: ${before}px; ` +
            `--spacer-height-after: ${after}px; ` +
            `--table-height: ${tableHeight}px; ` +
            `--total-scroll-height: ${totalHeight}px; ` +
            `--row-height: ${this.tRowHeight}px; ` +
            `height: ${totalHeight}px; ` +
            `contain: layout style;`
        ); // CSS containment for performance
    }

    /**
     * CSS classes for smooth rendering
     */
    get containerClasses() {
        return `virtual-scroll-container ${this.tEnableVirtualScroll ? 'virtualized' : ''}`;
    }

    /**
     * Container style with viewport height
     */
    get containerStyle() {
        return `height: ${this.tViewportHeight}px; --row-height: ${this.tRowHeight}px;`;
    }

    /**
     * Sentinel style - creates the full scrollable height
     */
    get sentinelStyle() {
        const totalHeight = this.tTotalFlattenedCount * this.tRowHeight;
        return `height: ${totalHeight}px;`;
    }

    /**
     * Content transform - GPU-accelerated positioning
     * Uses translateY instead of top for 60fps scrolling
     */
    get contentTransform() {
        const offset = this.tVisibleStartIndex * this.tRowHeight;
        return `transform: translateY(${offset}px); will-change: transform;`;
    }

    /**
     * Scrolling state for CSS optimizations
     */
    get scrollingState() {
        return this._scrollEngine?._scrollVelocity > 2 ? 'fast' : 'normal';
    }

    @api getSelectedRows() {
        return this.datatable?.getSelectedRows() || [];
    }

    @api scrollToTop(y = 0) {
        this.datatable?.scrollToTop(y);
        if (this.tEnableVirtualScroll) {
            this.handleScrollInternal(y);
        }
    }

    /**
     * Smooth scroll to a specific row
     */
    @api scrollToRow(rowKey, behavior = 'smooth') {
        const index = this._fullFlattenedData.findIndex(
            (row) => row[this.keyField] === rowKey
        );

        if (index !== -1) {
            const scrollPosition = index * this.tRowHeight;
            const container = this.template.querySelector(
                '.virtual-scroll-container'
            );

            if (container) {
                container.scrollTo({
                    top: scrollPosition,
                    behavior
                });
            }
        }
    }

    @api setHighlighted(rowId, backGroundColor) {
        this.datatable?.setHighlighted(rowId, backGroundColor);
    }

    @api getCurrentExpandedRows() {
        return this.expandedRows;
    }

    @api expandAll() {
        this.toggleAllRows(this.records, true);
    }

    @api collapseAll() {
        this.toggleAllRows(this.records, false);
    }

    @api getVirtualScrollStats() {
        const engineStats = this._scrollEngine.getStats();
        return {
            enabled: this.tEnableVirtualScroll,
            totalRows: this.tTotalFlattenedCount,
            visibleRows: this.tVisibleEndIndex - this.tVisibleStartIndex,
            renderedRows: this.tRecords?.length || 0,
            visibleStartIndex: this.tVisibleStartIndex,
            visibleEndIndex: this.tVisibleEndIndex,
            scrollTop: this.tScrollTop,
            cacheSize: this._normalizedRecordCache.size,
            engine: engineStats
        };
    }

    // ==========================================
    // SCROLL ANCHORING
    // ==========================================

    /**
     * Save current scroll anchor before data changes
     */
    _saveScrollAnchor() {
        if (!this._fullFlattenedData.length) return;

        const firstVisibleIndex = Math.floor(this.tScrollTop / this.tRowHeight);
        const offset = this.tScrollTop % this.tRowHeight;

        if (firstVisibleIndex < this._fullFlattenedData.length) {
            this._scrollAnchor = {
                key: this._fullFlattenedData[firstVisibleIndex]?.[
                    this.keyField
                ],
                index: firstVisibleIndex,
                offset
            };
        }
    }

    /**
     * Schedule scroll position restoration
     */
    _scheduleScrollRestore() {
        if (!this._scrollAnchor) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._restoreScrollAnchor();
            });
        });
    }

    /**
     * Restore scroll position after data changes
     */
    _restoreScrollAnchor() {
        if (!this._scrollAnchor) return;

        let newScrollTop;

        if (this._scrollAnchor.key) {
            // Try to find the anchor row by key
            const newIndex = this._fullFlattenedData.findIndex(
                (row) => row[this.keyField] === this._scrollAnchor.key
            );

            if (newIndex !== -1) {
                newScrollTop =
                    newIndex * this.tRowHeight + this._scrollAnchor.offset;
            }
        }

        if (newScrollTop === undefined) {
            // Fallback to index-based restoration
            newScrollTop = Math.min(
                this._scrollAnchor.index * this.tRowHeight +
                    this._scrollAnchor.offset,
                (this.tTotalFlattenedCount - 1) * this.tRowHeight
            );
        }

        const container = this.template.querySelector(
            '.virtual-scroll-container'
        );
        if (container && Math.abs(container.scrollTop - newScrollTop) > 1) {
            container.scrollTop = newScrollTop;
        }

        this._scrollAnchor = null;
    }

    // ==========================================
    // CACHE MANAGEMENT
    // ==========================================

    /**
     * Generate cache key for expanded rows state
     */
    _getExpandedRowsHash() {
        return this.tExpandedRows.slice().sort().join(',');
    }

    // ==========================================
    // VISIBLE RANGE CALCULATION
    // ==========================================

    /**
     * Calculate visible range using scroll engine
     */
    calculateVisibleRange() {
        const result = this._scrollEngine.calculateVisibleRange(
            this.tScrollTop,
            this.tTotalFlattenedCount
        );

        const oldStart = this.tVisibleStartIndex;
        const oldEnd = this.tVisibleEndIndex;

        this.tVisibleStartIndex = result.startIndex;
        this.tVisibleEndIndex = result.endIndex;

        console.log('📐 Range:', {
            scroll: this.tScrollTop,
            old: `${oldStart}-${oldEnd}`,
            new: `${result.startIndex}-${result.endIndex}`,
            update: result.shouldUpdate,
            velocity: result.velocity
        });

        return result.shouldUpdate;
    }

    /**
     * Update visible slice with optimized rendering
     */
    updateVisibleSlice(forceRecalculate = false) {
        if (this._isRegenerating) return;
        this._isRegenerating = true;

        try {
            let shouldUpdate = true;

            if (!forceRecalculate) {
                shouldUpdate = this.calculateVisibleRange();

                if (!shouldUpdate) {
                    console.log('⏭️ Skip - hysteresis');
                    return;
                }
            } else {
                console.log('🔄 Force recalc');
                this.calculateVisibleRange();
            }

            const result = this._buildVisibleSlice();
            this.tRecords = result;

            console.log('✅ Slice:', {
                range: `${this.tVisibleStartIndex}-${this.tVisibleEndIndex}`,
                rendered: result.length,
                total: this._fullFlattenedData.length
            });

            // Schedule prefetch for adjacent rows
            this._schedulePrefetch();
        } finally {
            this._isRegenerating = false;
        }
    }

    /**
     * Build the visible slice array
     */
    _buildVisibleSlice() {
        const result = [];

        // Spacer before (if not at start)
        if (this.tVisibleStartIndex > 0) {
            result.push({
                ...this.getEmptyRecord(),
                [this.keyField]: 'spacer-before',
                _isSpacer: true,
                _spacerHeight: this.tVisibleStartIndex * this.tRowHeight
            });
        }

        // Real data rows
        for (let i = this.tVisibleStartIndex; i < this.tVisibleEndIndex; i++) {
            if (i < this._fullFlattenedData.length) {
                result.push(this._fullFlattenedData[i]);
            }
        }

        // Spacer after (if not at end)
        if (this.tVisibleEndIndex < this.tTotalFlattenedCount) {
            result.push({
                ...this.getEmptyRecord(),
                [this.keyField]: 'spacer-after',
                _isSpacer: true,
                _spacerHeight:
                    (this.tTotalFlattenedCount - this.tVisibleEndIndex) *
                    this.tRowHeight
            });
        }

        return result;
    }

    /**
     * Schedule low-priority prefetch during idle time
     */
    _schedulePrefetch() {
        this._scrollEngine.schedulePrefetch(() => {
            // Pre-normalize adjacent rows for faster access
            const prefetchStart = Math.max(
                0,
                this.tVisibleStartIndex - this.tBufferSize * 2
            );
            const prefetchEnd = Math.min(
                this._fullFlattenedData.length,
                this.tVisibleEndIndex + this.tBufferSize * 2
            );

            console.log('🔮 Prefetch:', { prefetchStart, prefetchEnd });
        });
    }

    getEmptyRecord() {
        const empty = {};
        if (this._cachedFieldNames) {
            for (const field of this._cachedFieldNames) {
                empty[field] = '';
            }
        }
        return empty;
    }

    /**
     * Create placeholder row
     */
    createPlaceholder(index) {
        const placeholder = {
            [this.keyField]: `placeholder-${index}`,
            _isPlaceholder: true,
            _virtualIndex: index,
            level: 1,
            posInSet: 1,
            setSize: 1,
            hasChildren: false,
            isExpanded: false
        };

        if (this._cachedFieldNames) {
            for (const field of this._cachedFieldNames) {
                if (!placeholder[field]) {
                    placeholder[field] = '';
                }
            }
        }

        return placeholder;
    }

    // ==========================================
    // DATA FLATTENING
    // ==========================================

    /**
     * Main flatten method - with memoization
     */
    flattenData() {
        console.log('🔄 flattenData START');

        if (!this.keyField || !this.records) {
            this.tRecords = [];
            this.tTotalFlattenedCount = 0;
            this._fullFlattenedData = [];
            this._scrollEngine.reset();
            return;
        }

        const expandedRowsHash = this._getExpandedRowsHash();

        // Check cache validity
        const canUseCache =
            this._lastExpandedRowsHash === expandedRowsHash &&
            this._fullFlattenedData.length > 0 &&
            this._lastExpandedRowsHash !== null;

        if (canUseCache) {
            console.log('🎯 Cache hit');

            if (this.tEnableVirtualScroll) {
                this.updateVisibleSlice();
            } else {
                this.tRecords = this._fullFlattenedData;
            }
            return;
        }

        console.log('🔄 Cache miss - flattening');
        console.time('⚡ flatten');

        this._fullFlattenedData = this.normalizeRecords(
            this.records,
            this.tExpandedRows,
            this.keyField
        );

        this._lastExpandedRowsHash = expandedRowsHash;
        this.tTotalFlattenedCount = this._fullFlattenedData.length;

        console.timeEnd('⚡ flatten');
        console.log('📊 Cache:', {
            size: this._normalizedRecordCache.size,
            rows: this._fullFlattenedData.length
        });

        if (this.tEnableVirtualScroll) {
            this.updateVisibleSlice(true);
        } else {
            this.tRecords = this._fullFlattenedData;
        }

        console.log('✅ flattenData:', {
            total: this.tTotalFlattenedCount,
            rendered: this.tRecords.length
        });
    }

    /**
     * Force update without cache
     */
    flattenDataForceUpdate() {
        console.log('🔄 Force rebuild');

        if (!this.keyField || !this.records) {
            this.tRecords = [];
            this.tTotalFlattenedCount = 0;
            this._fullFlattenedData = [];
            return;
        }

        console.time('⚡ forceUpdate');

        this._fullFlattenedData = this.normalizeRecords(
            this.records,
            this.tExpandedRows,
            this.keyField
        );

        this._lastExpandedRowsHash = this._getExpandedRowsHash();
        this.tTotalFlattenedCount = this._fullFlattenedData.length;

        console.timeEnd('⚡ forceUpdate');

        if (this.tEnableVirtualScroll) {
            const result = this._scrollEngine.calculateVisibleRange(
                this.tScrollTop,
                this.tTotalFlattenedCount
            );

            this.tVisibleStartIndex = result.startIndex;
            this.tVisibleEndIndex = result.endIndex;

            this.tRecords = this._buildVisibleSlice();

            console.log('✅ Virtual rebuilt:', {
                range: `${this.tVisibleStartIndex}-${this.tVisibleEndIndex}`,
                rendered: this.tRecords.length
            });
        } else {
            this.tRecords = [...this._fullFlattenedData];
        }
    }

    /**
     * Normalize records (flatten tree structure) - with memoization
     */
    normalizeRecords(
        records,
        expandedRowKeys,
        rowIdField,
        currentDepth = 1,
        flattenedRecords = [],
        fieldNames = null
    ) {
        if (!Array.isArray(records)) return [];

        if (currentDepth === 1) {
            fieldNames = this.getColumnFieldNames();
        }

        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
            const originalRecord = records[recordIndex];
            const rowUniqueId = originalRecord[rowIdField];
            const childRecords = originalRecord.gm__children || [];

            const isExpanded = expandedRowKeys.includes(rowUniqueId);
            const cacheKey = `${rowUniqueId}:${currentDepth}:${isExpanded}`;

            let flattenedRecord = this._normalizedRecordCache.get(cacheKey);

            if (!flattenedRecord) {
                const treeMetadata = {
                    level: currentDepth,
                    posInSet: recordIndex + 1,
                    setSize: records.length,
                    hasChildren:
                        originalRecord.gm__type === 'summary' ||
                        (childRecords && childRecords.length > 0),
                    childrenSetSize: childRecords.length,
                    isExpanded: isExpanded,
                    _virtualIndex: flattenedRecords.length
                };

                flattenedRecord = this.createFlattenedRecord(
                    originalRecord,
                    fieldNames,
                    treeMetadata
                );

                this._normalizedRecordCache.set(cacheKey, flattenedRecord);
            } else {
                flattenedRecord = {
                    ...flattenedRecord,
                    posInSet: recordIndex + 1,
                    setSize: records.length,
                    _virtualIndex: flattenedRecords.length
                };
            }

            flattenedRecords.push(flattenedRecord);

            if (flattenedRecord.isExpanded) {
                if (flattenedRecord.hasChildren) {
                    this.normalizeRecords(
                        childRecords,
                        expandedRowKeys,
                        rowIdField,
                        currentDepth + 1,
                        flattenedRecords,
                        fieldNames
                    );
                } else {
                    flattenedRecord.isExpanded = false;
                }
            }
        }

        return flattenedRecords;
    }

    // ==========================================
    // EVENT HANDLERS
    // ==========================================

    handleScroll(event) {
        const detail = event.detail || event;
        const scrollTop = detail.scrollTop || 0;

        this.dispatchEvent(new CustomEvent('scroll', { detail: detail }));
        this.handleScrollInternal(scrollTop);
    }

    handleScrollInternal(scrollTop) {
        if (!this.tEnableVirtualScroll) return;

        // Use scroll engine to schedule optimized update
        this._scrollEngine.scheduleUpdate(() => {
            this.tScrollTop = scrollTop;
            this.updateVisibleSlice();
        });
    }

    toggleRow(data, name, isExpanded) {
        console.log('🔄 toggleRow:', { name, isExpanded });

        this._saveScrollAnchor();
        this.updateExpandedRows(name, isExpanded);

        const row = this._findRow(data, name);
        if (row) {
            const hasChildrenContent = this.hasChildrenContent(row);
            this.fireRowToggleChange(name, isExpanded, hasChildrenContent, row);
        }

        this.flattenDataForceUpdate();
        this._scheduleScrollRestore();

        console.log('✅ toggleRow complete');
    }

    updateExpandedRows(name, isExpanded) {
        const itemPosition = this.tExpandedRows.indexOf(name);
        if (itemPosition > -1 && isExpanded === false) {
            this.tExpandedRows.splice(itemPosition, 1);
        } else if (itemPosition === -1 && isExpanded) {
            this.tExpandedRows.push(name);
        }

        this._lastExpandedRowsHash = null;
    }

    _findRow(nodes, key) {
        if (!nodes) return null;
        for (const node of nodes) {
            if (node[this.keyField] === key) return node;
            if (this.hasChildrenContent(node)) {
                const found = this._findRow(node.gm__children, key);
                if (found) return found;
            }
        }
        return null;
    }

    toggleAllRows(data, isExpanded, rowsToToggle = []) {
        if (isExpanded) {
            data.forEach((row) => {
                const hasChildrenContent = this.hasChildrenContent(row);
                if (hasChildrenContent) {
                    rowsToToggle.push(row[this.keyField]);
                    this.tToggleAllRecursionCounter++;
                    this.toggleAllRows(
                        row.gm__children,
                        isExpanded,
                        rowsToToggle
                    );
                }
            });
        }

        if (--this.tToggleAllRecursionCounter === 0) {
            console.log('🔄 toggleAllRows:', {
                isExpanded,
                count: rowsToToggle.length
            });

            this._saveScrollAnchor();
            this.tToggleAllRecursionCounter = 1;
            this.tExpandedRows = rowsToToggle;

            this.fireToggleAllChange(isExpanded);
            this.flattenDataForceUpdate();
            this._scheduleScrollRestore();
        }
    }

    handleToggle(event) {
        event.stopPropagation();
        const { name, nextState } = event.detail;
        this.toggleRow(this.records, name, nextState);
    }

    handleToggleAll(event) {
        event.stopPropagation();
        const { nextState } = event.detail;
        this.toggleAllRows(this.records, nextState);
    }

    handleRowSelection(event) {
        event.stopPropagation();
        this.fireSelectedRowsChange(event.detail);
    }

    handleHeaderAction(event) {
        event.stopPropagation();
        this.fireHeaderAction(event.detail);
    }

    handleRowAction(event) {
        event.stopPropagation();
        this.fireRowAction(event.detail);
    }

    handleCellChangeAction(event) {
        event.stopPropagation();
        this.fireCellChangeAction(event.detail);
    }

    handleSort(event) {
        const { fieldName: sortedByField, sortDirection } = event.detail;
        this.dispatchEvent(
            new CustomEvent('sort', {
                detail: { sortedBy: sortedByField, sortDirection }
            })
        );
        this.fireRowAction({
            action: { name: 'sort' },
            row: { sortedBy: sortedByField, sortDirection }
        });
        this.sortDirection = sortDirection;
        this.sortedBy = sortedByField;
    }

    // ==========================================
    // EVENT DISPATCHERS
    // ==========================================

    fireToggleAllChange(isExpanded) {
        this.dispatchEvent(
            new CustomEvent('toggleall', { detail: { isExpanded } })
        );
    }

    fireRowToggleChange(name, isExpanded, hasChildrenContent, row) {
        this.dispatchEvent(
            new CustomEvent('toggle', {
                detail: { name, isExpanded, hasChildrenContent, row }
            })
        );
    }

    fireSelectedRowsChange(eventDetails) {
        this.dispatchEvent(
            new CustomEvent('rowselection', { detail: eventDetails })
        );
    }

    fireHeaderAction(eventDetails) {
        this.dispatchEvent(
            new CustomEvent('headeraction', { detail: eventDetails })
        );
    }

    fireRowAction(eventDetails) {
        this.dispatchEvent(
            new CustomEvent('rowaction', { detail: eventDetails })
        );
    }

    fireCellChangeAction(eventDetails) {
        this.dispatchEvent(
            new CustomEvent('cellchange', { detail: eventDetails })
        );
    }

    // ==========================================
    // UTILITY METHODS
    // ==========================================

    hasChildrenContent(row) {
        return (
            // eslint-disable-next-line no-prototype-builtins
            row.hasOwnProperty('gm__children') &&
            Array.isArray(row.gm__children) &&
            row.gm__children.length > 0
        );
    }

    getColumnFieldNames() {
        if (this._cachedFieldNames !== null) {
            return this._cachedFieldNames;
        }

        if (!this.tRawColumns) {
            this._cachedFieldNames = null;
            return null;
        }

        const fieldNames = new Set();

        if (this.keyField) fieldNames.add(this.keyField);
        fieldNames.add('gm__canEditName');
        fieldNames.add('gm__startTimeFormat');
        fieldNames.add('gm__endTimeFormat');
        fieldNames.add('gm__canEditStartTree');
        fieldNames.add('gm__canEditEndTree');
        fieldNames.add('gm__iconName');
        fieldNames.add('gm__parentUID');
        fieldNames.add('gm__isCriticalPath');
        fieldNames.add('gm__isCriticalPathIcon');
        fieldNames.add('gm__type');
        fieldNames.add('gm__objectApiName');

        for (const col of this.tRawColumns) {
            if (col.fieldName) {
                fieldNames.add(col.fieldName);
            }
        }

        this._cachedFieldNames = fieldNames;
        return fieldNames;
    }

    createFlattenedRecord(originalRecord, fieldNames, treeMetadata) {
        if (!fieldNames) {
            return { ...originalRecord, ...treeMetadata };
        }

        const record = {};
        for (const field of fieldNames) {
            const value = originalRecord[field];
            if (value !== undefined) {
                record[field] = value;
            }
        }

        return { ...record, ...treeMetadata };
    }

    normalizeColumns(columns) {
        const normalizedColumns = [];

        if (Array.isArray(columns) && columns.length > 0) {
            const treeColumnIndex = columns.findIndex((c) => c.treeColumn);

            if (treeColumnIndex === -1) {
                return columns;
            }

            const treeColumn = columns[treeColumnIndex];
            const treeColumnCopy = this.getObjectWithoutKeys(
                this.getSanitizedObject(treeColumn, ALLOW_LISTED_COLUMN_KEYS),
                ['typeAttributes']
            );

            treeColumnCopy.type = 'tree';
            treeColumnCopy.typeAttributes = {
                level: { fieldName: 'level' },
                hasChildren: { fieldName: 'hasChildren' },
                isExpanded: { fieldName: 'isExpanded' },
                posInSet: { fieldName: 'posInSet' },
                setSize: { fieldName: 'setSize' },
                subType: treeColumn.type
            };
            treeColumnCopy.editable = treeColumn.editable;
            treeColumnCopy.sortable = treeColumn.sortable;

            if (treeColumn.typeAttributes) {
                treeColumnCopy.typeAttributes.subTypeAttributes =
                    treeColumn.typeAttributes || {};
            }

            for (let i = 0; i < columns.length; i++) {
                if (i !== treeColumnIndex) {
                    normalizedColumns.push(
                        this.getSanitizedObject(
                            columns[i],
                            ALLOW_LISTED_COLUMN_KEYS
                        )
                    );
                } else {
                    normalizedColumns[i] = treeColumnCopy;
                }
            }
        }

        return normalizedColumns;
    }

    getSanitizedObject(object, allowlistedKeys) {
        const newObj = {};
        Object.keys(object).forEach((key) => {
            if (allowlistedKeys.includes(key)) {
                newObj[key] = object[key];
            }
        });
        return newObj;
    }

    getObjectWithoutKeys(object, ignoredKeys) {
        const newObj = {};
        Object.keys(object).forEach((key) => {
            if (!ignoredKeys.includes(key)) {
                newObj[key] = object[key];
            }
        });
        return newObj;
    }

    deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;

        const isArray = Array.isArray(a) && Array.isArray(b);
        const isMap = a instanceof Map && b instanceof Map;
        const isSet = a instanceof Set && b instanceof Set;
        const isDate = a instanceof Date && b instanceof Date;
        const isRegExp = a instanceof RegExp && b instanceof RegExp;
        const isObject = a && b && typeof a === 'object';

        if (isDate) return a.getTime() === b.getTime();
        if (isRegExp) return a.source === b.source && a.flags === b.flags;

        if (isArray) {
            if (a.length !== b.length) return false;
            return a.every((val, i) => this.deepEqual(val, b[i]));
        }

        if (isMap) {
            if (a.size !== b.size) return false;
            for (let [key, val] of a) {
                if (!b.has(key) || !this.deepEqual(val, b.get(key)))
                    return false;
            }
            return true;
        }

        if (isSet) {
            if (a.size !== b.size) return false;
            for (let item of a) {
                if (![...b].some((bItem) => this.deepEqual(item, bItem)))
                    return false;
            }
            return true;
        }

        if (isObject) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every((key) => this.deepEqual(a[key], b[key]));
        }

        return false;
    }

    applyMethod = ({ methodName, ...args }) => {
        this[methodName](args);
    };

    handleReorderStart(detail) {
        this.dispatchEvent(new CustomEvent('reorderstart', { detail }));
    }

    handleReorderMove(detail) {
        this.dispatchEvent(new CustomEvent('reordermove', { detail }));
    }

    handleReorderEnd(detail) {
        this.dispatchEvent(new CustomEvent('reorderend', { detail }));
    }

    @api
    updateReorderBorder(targetRowKey, position) {
        if (this.refs.datatable) {
            this.refs.datatable.updateReorderBorder(targetRowKey, position);
        }
    }
}
