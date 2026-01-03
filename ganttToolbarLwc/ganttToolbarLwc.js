import { LightningElement, api } from 'lwc';

import Delete from '@salesforce/label/c.Delete';
import ToggleFullscreen from '@salesforce/label/c.ToggleFullscreen';
import EnableHorizontalScroll from '@salesforce/label/c.GanttEnableHorizontalScroll';
import ToggleLeftPanel from '@salesforce/label/c.GanttToggleLeftPanel';
import ToggleRightPanel from '@salesforce/label/c.GanttToggleRightPanel';
import ExpandAll from '@salesforce/label/c.GanttExpandAll';
import CollapseAll from '@salesforce/label/c.GanttCollapseAll';
import MoveUp from '@salesforce/label/c.GanttMoveUp';
import Refresh from '@salesforce/label/c.Refresh';
import MoveDown from '@salesforce/label/c.GanttMoveDown';
import MoveLeft from '@salesforce/label/c.GanttMoveLeft';
import MoveRight from '@salesforce/label/c.GanttMoveRight';
import CriticalPath from '@salesforce/label/c.GanttCriticalPath';
import GanttDay from '@salesforce/label/c.GanttDay';
import GanttWeek from '@salesforce/label/c.GanttWeek';
import GanttMonth from '@salesforce/label/c.GanttMonth';
import GanttYear from '@salesforce/label/c.GanttYear';
import GanttFit from '@salesforce/label/c.GanttFit';
import Items from '@salesforce/label/c.GanttItems';
import ZoomIn from '@salesforce/label/c.ZoomIn';
import Save from '@salesforce/label/c.Save';
import ZoomOut from '@salesforce/label/c.ZoomOut';
import GanttFull from '@salesforce/label/c.GanttFull';
import MissingElements from '@salesforce/label/c.MissingElements';
import GanttUndo from '@salesforce/label/c.GanttUndo';
import GanttRedo from '@salesforce/label/c.GanttRedo';

export default class GanttToolbarLwc extends LightningElement {
    //labels
    labels = {
        EnableHorizontalScroll,
        ToggleLeftPanel,
        ToggleRightPanel,
        ExpandAll,
        CollapseAll,
        ToggleFullscreen,
        Refresh,
        MoveUp,
        MoveDown,
        MoveLeft,
        MoveRight,
        Delete,
        ZoomIn,
        ZoomOut,
        Save,
        CriticalPath,
        GanttDay,
        GanttWeek,
        GanttMonth,
        GanttYear,
        GanttFull,
        GanttFit,
        Items,
        MissingElements,
        Undo: GanttUndo,
        Redo: GanttRedo
    };

    //@api properties
    @api options = null;
    @api taskManager = null;
    @api selectedView = 'month';

    //@track properties
    tRightPanelOpen = false;
    tLeftPanelOpen = false;

    tFullscreen = false;
    tEnableHScroll = false;
    tShowCriticalPath = false;

    tSelectedView = 'month';

    tRefDate = null;

    tMinDate = null;
    tMaxDate = null;

    selectedBaselineId = null;
    baselines = [];

    get saveLabel() {
        return this.options.historyIndex > 0
            ? `${this.labels.Save} (${this.options.historyIndex})`
            : this.labels.Save;
    }

    get syncNeededLabel() {
        return ` • ${this.elementToSync} ${this.labels.MissingElements}`;
    }

    get disabled() {
        return this.options.initState !== 'success';
    }

    get zoomLevel() {
        return this.options.zoomLevel;
    }

    get zoomLevelOptions() {
        return this.options.zoomLevels;
    }

    get zoomOutDisabled() {
        return (
            this.disabled || this.zoomLevel <= this.zoomLevelOptions[0].value
        );
    }

    get zoomInDisabled() {
        return (
            this.disabled ||
            this.zoomLevel >=
                this.zoomLevelOptions[this.zoomLevelOptions.length - 1].value
        );
    }

    get tasksLength() {
        return this.taskManager?.tasks.length;
    }

    get isSyncNeeded() {
        return this.options.elementToSync > 0;
    }

    get elementToSync() {
        return this.options.elementToSync;
    }

    get fullscreenIcon() {
        return this.tFullscreen ? 'utility:contract' : 'utility:expand';
    }

    get viewOptions() {
        const options = [];
        if (this.isDayViewAvailable) {
            options.push({ label: this.labels.GanttDay, value: 'day' });
        }
        if (this.isWeekViewAvailable) {
            options.push({ label: this.labels.GanttWeek, value: 'week' });
        }
        if (this.isMonthViewAvailable) {
            options.push({ label: this.labels.GanttMonth, value: 'month' });
        }
        if (this.isYearViewAvailable) {
            options.push({ label: this.labels.GanttYear, value: 'year' });
        }
        if (this.isFullViewAvailable) {
            options.push({ label: this.labels.GanttFull, value: 'full' });
        }
        return options;
    }

    get getSelectedView() {
        return this.tSelectedView;
    }

    get isDayViewAvailable() {
        return this.options.views?.includes('day');
    }

    get isWeekViewAvailable() {
        return this.options.views?.includes('week');
    }

    get isMonthViewAvailable() {
        return this.options.views?.includes('month');
    }

    get isYearViewAvailable() {
        return this.options.views?.includes('year');
    }

    get isFullViewAvailable() {
        return this.options.views?.includes('full');
    }

    get isZoomAvailable() {
        return this.selectedView !== 'full';
    }

    get selectedPathVariant() {
        return this.tShowCriticalPath ? 'brand' : '';
    }

    get leftPanelOpen() {
        return this.options.defaultLeftPanelOpen;
    }

    get rightPanelOpen() {
        return this.options.defaultRightPanelOpen;
    }

    get disableSave() {
        return !this.options.canUndo;
    }

    get disableRedo() {
        return !this.options.canRedo;
    }

    get disableUndo() {
        return !this.options.canUndo;
    }

    get canDelete() {
        return this.options.canDelete;
    }

    get canReorder() {
        return this.options.canReorder;
    }

    get showActions() {
        return this.canDelete || this.canReorder;
    }

    get baselineOptions() {
        let baselines = this.baselines.map((baseline) => ({
            label: baseline.Name,
            value: baseline.Id
        }));
        baselines.unshift({ label: 'None', value: null });
        return baselines;
    }

    @api
    refreshToolbar() {
        let { rangeStart, rangeEnd } = this.taskManager.computeRange();

        this.tMinDate = rangeStart.toISOString().slice(0, 10);
        this.tMaxDate = rangeEnd.toISOString().slice(0, 10);
        this.tRefDate = this.options.referenceDate.toISOString();
    }

    connectedCallback() {
        this.tEnableHScroll = this.options.autoHScroll;
        this.tSelectedView = this.selectedView;
    }

    handleAutoFit() {
        this.dispatchAction('handleViewChange', 'full');
    }

    handleViewChange(event) {
        let viewId = event.detail.value;
        this.tSelectedView = viewId;
        this.dispatchAction('handleViewChange', viewId);
    }

    handleZoom(event) {
        let zoomId = event.target.dataset.id;

        let zoomLevel = this.zoomLevel;
        if (zoomId === 'zoomin') {
            zoomLevel = this.zoomLevelOptions.find(
                (z) => z.value > this.zoomLevel
            ).value;
        } else if (zoomId === 'zoomout') {
            zoomLevel = this.zoomLevelOptions.findLast(
                (z) => z.value < this.zoomLevel
            ).value;
        }

        this.dispatchAction('handleZoom', zoomLevel);
    }

    handleChangeLevel(event) {
        let zoomLevel = Number(event.detail.value);
        this.dispatchAction('handleZoom', zoomLevel);
    }

    handleReorder(event) {
        let orderId = event.target.dataset.id;
        this.dispatchAction('handleReorder', orderId);
    }

    handleCollapseAll() {
        this.dispatchAction('handleCollapseAll');
    }

    handleExpandAll() {
        this.dispatchAction('handleExpandAll');
    }

    handleDeleteSelected() {
        this.dispatchAction('handleDelete');
    }

    toggleFullscreen() {
        this.tFullscreen = !this.tFullscreen;
        this.dispatchAction('toggleFullscreen', this.tFullscreen);
    }

    toggleLeftPanel() {
        this.dispatchAction('toggleLeftPanel', !this.leftPanelOpen);
    }

    toggleRightPanel() {
        this.dispatchAction('toggleRightPanel', !this.rightPanelOpen);
    }

    toggleAutoHScroll() {
        this.tEnableHScroll = !this.tEnableHScroll;
        this.dispatchAction('toggleAutoHScroll', this.tEnableHScroll);
    }

    toggleCriticalPath() {
        this.tShowCriticalPath = !this.tShowCriticalPath;
        this.dispatchAction('toggleCriticalPath', this.tShowCriticalPath);
    }

    handleChangeDate(event) {
        this.tRefDate = event.detail.value;
        this.dispatchAction('handleChangeDate', this.tRefDate);
    }

    handleSync(event) {
        this.tSync = event.detail.value;
        this.dispatchAction('handleSync');
    }

    handleSaveHistory() {
        this.dispatchAction('handleSaveHistory');
    }

    handleUndoHistory() {
        this.dispatchAction('handleUndoHistory');
    }

    handleRedoHistory() {
        this.dispatchAction('handleRedoHistory');
    }

    handleRefresh() {
        this.dispatchAction('handleRefresh');
    }

    handleBaselineChange(event) {
        this.selectedBaselineId = event.detail.value;
        this.dispatchAction('baselineChanged', this.selectedBaselineId);
    }

    handleAddBaseline() {
        this.dispatchAction('addBaseline');
    }

    @api
    setBaselines(baselines) {
        this.baselines = baselines || [];
    }

    @api
    setSelectedBaseline(baselineId) {
        this.selectedBaselineId = baselineId;
    }

    dispatchAction(action, value) {
        const actionEvent = new CustomEvent('toolbaraction', {
            detail: {
                action,
                value
            }
        });

        this.dispatchEvent(actionEvent);
    }
}
