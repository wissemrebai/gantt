/* eslint-disable @lwc/lwc/no-async-operation */
import { LightningElement, api } from 'lwc';

import { DateTime } from 'c/dateTimeUtils';
import LOCALE from '@salesforce/i18n/locale';
import TIMEZONE from '@salesforce/i18n/timeZone';

export default class GanttTaskLwc extends LightningElement {
    // ========================================================================
    // API PROPERTIES
    // ========================================================================

    @api taskId;
    @api taskManager;
    @api slotSize;
    @api options = {};

    @api
    get items() {
        return this._items;
    }
    set items(value) {
        this._items = value || [];
    }

    // ========================================================================
    // INTERNAL STATE
    // ========================================================================

    _items = [];
    _color;
    _rowHeight = 40;
    _type;
    _title;
    _expanded = null;

    // Position and display state
    tProgress;
    tLeft;
    tWidth;
    tGrouperHeight;
    tSelected = false;

    // Temporary interaction state
    _tempProgress = null;
    _tempLeft = null;
    _tempWidth = null;

    // Interaction state
    isDragging = false;
    dragStartX = 0;
    isRendered = false;
    isActive = false;
    showPopover = false;
    timeOutHover;
    leftPosition = 0;
    _cellClientRec = { top: 0, height: 0 };
    hover = false;

    // Cached computed data
    _cachedSegments = [];
    _cachedDeadlines = { startPct: 0, endPct: 100 };
    _cachedStartIcon = null;
    _cachedEndIcon = null;
    _cachedBaseline = null;
    _cachedIsMilestone = false;
    _cachedIsSummary = false;
    _cachedIsTask = false;
    _cachedCanEdit = false;
    _cachedCanMove = false;
    _cachedCanResizeStart = false;
    _cachedCanResizeEnd = false;
    _cachedCanDelete = false;
    _cachedCanProgressDrag = false;
    _cachedActiveConstraints = null;
    rules = [];

    baselineStartDate = '';
    baselineEndDate = '';
    showBaselineTooltip = false;
    baselineTooltipStyle = '';

    taskStart;
    taskEnd;

    // ========================================================================
    // PERFORMANCE OPTIMIZATION - CACHED REFERENCES
    // ========================================================================

    _containerRef = null;
    _derivedDataDirty = true;
    _constraintsCacheDirty = true;
    _lastConstraintLeftColor = null;
    _lastConstraintRightColor = null;

    // Style update batching
    _styleUpdateScheduled = false;
    _pendingStyleUpdates = new Set();

    // Calculation batching
    _calculationScheduled = false;

    // Hover throttling
    _lastHoverUpdate = 0;
    _hoverThrottleDelay = 50;

    // ========================================================================
    // CONSTRAINT VISIBILITY RULES
    // ========================================================================

    CONSTRAINT_VISIBILITY_RULES = {
        'end-to-start': {
            SNET: ['start'],
            SNLT: ['start'],
            FNET: ['end'],
            FNLT: ['end'],
            MSO: ['start'],
            MFO: ['end']
        },
        'end-to-end': {
            FNET: ['end'],
            FNLT: ['end'],
            SNET: ['start'],
            SNLT: ['start'],
            MSO: ['start'],
            MFO: ['end']
        },
        'start-to-start': {
            SNET: ['start'],
            SNLT: ['start'],
            FNET: ['end'],
            FNLT: ['end'],
            MSO: ['start'],
            MFO: ['end']
        },
        'start-to-end': {
            SNET: ['start'],
            SNLT: ['start'],
            FNET: ['end'],
            FNLT: ['end'],
            MSO: ['start'],
            MFO: ['end']
        }
    };

    // ========================================================================
    // GETTERS - CACHED CONTAINER REFERENCE
    // ========================================================================

    get container() {
        if (!this._containerRef && this.isRendered) {
            this._containerRef = this.template.querySelector('.container');
        }
        return this._containerRef;
    }

    get record() {
        return this.taskManager.getTaskById(this.taskId);
    }

    // OPTIMIZED: Cache expensive calculation
    get activeConstraints() {
        if (this._constraintsCacheDirty) {
            this._cachedActiveConstraints = this.calculateActiveConstraints();
            this._constraintsCacheDirty = false;
        }
        return this._cachedActiveConstraints;
    }

    get taskSegments() {
        return this._cachedSegments;
    }

    get startConstraintIcon() {
        return this._cachedStartIcon;
    }

    get endConstraintIcon() {
        return this._cachedEndIcon;
    }

    get isValidTask() {
        return this.record && this.record.gm__start && this.record.gm__end;
    }

    get hasValidData() {
        return this.record && this.record.gm__start && this.record.gm__end;
    }

    get isMilestone() {
        return this._cachedIsMilestone;
    }

    get isSummary() {
        return this._cachedIsSummary;
    }

    get isTask() {
        return this._cachedIsTask;
    }

    get expanded() {
        return this._expanded !== null
            ? this._expanded
            : (this.record?.gm__expanded ?? false);
    }

    get showChildren() {
        return this.items.length > 0 && this.expanded;
    }

    get isCritical() {
        return (
            this.options.showCriticalPath === true &&
            this.record?.gm__isCriticalPath === true
        );
    }

    get canEdit() {
        return this._cachedCanEdit;
    }

    get canProgressDrag() {
        return this._cachedCanProgressDrag;
    }

    get hasProgressField() {
        return this.record?.gm__hasProgressField ?? false;
    }

    get hasTooltipProgress() {
        return this.hasProgressField && !this.isMilestone;
    }

    get hasTargetStart() {
        return this._cachedDeadlines.startPct >= 0;
    }

    get hasTargetEnd() {
        return this._cachedDeadlines.endPct >= 0;
    }

    get isBeforeTargetStart() {
        if (!this.hasTargetStart) return false;
        const taskStartPct = this.percentFromDate(this.taskStart);
        return taskStartPct < this._cachedDeadlines.startPct;
    }

    get isAfterTargetEnd() {
        if (!this.hasTargetEnd) return false;
        const taskEndPct = this.percentFromDate(this.taskEnd);
        return taskEndPct > this._cachedDeadlines.endPct;
    }

    get canMove() {
        return this._cachedCanMove;
    }

    get canResizeStart() {
        return this._cachedCanResizeStart;
    }

    get canResizeEnd() {
        return this._cachedCanResizeEnd;
    }

    get canDelete() {
        return this._cachedCanDelete;
    }

    get canAddDependency() {
        return this.canMove;
    }

    get uncommited() {
        return !this.record?.Id || !this.record?.gm__elementId;
    }

    get cellTask() {
        return this.template.querySelector('.task');
    }

    get cellClientRec() {
        return this._cellClientRec;
    }

    get taskTitle() {
        return this._title;
    }

    get showTitleOutside() {
        return this.isMilestone || this.isSummary || this.effectiveWidth < 1000;
    }

    get showGrouperHeight() {
        return this.expanded && (this.tSelected || this.hover);
    }

    get isHovered() {
        return this.hover;
    }

    get effectiveProgress() {
        return this._tempProgress !== null
            ? this._tempProgress
            : (this.tProgress ?? 100);
    }

    get effectiveLeft() {
        return this._tempLeft !== null ? this._tempLeft : (this.tLeft ?? 0);
    }

    get effectiveWidth() {
        return this._tempWidth !== null ? this._tempWidth : (this.tWidth ?? 0);
    }

    get baselineClass() {
        if (!this._cachedBaseline) return [];
        return [
            'baseline-indicator task',
            {
                'task-summary': this.isSummary,
                'task-milestone': this.isMilestone,
                'task-single': this.isTask
            }
        ];
    }

    get childrenClass() {
        return this.showChildren
            ? 'gantt-children'
            : 'gantt-children slds-hide';
    }

    get progressDragClass() {
        const { activeId, type } = this.tActiveInteraction ?? {};
        return [
            'progress_drag',
            {
                active: activeId === this.taskId && type === 'progress',
                hidden: type && type !== 'progress'
            }
        ];
    }

    get startDotClass() {
        return this.taskDotClass(true);
    }

    get endDotClass() {
        return this.taskDotClass(false);
    }

    taskDotClass(isStart) {
        return [
            'task-dot',
            {
                'task-start': isStart,
                'task-end': !isStart,
                hidden:
                    this.tActiveInteraction?.type &&
                    this.tActiveInteraction?.type !== 'dependency'
            }
        ];
    }

    get wrapClass() {
        return [
            'task-wrap slds-is-relative',
            {
                'summary-wrap': this.isSummary,
                'milestone-wrap': this.isMilestone,
                'task-invalid-dependency': this.invalidDependency,
                'task-active': this.isActive,
                'task-dragging': this.isDragging,
                selected: this.tSelected
            }
        ];
    }

    get taskClass() {
        return [
            'task',
            {
                'task-summary': this.isSummary,
                'task-summary-expanded': this.isSummary && this.expanded,
                'task-milestone': this.isMilestone,
                'task-single': this.isTask,
                'task-new': this.uncommited
            }
        ];
    }

    get tActiveInteraction() {
        return this.taskManager?.getActiveInteraction();
    }

    get invalidDependency() {
        const active = this.tActiveInteraction;
        if (!active || !active.task) return false;

        return this.taskManager.validateDependencyConnection(
            active.task.gm__key,
            this.record.gm__key
        );
    }

    // ========================================================================
    // LIFECYCLE HOOKS
    // ========================================================================

    connectedCallback() {
        this.dispatchEvent(
            new CustomEvent('registertask', {
                composed: true,
                bubbles: true,
                detail: {
                    key: this.taskId,
                    setSelected: this.setSelected,
                    setExpanded: this.setExpanded,
                    reset: this.reset,
                    handleProgressUpdate: this.handleProgressUpdate,
                    handleResizeAction: this.handleResizeAction,
                    handleSlideAction: this.handleSlideAction,
                    updateTask: this.updateTask,
                    recalculateDerivedData: this.recalculateDerivedData
                }
            })
        );
    }

    renderedCallback() {
        if (this.isRendered) return;
        this.isRendered = true;

        // OPTIMIZATION: Cache container reference
        this._containerRef = this.template.querySelector('.container');

        if (this._derivedDataDirty) {
            this.recalculateDerivedData();
        }
        this.updateAllStyles();
    }

    disconnectedCallback() {
        clearTimeout(this.timeOutHover);
        // Clear cached references
        this._containerRef = null;
    }

    // ========================================================================
    // PUBLIC CALLBACKS
    // ========================================================================

    updateTask = (taskData) => {
        // Track what changed
        const changes = {
            needsRecalc: false,
            styles: new Set()
        };

        // Update simple properties
        if (taskData.start !== undefined) this.taskStart = taskData.start;
        if (taskData.end !== undefined) this.taskEnd = taskData.end;
        if (taskData.title !== undefined) this._title = taskData.title;

        // Update properties that affect styles
        if (taskData.color !== undefined && taskData.color !== this._color) {
            this._color = taskData.color;
            changes.styles.add('color');
        }

        if (
            taskData.rowHeight !== undefined &&
            taskData.rowHeight !== this._rowHeight
        ) {
            this._rowHeight = taskData.rowHeight;
            changes.styles.add('height');
        }

        if (taskData.type !== undefined && taskData.type !== this._type) {
            this._type = taskData.type;
            changes.needsRecalc = true;
        }

        if (taskData.rules !== undefined) {
            this.rules = taskData.rules;
            this._constraintsCacheDirty = true; // Invalidate constraint cache
            changes.needsRecalc = true;
        }

        if (taskData.left !== undefined && taskData.left !== this.tLeft) {
            this.tLeft = taskData.left;
            changes.styles.add('left');
        }

        if (taskData.width !== undefined && taskData.width !== this.tWidth) {
            this.tWidth = taskData.width;
            changes.styles.add('width');
            changes.needsRecalc = true; // Width affects deadlines
        }

        if (taskData.progress !== undefined) {
            const newProgress = Number(taskData.progress);
            if (newProgress !== this.tProgress) {
                this.tProgress = newProgress;
                changes.styles.add('progress');
            }
        }

        if (
            taskData.grouperHeight !== undefined &&
            taskData.grouperHeight !== this.tGrouperHeight
        ) {
            this.tGrouperHeight = taskData.grouperHeight;
            changes.styles.add('grouper');
        }

        // OPTIMIZATION: Batch style updates
        if (changes.styles.size > 0) {
            changes.styles.forEach((type) => this.scheduleStyleUpdate(type));
        }

        // Recalculate derived data if needed
        if (changes.needsRecalc) {
            this.recalculateDerivedData();
        }
    };

    recalculateDerivedData = () => {
        if (!this.isRendered || !this.record || !this.taskManager) {
            this._derivedDataDirty = true;
            return;
        }

        this._derivedDataDirty = false;

        if (this._calculationScheduled) return;
        this._calculationScheduled = true;

        requestAnimationFrame(() => {
            this._calculationScheduled = false;

            // Calculate in order of dependency
            this.calculateTypeFlags();
            this.calculatePermissions();
            this.calculateConstraints();
            this.calculateDeadlines();
            this.calculateSegments();
            this.calculateBaseline();
        });
    };

    setSelected = (val) => {
        this.tSelected = val;
    };

    setExpanded = (val) => {
        if (this._expanded !== val) {
            this._expanded = val;
        }
    };

    reset = () => {
        // Reset temporary interaction state
        this._tempProgress = null;
        this._tempLeft = null;
        this._tempWidth = null;
        this.scheduleStyleUpdate('left');
        this.scheduleStyleUpdate('width');
        this.scheduleStyleUpdate('progress');

        this.setDotState(this.refs.taskDotStart, false);
        this.setDotState(this.refs.taskDotEnd, false);
        this.template.host.style?.setProperty('--gm-task-wrap-opacity', 1);

        if (this.refs.slide) {
            this.refs.slide.style = '';
            this.refs.slide.className = '';
        }
        this.isDragging = false;
        this.isActive = false;
        this.taskManager.setActiveInteraction();
    };

    handleProgressUpdate = ({ progress }) => {
        this._tempProgress = progress.toFixed(0);
        this.scheduleStyleUpdate('progress');
    };

    handleResizeAction = ({ startOffset, endOffset }) => {
        this._tempLeft = startOffset;
        this._tempWidth = endOffset - startOffset;
        this.scheduleStyleUpdate('left');
        this.scheduleStyleUpdate('width');
        this.scheduleStyleUpdate('progress');
    };

    handleSlideAction = ({ startOffset }) => {
        if (startOffset && this.refs.slide) {
            // OPTIMIZATION: Use transform instead of left
            this.refs.slide.style.transform = `translateX(${startOffset}px)`;
        }
    };

    // ========================================================================
    // STYLE UPDATE BATCHING (OPTIMIZATION)
    // ========================================================================

    scheduleStyleUpdate(updateType) {
        this._pendingStyleUpdates.add(updateType);

        if (this._styleUpdateScheduled) return;
        this._styleUpdateScheduled = true;

        requestAnimationFrame(() => {
            this.applyPendingStyleUpdates();
            this._pendingStyleUpdates.clear();
            this._styleUpdateScheduled = false;
        });
    }

    applyPendingStyleUpdates() {
        if (!this.container) return;

        const updates = this._pendingStyleUpdates;

        if (updates.has('left')) {
            const left = this.effectiveLeft + (this.isMilestone ? 8 : 0);
            this.container.style.setProperty(
                '--gm-task-left',
                `translateX(${left}px)`
            );
        }

        if (updates.has('width')) {
            this.container.style.setProperty(
                '--gm-task-width',
                `${this.effectiveWidth}px`
            );
        }

        if (updates.has('progress')) {
            const progressPx =
                (this.effectiveWidth * this.effectiveProgress) / 100;
            this.container.style.setProperty(
                '--gm-task-complete',
                `${this.effectiveProgress}%`
            );
            this.container.style.setProperty(
                '--gm-task-progress',
                `translateX(${progressPx}px)`
            );
        }

        if (updates.has('color')) {
            const lighter = this.lightenColor(this._color, 0.4);
            this.container.style.setProperty('--gm-task-color', lighter);
            this.container.style.setProperty(
                '--gm-task-complete-color',
                this._color
            );
        }

        if (updates.has('height')) {
            this.container.style.setProperty(
                '--gm-task-height',
                `${this._rowHeight}px`
            );
        }

        if (updates.has('grouper')) {
            this.container.style.setProperty(
                '--gm-task-grouper-height',
                `${this.tGrouperHeight}px`
            );
        }

        if (updates.has('deadline')) {
            this.applyDeadlineStyles();
        }
    }

    // OPTIMIZED: Use cached container reference
    updateLeftStyles() {
        if (!this.container) return;
        const left = this.effectiveLeft + (this.isMilestone ? 8 : 0);
        this.container.style.setProperty(
            '--gm-task-left',
            `translateX(${left}px)`
        );
    }

    updateWidthStyles() {
        if (!this.container) return;
        this.container.style.setProperty(
            '--gm-task-width',
            `${this.effectiveWidth}px`
        );
    }

    updateProgressStyles() {
        if (!this.container) return;
        const progressPx = (this.effectiveWidth * this.effectiveProgress) / 100;
        this.container.style.setProperty(
            '--gm-task-complete',
            `${this.effectiveProgress}%`
        );
        this.container.style.setProperty(
            '--gm-task-progress',
            `translateX(${progressPx}px)`
        );
    }

    updateColorStyles() {
        if (!this.container) return;
        const lighter = this.lightenColor(this._color, 0.4);
        this.container.style.setProperty('--gm-task-color', lighter);
        this.container.style.setProperty(
            '--gm-task-complete-color',
            this._color
        );
    }

    applyDeadlineStyles() {
        if (!this.container) return;
        this.container.style.setProperty(
            '--gm-target-start-pct',
            `${this._cachedDeadlines.startPct}%`
        );
        this.container.style.setProperty(
            '--gm-target-end-pct',
            `${this._cachedDeadlines.endPct}%`
        );

        if (this.hasTargetStart && this.isBeforeTargetStart) {
            const taskStartPct = this.percentFromDate(this.taskStart);
            const taskEndPct = this.percentFromDate(this.taskEnd);
            const targetStartPct = this._cachedDeadlines.startPct;
            const targetStartWithinTask =
                (targetStartPct - taskStartPct) / (taskEndPct - taskStartPct);
            const textureWidth = targetStartWithinTask * this.effectiveWidth;
            this.container.style.setProperty(
                '--gm-target-start-width',
                `${textureWidth}px`
            );
        } else {
            this.container.style.setProperty('--gm-target-start-width', '0px');
        }

        if (this.hasTargetEnd && this.isAfterTargetEnd) {
            const taskStartPct = this.percentFromDate(this.taskStart);
            const taskEndPct = this.percentFromDate(this.taskEnd);
            const targetEndPct = this._cachedDeadlines.endPct;
            const targetEndWithinTask =
                (targetEndPct - taskStartPct) / (taskEndPct - taskStartPct);
            const textureStart = targetEndWithinTask * this.effectiveWidth;
            this.container.style.setProperty(
                '--gm-target-end-width',
                `${textureStart}px`
            );
        } else {
            this.container.style.setProperty('--gm-target-end-width', '100%');
        }
    }

    updateGrouperHeightStyle() {
        if (!this.container) return;
        this.container.style.setProperty(
            '--gm-task-grouper-height',
            `${this.tGrouperHeight}px`
        );
    }

    updateHeightStyle() {
        if (!this.container) return;
        this.container.style.setProperty(
            '--gm-task-height',
            `${this._rowHeight}px`
        );
    }

    updateAllStyles() {
        if (!this.isRendered || !this.container) return;

        const left = this.effectiveLeft + (this.isMilestone ? 8 : 0);
        const lighter = this.lightenColor(this._color, 0.4);
        const progressPx = (this.effectiveWidth * this.effectiveProgress) / 100;

        const style = this.container.style;
        style.setProperty('--gm-task-height', `${this._rowHeight}px`);
        style.setProperty('--gm-task-width', `${this.effectiveWidth}px`);
        style.setProperty('--gm-task-left', `translateX(${left}px)`);
        style.setProperty(
            '--gm-task-grouper-height',
            `${this.tGrouperHeight}px`
        );
        style.setProperty('--gm-task-complete', `${this.effectiveProgress}%`);
        style.setProperty('--gm-task-progress', `translateX(${progressPx}px)`);
        style.setProperty('--gm-task-color', lighter);
        style.setProperty('--gm-task-complete-color', this._color);
        style.setProperty(
            '--gm-target-start-pct',
            `${this._cachedDeadlines.startPct}%`
        );
        style.setProperty(
            '--gm-target-end-pct',
            `${this._cachedDeadlines.endPct}%`
        );
    }

    // ========================================================================
    // DERIVED DATA CALCULATION
    // ========================================================================

    calculateActiveConstraints() {
        if (!this.record || !this.rules?.length) return [];

        const active = [];

        const normalizeDate = (value) => {
            if (!value) return null;

            let d;
            if (
                typeof value === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(value)
            ) {
                const [y, m, day] = value.split('-').map(Number);
                d = DateTime.fromISO(
                    `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                )
                    .setZone(TIMEZONE)
                    .toJSDate();
            } else {
                d = value instanceof Date ? value : new Date(value);
                d = DateTime.fromJSDate(d).setZone(TIMEZONE).toJSDate();
            }

            d.setHours(0, 0, 0, 0);
            return d.getTime();
        };

        const getConstraintSides = (type) => {
            if (type === 'MSO') return ['start'];
            if (type === 'MFO') return ['end'];

            const sides = [];
            if (type.includes('S')) sides.push('start');
            if (type.includes('F')) sides.push('end');
            return sides;
        };

        const hasAnyDependency = () => {
            if (
                !this.taskManager?.dependencies ||
                !Array.isArray(this.taskManager.dependencies)
            ) {
                return false;
            }

            const taskUID = this.record.gm__elementUID;
            return this.taskManager.dependencies.some(
                (dep) =>
                    dep.gm__predecessorUID === taskUID ||
                    dep.gm__successorUID === taskUID
            );
        };

        const getAllDependencies = () => {
            if (
                !this.taskManager?.dependencies ||
                !Array.isArray(this.taskManager.dependencies)
            ) {
                return [];
            }

            const taskUID = this.record.gm__elementUID;
            return this.taskManager.dependencies.filter(
                (dep) =>
                    dep.gm__predecessorUID === taskUID ||
                    dep.gm__successorUID === taskUID
            );
        };

        const isConstraintRelevant = (type, side, ruleTime) => {
            if (type === 'MSO') return side === 'start';
            if (type === 'MFO') return side === 'end';

            if (!hasAnyDependency()) return false;

            for (const dep of getAllDependencies()) {
                const allowedSides =
                    this.CONSTRAINT_VISIBILITY_RULES[dep.gmpkg__Type__c]?.[
                        type
                    ] || [];

                if (!allowedSides.includes(side)) continue;

                const blocks =
                    this.taskManager.dependencyManager.isConstraintBlockingDependency(
                        this.record,
                        {
                            gmpkg__Type__c: type,
                            gmpkg__StartDate__c: new Date(ruleTime),
                            side
                        },
                        dep
                    );

                if (blocks) return true;
            }

            return false;
        };

        for (const rule of this.rules) {
            if (
                rule.gmpkg__Category__c !== 'Constraint' ||
                rule.gmpkg__IsActive__c === false
            ) {
                continue;
            }

            const type = rule.gmpkg__Type__c;
            if (!type) continue;

            const ruleTime = normalizeDate(rule.gmpkg__StartDate__c);
            const sides = getConstraintSides(type);

            for (const side of sides) {
                if (isConstraintRelevant(type, side, ruleTime)) {
                    active.push({
                        type: rule.gmpkg__Type__c,
                        date: rule.gmpkg__StartDate__c,
                        side
                    });
                }
            }
        }

        return active;
    }

    calculateTypeFlags() {
        const nodeType = this._type;

        if (nodeType === 'milestone') {
            this._cachedIsMilestone = true;
            this._cachedIsSummary = false;
            this._cachedIsTask = false;
            return;
        }

        if (nodeType === 'task') {
            this._cachedIsMilestone = false;
            this._cachedIsSummary = false;
            this._cachedIsTask = true;
            return;
        }

        if (nodeType === 'summary') {
            const kids = Array.isArray(this.items) ? this.items : [];
            const allChildrenMilestone =
                kids.length > 0 && kids.every(this.isSubtreeAllMilestones);

            this._cachedIsMilestone = allChildrenMilestone;
            this._cachedIsSummary = !allChildrenMilestone;
            this._cachedIsTask = false;
        }
    }

    isSubtreeAllMilestones = (node) => {
        const t = node.gm__type ?? node.type;
        if (t === 'task') return false;
        if (t === 'milestone') return true;
        if (t === 'summary') {
            const children = Array.isArray(node.gm__children)
                ? node.gm__children
                : [];
            return (
                children.length > 0 &&
                children.every(this.isSubtreeAllMilestones)
            );
        }
        return false;
    };

    calculatePermissions() {
        const hasMSO = this.rules.some(
            (r) =>
                r.gmpkg__Category__c === 'Constraint' &&
                r.gmpkg__Type__c === 'MSO' &&
                r.gmpkg__IsActive__c === true
        );

        const hasMFO = this.rules.some(
            (r) =>
                r.gmpkg__Category__c === 'Constraint' &&
                r.gmpkg__Type__c === 'MFO' &&
                r.gmpkg__IsActive__c === true
        );

        this._cachedCanEdit = this.record.gm__canEdit;
        this._cachedCanDelete = this.record.gm__canDelete;

        this._cachedCanMove =
            !hasMSO &&
            !hasMFO &&
            this._cachedCanEdit &&
            this.record.gm__canEditStart &&
            this.record.gm__canEditEnd;
        this._cachedCanResizeStart =
            !this._cachedIsMilestone &&
            !hasMSO &&
            this._cachedCanEdit &&
            this.record.gm__canEditStart &&
            this._cachedIsTask;
        this._cachedCanResizeEnd =
            !this._cachedIsMilestone &&
            !hasMFO &&
            this._cachedCanEdit &&
            this.record.gm__canEditEnd &&
            this._cachedIsTask;
        this._cachedCanProgressDrag =
            this._cachedIsTask &&
            this._cachedCanEdit &&
            this.hasProgressField &&
            this.record.gm__canEditProgress;
    }

    calculateConstraints() {
        const rules = this.activeConstraints || [];
        const startRule = rules.find((r) => r.side === 'start');
        const endRule = rules.find((r) => r.side === 'end');

        this._cachedStartIcon = startRule
            ? {
                  iconName: startRule.type.includes('M')
                      ? 'utility:lock'
                      : 'utility:record',
                  class: 'constraint-icon-start'
              }
            : null;

        this._cachedEndIcon = endRule
            ? {
                  iconName: endRule.type.includes('M')
                      ? 'utility:lock'
                      : 'utility:record',
                  class: 'constraint-icon-end'
              }
            : null;

        this.updateConstraintBorderStyle(startRule, endRule);
    }

    // OPTIMIZED: Only update if colors changed
    updateConstraintBorderStyle(startRule, endRule) {
        if (!this.container) return;

        const getColorForRule = (rule) => {
            if (!rule) return 'transparent';
            if (rule.type.includes('M')) return '#DC3545';
            if (rule.type.includes('S')) return '#DC3545';
            if (rule.type.includes('F')) return '#DC3545';
            return 'transparent';
        };

        const startColor = getColorForRule(startRule);
        const endColor = getColorForRule(endRule);

        // Only update if changed
        if (this._lastConstraintLeftColor !== startColor) {
            this._lastConstraintLeftColor = startColor;
            this.container.style.setProperty(
                '--gm-constraint-left-color',
                startColor
            );
        }

        if (this._lastConstraintRightColor !== endColor) {
            this._lastConstraintRightColor = endColor;
            this.container.style.setProperty(
                '--gm-constraint-right-color',
                endColor
            );
        }
    }

    calculateDeadlines() {
        const targetStartRule = this.rules.find(
            (r) =>
                r.gmpkg__Category__c === 'Deadline' &&
                r.gmpkg__Type__c === 'Target Start' &&
                r.gmpkg__IsActive__c === true
        );
        const targetEndRule = this.rules.find(
            (r) =>
                r.gmpkg__Category__c === 'Deadline' &&
                r.gmpkg__Type__c === 'Target End' &&
                r.gmpkg__IsActive__c === true
        );

        this._cachedDeadlines = {
            startPct: targetStartRule
                ? this.percentFromDate(targetStartRule.gmpkg__StartDate__c)
                : -100,
            endPct: targetEndRule
                ? this.percentFromDate(targetEndRule.gmpkg__StartDate__c)
                : -100
        };

        this.scheduleStyleUpdate('deadline');
    }

    calculateSegments() {
        const segmentRules = this.rules.filter(
            (r) =>
                r.gmpkg__Category__c === 'Segment' &&
                r.gmpkg__StartDate__c &&
                r.gmpkg__EndDate__c &&
                r.gmpkg__StartDate__c <= r.gmpkg__EndDate__c &&
                r.gmpkg__IsActive__c === true
        );

        if (!segmentRules.length || !this.slotSize) {
            this._cachedSegments = [];
        } else {
            this._cachedSegments = segmentRules.map((seg) => {
                const x1 = this.getXPosition(seg.gmpkg__StartDate__c, false);
                const x2 = this.getXPosition(seg.gmpkg__EndDate__c, true);
                const d1 = this.toDate(seg.gmpkg__StartDate__c);
                const d2 = this.toDate(seg.gmpkg__EndDate__c);
                return {
                    style: `left: ${x1}px; width: ${Math.max(0, x2 - x1)}px;`,
                    title: `Segment: ${d1?.toLocaleDateString()} - ${d2?.toLocaleDateString()}`,
                    key: seg.gm__key
                };
            });
        }
    }

    calculateBaseline() {
        const baselineRef = this.refs?.baselineIndicator;
        const baselines = this.taskManager?.baselineData;
        let baselineData;

        if (this.record.gm__recordId && baselines) {
            baselineData = baselines[this.record.gm__recordId];
        }

        if (
            baselineData &&
            baselineData.start &&
            baselineData.end &&
            this.slotSize
        ) {
            const baselineLeft = this.getXPosition(baselineData.start, false);
            const baselineRight = this.getXPosition(baselineData.end, true);
            const baselineWidth = Math.max(0, baselineRight - baselineLeft);

            this._cachedBaseline = {
                left: baselineLeft,
                width: this.isMilestone ? 14 : baselineWidth,
                startDate: baselineData.start,
                endDate: baselineData.end
            };

            if (baselineRef) {
                baselineRef.style = `left: ${this._cachedBaseline.left}px; width: ${this._cachedBaseline.width}px;`;
            }

            this.baselineStartDate = this.formatDateForDisplay(
                new Date(baselineData.start)
            );
            this.baselineEndDate = this.formatDateForDisplay(
                new Date(baselineData.end)
            );
        } else {
            this._cachedBaseline = null;
            this.baselineStartDate = '';
            this.baselineEndDate = '';
            if (baselineRef) baselineRef.style = '';
        }
    }

    // ========================================================================
    // INTERACTION HANDLERS
    // ========================================================================

    handleTaskMouseDown(event) {
        if (event.button !== 0 || event.__ganttHandled) return;
        event.__ganttHandled = true;

        const ignoredElements = [
            this.refs.taskDotStart,
            this.refs.taskDotEnd,
            this.refs.resizeLeft,
            this.refs.resizeRight,
            this.refs.progressPercent,
            this.refs.progressDrag,
            this.refs.taskGrouper,
            this.refs.recordPopover
        ];

        if (ignoredElements.includes(event.target)) return;

        const wrap = this.refs.wrap;
        if (!wrap) return;

        if (!wrap.contains(event.target) && event.target !== wrap) {
            this.dispatchTaskAction('select', { id: null });
            return;
        }

        event.preventDefault();
        this.isDragging = false;
        const dragStartX = event.clientX;

        const abortController = new AbortController();
        const { signal } = abortController;

        let lastMoveTime = 0;
        const throttleDelay = 16;

        const moveListener = (moveEvent) => {
            const now = Date.now();

            if (now - lastMoveTime < throttleDelay) return;
            lastMoveTime = now;

            const distance = Math.abs(moveEvent.clientX - dragStartX);

            if (distance > 5 && !this.isDragging) {
                this.isDragging = true;
                this.handleTaskSlide(moveEvent);
                abortController.abort();
            }
        };

        const upListener = (upEvent) => {
            if (!this.isDragging && !ignoredElements.includes(upEvent.target)) {
                this.dispatchTaskAction('select', { id: this.taskId });
            }
            this.isDragging = false;
            abortController.abort();
        };

        if (this.canMove) {
            window.addEventListener('mousemove', moveListener, { signal });
        }
        window.addEventListener('mouseup', upListener, { signal, once: true });
    }

    handleTaskDotMouseDown(event) {
        if (event.button !== 0 || this.tActiveInteraction) return;
        event.preventDefault();
        const isStart = event.target.classList.contains('task-start');
        const dot = isStart ? this.refs.taskDotStart : this.refs.taskDotEnd;
        this.setDotState(dot, true);
        this.isActive = true;
        this.dispatchTaskAction('dependency', {
            id: this.taskId,
            positionX: event.clientX,
            positionY: event.clientY,
            predecessorStart: isStart
        });
    }

    handleTaskDotMouseUp(event) {
        this.dispatchTaskAction('dependency', {
            successorId: this.taskId,
            successorStart: event.target.classList.contains('task-start')
        });
    }

    handleTaskDotMouseEnter() {
        const { type, activeId } = this.tActiveInteraction || {};
        if (type === 'dependency' && this.taskId !== activeId) {
            this.isActive = true;
        }
    }

    handleTaskDotMouseLeave() {
        const { type, activeId } = this.tActiveInteraction || {};
        if (type === 'dependency' && this.taskId !== activeId) {
            this.isActive = false;
        }
    }

    handleProgressMouseDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        this.dispatchTaskAction('progress', {
            id: this.taskId,
            width: this.tWidth,
            left: this.tLeft
        });
    }

    handleResizeMouseDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        this.dispatchTaskAction('resize', {
            id: this.taskId,
            width: this.tWidth,
            left: this.tLeft,
            isResizeStart: event.target.classList.contains('resize-left')
        });
    }

    async handleTaskSlide(event) {
        const row = this.refs?.row;
        const task = this.refs?.task;
        if (!row || !task) return;

        await Promise.resolve();
        this.template.host.style?.setProperty('--gm-task-wrap-opacity', 0.4);

        const slide = this.refs.slide;
        slide.style.position = 'absolute';
        slide.style.transform = `translateX(${this.tLeft}px)`; // OPTIMIZATION: Use transform
        slide.style.width = this.isMilestone ? '14px' : `${this.tWidth}px`;
        slide.style.backgroundColor = 'var(--slds-g-color-border-warning-1)';
        slide.style.border = '2px solid var(--slds-g-color-on-warning-1)';

        let cls = 'task task-row-slide ';
        if (this.isMilestone) cls += 'task-milestone';
        else if (this.isSummary) cls += 'task-summary';
        else cls += 'task-single';
        slide.className = cls;

        this.isDragging = true;
        const rect = task.getBoundingClientRect();
        this.dispatchTaskAction('slide', {
            id: this.taskId,
            width: this.tWidth,
            relativeLeft: event.clientX - rect.left
        });
    }

    dispatchTaskAction(action, value = {}) {
        this.handlePopoverClose();
        this.dispatchEvent(
            new CustomEvent('taskaction', {
                composed: true,
                bubbles: true,
                cancelable: true,
                detail: { action, value }
            })
        );
    }

    // ========================================================================
    // POPOVER LOGIC
    // ========================================================================

    handleLookupOver(event) {
        if (!this.record || this.tActiveInteraction || this.uncommited) return;

        // Check for ignored elements
        const ignoredElements = [
            this.refs.taskDotStart,
            this.refs.taskDotEnd,
            this.refs.resizeLeft,
            this.refs.resizeRight,
            this.refs.progressPercent,
            this.refs.progressDrag,
            this.refs.taskGrouper
        ];
        if (ignoredElements.includes(event.target)) return;

        // Calculate horizontal position with spacing
        let left = event.clientX;
        const spaceRight = window.innerWidth - left;
        const spaceLeft = left;

        if (spaceRight < 400 && spaceLeft > spaceRight) {
            left += 22;
        } else {
            left -= 22;
        }

        // Set hover state and dispatch event
        if (!this.hover) {
            this.hover = true;

            const cellTask = this.refs.row;

            const bounds = cellTask.getBoundingClientRect();

            // Show popover after delay
            this.handleLookupPopover(() => {
                this.dispatchEvent(
                    new CustomEvent('showpopover', {
                        bubbles: true,
                        composed: true,
                        detail: {
                            record: this.record,
                            id: this.taskId,
                            title: this._title,
                            canDelete: this.canDelete,
                            popoverFields: this.record.gm__popoverFields,
                            iconName: this.record.gm__iconName,
                            left: left,
                            top: bounds.top,
                            height: bounds.height
                        }
                    })
                );
            });
        } else {
            // Update popover position on mouse move
            this.dispatchEvent(
                new CustomEvent('updatepopover', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        id: this.taskId,
                        left: left
                    }
                })
            );
        }
    }

    handleLookupLeave() {
        if (this.record) {
            this.hover = false;
            this.handleLookupPopover(() => {
                // Dispatch event to hide popover after delay
                this.dispatchEvent(
                    new CustomEvent('hidepopover', {
                        bubbles: true,
                        composed: true
                    })
                );
            });
        }
    }

    handlePopoverClose() {
        if (this.record) {
            this.hover = false;
            clearTimeout(this.timeOutHover);

            // Dispatch event to hide popover immediately
            this.dispatchEvent(
                new CustomEvent('hidepopover', {
                    bubbles: true,
                    composed: true
                })
            );
        }
    }

    handleLookupPopover(callback) {
        clearTimeout(this.timeOutHover);
        this.timeOutHover = setTimeout(() => {
            if (this.hover || callback) {
                if (callback) callback();
            }
        }, 500);
    }

    handleBaselineMouseMove(event) {
        if (!this._cachedBaseline) return;

        this.showBaselineTooltip = true;

        // Get position relative to the container
        const container = this.template.querySelector('.container');
        const containerRect = container.getBoundingClientRect();

        const mouseX = event.clientX - containerRect.left;
        const mouseY = event.clientY - containerRect.top;

        this.baselineTooltipStyle = `left: ${mouseX + 20}px; top: ${mouseY - 10}px;`;
    }

    handleBaselineMouseLeave() {
        this.showBaselineTooltip = false;
        this.baselineTooltipStyle = '';
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    lightenColor(hex, percent) {
        if (!hex) return '#cccccc';
        const r = Math.min(
            255,
            parseInt(hex.substring(1, 3), 16) +
                (255 - parseInt(hex.substring(1, 3), 16)) * percent
        );
        const g = Math.min(
            255,
            parseInt(hex.substring(3, 5), 16) +
                (255 - parseInt(hex.substring(3, 5), 16)) * percent
        );
        const b = Math.min(
            255,
            parseInt(hex.substring(5, 7), 16) +
                (255 - parseInt(hex.substring(5, 7), 16)) * percent
        );
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    setDotState(dot, isActive) {
        if (dot) {
            dot.classList.toggle('hover', isActive);
            dot.style.display = isActive ? 'block' : '';
        }
    }

    formatDateForDisplay(date) {
        if (!date) return '';
        const options = { year: '2-digit', month: '2-digit', day: '2-digit' };
        return date.toLocaleDateString(LOCALE, options);
    }

    toDate(value, endOfDay = false) {
        if (!value) return null;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [y, m, d] = value.split('-').map(Number);
            return new Date(
                y,
                m - 1,
                d,
                endOfDay ? 23 : 0,
                endOfDay ? 59 : 0,
                endOfDay ? 59 : 0,
                endOfDay ? 999 : 0
            );
        }
        const dt = value instanceof Date ? value : new Date(value);
        return isNaN(dt) ? null : dt;
    }

    percentFromDate(dateValue) {
        if (!dateValue || !this.taskManager) return 0;
        const d = this.toDate(dateValue, true);
        if (!d) return 0;
        const { rangeStart, rangeEnd } = this.taskManager.computeRange();
        const start = this.toDate(rangeStart);
        const end = this.toDate(rangeEnd);
        if (!start || !end) return 0;
        const total = end.getTime() - start.getTime();
        if (total <= 0) return 0;
        return Math.min(
            100,
            Math.max(0, ((d.getTime() - start.getTime()) / total) * 100)
        );
    }

    getXPosition(dateValue, isEnd = false) {
        if (!dateValue || !this.slotSize || !this.taskManager) return 0;
        const { rangeStart, rangeEnd, view } = this.taskManager.computeRange();
        if (!rangeStart || !rangeEnd) return 0;

        const toMidnight = (val) => {
            const dt = this.toDate(val);
            if (!dt) return null;
            return new Date(
                dt.getFullYear(),
                dt.getMonth(),
                dt.getDate(),
                0,
                0,
                0
            );
        };
        const target = toMidnight(dateValue);
        const start = toMidnight(rangeStart);

        let units = 0;
        if (view === 'year') {
            const fullMonths =
                (target.getFullYear() - start.getFullYear()) * 12 +
                (target.getMonth() - start.getMonth());
            const daysInMonth = new Date(
                target.getFullYear(),
                target.getMonth() + 1,
                0
            ).getDate();
            const dayFraction =
                (target.getDate() - (isEnd ? 0 : 1)) / daysInMonth;
            units = fullMonths + dayFraction;
        } else {
            const diffMs = target.getTime() - start.getTime();
            const MS_PER_DAY = 86400000;
            const isMonthView = view === 'month';
            const msPerUnit = isMonthView ? MS_PER_DAY * 7 : MS_PER_DAY;
            units = diffMs / msPerUnit;
            if (isEnd) units += isMonthView ? 0.142857 : 1;
        }
        return Math.max(0, units * this.slotSize);
    }
}
