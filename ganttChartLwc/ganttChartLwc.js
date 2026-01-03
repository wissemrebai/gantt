/* eslint-disable @lwc/lwc/no-async-operation */
/* eslint-disable no-unused-vars */
/* eslint-disable no-await-in-loop*/

import { LightningElement, track, api, wire } from 'lwc';
import LightningConfirm from 'lightning/confirm';
import LightningAlert from 'lightning/alert';

import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { createRecord, getRecord } from 'lightning/uiRecordApi';

import recordFormModal from 'c/recordFormModalLWC';
import newRecordModal from 'c/ganttChartNewRecordLwc';
import GanttTaskManager from 'c/ganttTaskManager';

import getObjectItems from '@salesforce/apex/DataGridController.getObjectItems';
import saveRelatedItems from '@salesforce/apex/DataGridController.saveRelatedItems';

import getGantt from '@salesforce/apex/GanttChartController.getGantt';
import getGanttElements from '@salesforce/apex/GanttChartController.getGanttElements';
import getGanttChartObjectMetadata from '@salesforce/apex/GanttChartController.getGanttChartObjectMetadata';
import getDependencies from '@salesforce/apex/GanttChartController.getDependencies';

import TaostError from '@salesforce/label/c.TaostError';
import TaostSuccess from '@salesforce/label/c.TaostSuccess';
import ConfirmDeleteMsg from '@salesforce/label/c.DeleteRecordConfirmation';
import DoYouWantToDeleteRecords from '@salesforce/label/c.DoYouWantToDeleteRecords';
import RecordsDeletedSuccessfully from '@salesforce/label/c.RecordsDeletedSuccessfully';

import InsertBefore from '@salesforce/label/c.GanttInsertBefore';
import InsertAfter from '@salesforce/label/c.GanttInsertAfter';
import AddChild from '@salesforce/label/c.GanttAddAchild';
import Task from '@salesforce/label/c.GanttTask';
import StartDate from '@salesforce/label/c.GanttStartDate';
import EndDate from '@salesforce/label/c.GanttEndDate';
import Resource from '@salesforce/label/c.GanttResource';
import GanttConfirmReload from '@salesforce/label/c.GanttConfirmReload';
import GanttUnsavedChangesWarning from '@salesforce/label/c.GanttUnsavedChangesWarning';
import GanttCircularDependency from '@salesforce/label/c.GanttCircularDependency';
import GanttCircularDependencyMsg from '@salesforce/label/c.GanttCircularDependencyMsg';
import GanttUpdateDependencyError from '@salesforce/label/c.GanttUpdateDependencyError';
import GanttCannotReorder from '@salesforce/label/c.GanttCannotReorder';
import GanttAllTasksSameParent from '@salesforce/label/c.GanttAllTasksSameParent';
import GanttInvalidMasterRecord from '@salesforce/label/c.GanttInvalidMasterRecord';
import GanttInconsistenciesDetected from '@salesforce/label/c.GanttInconsistenciesDetected';
import GanttAnomaliesFound from '@salesforce/label/c.GanttAnomaliesFound';
import GanttRuleConflicts from '@salesforce/label/c.GanttRuleConflicts';
import GanttRuleConflictsConfirm from '@salesforce/label/c.GanttRuleConflictsConfirm';
import GanttChangesSaved from '@salesforce/label/c.GanttChangesSaved';
import GanttSyncFailed from '@salesforce/label/c.GanttSyncFailed';

import { getTimezoneDiff } from 'c/dateUtils';
import TIMEZONE from '@salesforce/i18n/timeZone';

import { toUserDate } from 'c/dateUtils';

import GanttChartHistory from './ganttChartHistory';

const FETCH_MAX_DEPTH = 12; // stop after 12 levels
const FETCH_MAX_CALLS = 2000; // hard safety cap

export default class GanttChartLwc extends LightningElement {
    // ----------------------------------------------------
    // 1. PROPERTIES
    // ----------------------------------------------------

    // Labels
    labels = {
        TaostSuccess,
        TaostError,
        RecordsDeletedSuccessfully,
        DoYouWantToDeleteRecords,
        ConfirmDeleteMsg,
        InsertBefore,
        InsertAfter,
        AddChild,
        Task,
        StartDate,
        EndDate,
        Resource,
        ConfirmReloadMsg: GanttConfirmReload,
        UnsavedChangesWarning: GanttUnsavedChangesWarning,
        CircularDependencyLabel: GanttCircularDependency,
        CircularDependencyMsg: GanttCircularDependencyMsg,
        UpdateDependencyErrorMsg: GanttUpdateDependencyError,
        ReorderErrorTitle: GanttCannotReorder,
        AllTasksSameParentError: GanttAllTasksSameParent,
        InvalidMasterRecordConfig: 'Invalid Record Configuration',
        InvalidMasterRecordId: GanttInvalidMasterRecord,
        InconsistenciesDetectedLabel: GanttInconsistenciesDetected,
        AnomaliesFoundMsg: GanttAnomaliesFound,
        RuleConflictsLabel: GanttRuleConflicts,
        RuleConflictsConfirmMsg: GanttRuleConflictsConfirm,
        ChangesSavedSuccessfully: GanttChangesSaved,
        SyncFailedMessage: GanttSyncFailed
    };

    // API properties
    @api recordId;
    @api objectApiName;
    @api title;
    @api parentRecordId;
    @api canSelect;
    @api canReorder;
    @api canEdit;
    @api canDelete;
    @api enableChecklist;
    @api columns;
    @api showWorkHours;
    @api workDayStart;
    @api workDayEnd;
    @api hourSpan;
    @api workWeekStart;
    @api workWeekEnd;
    @api firstDayOfWeek;
    @api displayedTasks;
    @api slotSize;
    @api rowHeight;
    @api listPanelOpen;
    @api listPanelWidth;
    @api editorPanelOpen;
    @api editorPanelWidth;
    @api defaultView;
    @api defaultZoomLevel;
    @api iconName;
    @api taskProps;

    // Tracked properties
    @track taskManager;

    @track tasks;
    @track projectConfig = [];
    @track tasksConfig = [];
    @track configByObjectName = new Map();
    @track options = {};
    @track expandedRows = [];
    @track highlightedRows = [];
    @track selectedRows = [];
    missingRecords = [];
    @track objectsMetadata = {};
    selectedElement = null;
    selectedView = 'month';
    initialState = null;
    fullscreen = false;
    loading = false;
    scrollPosition = 0;

    masterRecordId;
    masterRecordData;
    masterRecordError;

    missingSettingMessage = '';
    refreshTimeout = null;
    saveDatabase = false;
    init = true;

    historyManager = null;

    // popover data
    popoverHideTimeout = null;
    popoverDataIgnoreMouseLeave = false;
    popoverData = {
        show: false,
        record: null,
        title: '',
        canDelete: false,
        popoverFields: '',
        iconName: '',
        top: 0,
        left: 0,
        height: 0
    };

    // ----------------------------------------------------
    // 2. LIFECYCLE HOOKS AND WIRE SERVICE
    // ----------------------------------------------------

    @wire(getRecord, {
        recordId: '$masterRecordId',
        layoutTypes: ['Full'],
        modes: ['View']
    })
    wiredRecord({ error, data }) {
        if (error) {
            this.masterRecordError = error;
            this.masterRecordData = null;
        } else if (data) {
            this.masterRecordData = data;
            this.masterRecordError = null;
        }
    }

    async connectedCallback() {
        try {
            await this.prepareConfig();
            await this.loadTasks();
            await this.loadBaselines();
            window.onbeforeunload = () => {
                if (this.historyManager.isDirty) {
                    return this.labels.UnsavedChangesWarning;
                }
                return null;
            };
        } catch (err) {
            console.error(err);
        }
    }

    async loadBaselines() {
        try {
            const baselines = await getObjectItems({
                objectName: 'gmpkg__GanttBaseline__c',
                objectFields: [
                    'Id',
                    'Name',
                    'gmpkg__Description__c',
                    'CreatedDate'
                ],
                filterBy: JSON.stringify({
                    gmpkg__GanttId__c: {
                        operator: '=',
                        value: this.masterRecordId
                    }
                }),
                orderBy: 'Name asc',
                rowLimit: 5000
            });
            this.refs.toolbar?.setBaselines(baselines);
        } catch (err) {
            console.error('Error loading baselines:', err);
        }
    }

    disconnectedCallback() {
        try {
            if (window && window.onbeforeunload) {
                window.onbeforeunload = null;
            }
        } catch (e) {
            //console.error(e)
        }
    }

    // ----------------------------------------------------
    // 3. GETTERS (COMPUTED PROPERTIES)
    // ----------------------------------------------------

    get treeColumns() {
        let getRowActions = (row, doneCallback) => {
            let actions = [];

            if (this.getSiblingsConfigs(row).length > 0) {
                actions.push(
                    {
                        label: this.labels.InsertBefore,
                        iconName: 'utility:add_above',
                        name: 'insert-before'
                    },
                    {
                        label: this.labels.InsertAfter,
                        iconName: 'utility:add_below',
                        name: 'insert-after'
                    }
                );
            }

            if (this.getChildrenConfigs(row).length > 0) {
                actions.push({
                    label: this.labels.AddChild,
                    iconName: 'utility:add',
                    name: 'add-child'
                });
            }

            doneCallback(actions);
        };

        return [
            {
                type: 'action',
                typeAttributes: { rowActions: getRowActions },
                cellAttributes: {
                    class: 'gm--actions'
                }
            },
            {
                type: 'button-icon',
                initialWidth: 50,
                typeAttributes: {
                    name: 'goto',
                    iconName: 'utility:arrow_right',
                    variant: 'bare'
                },
                cellAttributes: {
                    class: 'gm--goto'
                }
            },
            {
                type: 'text',
                fieldName: 'gm__key',
                initialWidth: 60,
                cellAttributes: {
                    class: 'gm--key'
                }
            },
            
            {
                treeColumn: true,
                type: 'text',
                label: this.labels.Task,
                fieldName: 'gm__title',
                initialWidth: 255,
                cellAttributes: {
                    iconName: { fieldName: 'gm__iconName' },
                    class: 'gm--task slds-tree__item slds-text-title_bold'
                },
                editable: { fieldName: 'gm__canEditName' }
            },
            {
                type: 'progress',
                label: '% completed',
                fieldName: 'gm__progress',
                initialWidth: 150,
                cellAttributes: {
                    class: 'gm--progress'
                }
            },
            {
                type: 'date',
                label: this.labels.StartDate,
                fieldName: 'gm__start',
                initialWidth: 200,
                typeAttributes: {
                    hour: { fieldName: 'gm__startTimeFormat' },
                    minute: { fieldName: 'gm__startTimeFormat' },
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone: TIMEZONE
                },
                cellAttributes: {
                    class: 'gm--startdate'
                },
                editable: { fieldName: 'gm__canEditStartTree' },
                sortable: true
            },
            {
                type: 'date',
                label: this.labels.EndDate,
                fieldName: 'gm__end',
                initialWidth: 200,
                typeAttributes: {
                    hour: { fieldName: 'gm__endTimeFormat' },
                    minute: { fieldName: 'gm__endTimeFormat' },
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone: TIMEZONE
                },
                cellAttributes: {
                    class: 'gm--enddate'
                },
                editable: { fieldName: 'gm__canEditEndTree' },
                sortable: true
            },
            {
                type: 'avatar-group',
                label: this.labels.Resource,
                fieldName: 'gm__resourceData',
                initialWidth: 150,
                typeAttributes: {
                    overlap: 10,
                    variant: 'circle',
                    maxVisible: 2
                },
                cellAttributes: {
                    class: 'gm--resource'
                }
            }
        ];
    }

    get dependencies() {
        return this.taskManager.dependencies;
    }

    get containerClass() {
        return this.fullscreen
            ? 'fullscreen'
            : 'gantt-container slds-is-relative';
    }

    get showNewGantt() {
        return this.options.initState === 'missingGantt';
    }

    get showTimeline() {
        return this.options.initState === 'success' || this.showNewGantt;
    }

    get showMissingSetting() {
        return this.options.initState === 'showMissingSetting';
    }

    // ----------------------------------------------------
    // 4. INITIALIZATION AND DATA FETCHING
    // ----------------------------------------------------

    async prepareConfig() {
        this.masterRecordId = this.parentRecordId || this.recordId;

        //Options
        this.options = {};
        this.options.title = this.title;
        this.options.iconName = this.iconName;
        this.options.canMultiSelect = Boolean(this.canSelect);
        this.options.canReorder = Boolean(this.canReorder);
        this.options.canEdit = Boolean(this.canEdit);
        this.options.canDelete = Boolean(this.canDelete);
        this.options.canCreate = true;

        this.options.enableChecklist = Boolean(this.enableChecklist);

        this.options.objectFields = {};
        this.options.columns = this.treeColumns;

        const allViews = ['day', 'week', 'month', 'year', 'full'];
        const hiddenViews = (this.columns || '')
            .split(',')
            .map((v) => v.trim().toLowerCase());

        this.options.views = allViews.filter((v) => {
            return !hiddenViews.includes(v);
        });

        this.options.showWorkHours = Boolean(this.showWorkHours);
        this.options.workDayStart = parseInt(this.workDayStart, 10) ?? 8;
        this.options.workDayEnd = parseInt(this.workDayEnd, 10) ?? 17;
        this.options.workWeekStart = parseInt(this.workWeekStart, 10) ?? 1;
        this.options.workWeekEnd = parseInt(this.workWeekEnd, 10) ?? 5;
        this.options.firstDayOfWeek = parseInt(this.firstDayOfWeek, 10) ?? 1;
        this.options.hourSpan = parseInt(this.hourSpan, 10) ?? 1;
        this.options.displayedTasks = parseInt(this.displayedTasks, 10) ?? 14;
        this.options.slotSize = parseInt(this.slotSize, 10) ?? 200;

        // Row Height Base = Row Height defined by user
        this.options.rowHeightBase = parseInt(this.rowHeight, 10) ?? 20;
        this.options.rowHeight = parseInt(this.rowHeight, 10) ?? 20;
        this.options.minGanttHeight = '300px';

        this.options.listWidth = this.listPanelWidth;
        this.options.editorWidth = 100 - this.editorPanelWidth;

        this.options.defaultLeftPanelOpen = Boolean(this.listPanelOpen);
        this.options.defaultRightPanelOpen = Boolean(this.editorPanelOpen);

        this.history = null;

        this.options.zoomLevels = [
            { value: 0.25, label: '25%' },
            { value: 0.5, label: '50%' },
            { value: 1, label: '100%' },
            { value: 2, label: '200%' }
        ];
        this.options.zoomLevel = parseInt(this.defaultZoomLevel, 10) / 100;
        this.selectedView = this.defaultView.toLowerCase();

        //Task Configs
        let taskProps;
        try {
            taskProps = JSON.parse(this.taskProps);
        } catch (e) {
            taskProps = [];
        }

        if (!Array.isArray(taskProps)) {
            this.tasksConfig = taskProps?.tasksConfig || [];
            this.options.projectConfig = taskProps?.projectConfig || [];
        } else {
            this.tasksConfig = taskProps;
        }

        if (this.tasksConfig.length === 0) {
            this.options.initState = 'showMissingSetting';
            this.missingSettingMessage = this.labels.InvalidMasterRecordConfig;
            return;
        }

        // Build config cache for O(1) lookups
        this.configByObjectName.clear();
        this.tasksConfig.forEach((config) => {
            this.configByObjectName.set(config.taskObjectApiName, config);
        });

        //get metadata
        let promises = this.tasksConfig.map((conf) => {
            return getGanttChartObjectMetadata({
                objectApiName: conf.taskObjectApiName
            });
        });

        let tasksResults = await Promise.all(promises);
        for (let i = 0; i < tasksResults.length; i++) {
            let { taskObjectApiName } = this.tasksConfig[i];
            let objectMeta = JSON.parse(tasksResults[i]);

            let fields = {};
            for (let field of objectMeta.fields) {
                fields[field.name] = field;
            }

            this.objectsMetadata[taskObjectApiName] = {
                canCreate: objectMeta.canCreate,
                canEdit: objectMeta.canEdit,
                canDelete: objectMeta.canDelete,
                fields
            };
        }

        if (this.options.projectConfig?.resourceConfig) {
            await this.loadProjectResources();
        }
        //Task Manager
        this.taskManager = new GanttTaskManager();
        this.taskManager.objectsMetadata = this.objectsMetadata;
        this.taskManager.selectedView = this.selectedView;

        // Build and store detailFields for each object type (once)
        this.tasksConfig.forEach((conf) => {
            const fields = [];
            const md = this.objectsMetadata[conf.taskObjectApiName];

            if (md && conf.taskDetailFields?.length > 0) {
                for (const fieldName of conf.taskDetailFields) {
                    const fieldMetadata = md.fields[fieldName];
                    if (fieldMetadata) {
                        fields.push(fieldMetadata);
                    }
                }
            }

            this.taskManager.setDetailFields(conf.taskObjectApiName, fields);
        });

        //Gantt Data
        await this.getGanttData();
    }

    async getGanttData() {
        try {
            await getGantt({ ganttId: this.masterRecordId });
            this.options.initState = 'success';
        } catch (err) {
            if (this.masterRecordId) {
                this.options.initState = 'missingGantt';
            } else {
                this.options.initState = 'showMissingSetting';
                this.missingSettingMessage = this.labels.InvalidMasterRecordId;
            }

            // Initialize history if not already done
            if (!this.historyManager) {
                this.initializeHistory();
            }

            await this.checkSync();
            if (this.missingRecords.length > 0) {
                await this.insertMissingTasksByLevel();
            }
            throw err;
        }
    }

    async createGantt() {
        if (this.masterRecordId) {
            try {
                // check if provided ganttId valid
                this.loading = true;
                let apiName = this.masterRecordData?.apiName;

                if (!apiName) {
                    throw new Error('Invalid Master Record configuration');
                }

                await createRecord({
                    apiName: 'gmpkg__Gantt__c',
                    fields: {
                        Name: this.title || 'New Gantt',
                        gmpkg__DeveloperName__c: this.masterRecordId
                    }
                });

                await this.handleSave();
                await this.getGanttData();
            } catch (err) {
                console.log(JSON.stringify(err));
                console.error(err);
            } finally {
                this.loading = false;
            }
        }
    }

    async loadTasks() {
        this.loading = true;
        this.saveDatabase = false;
        this.history = null;

        try {
            let elements = await getGanttElements({
                ganttId: this.masterRecordId
            });
            let elementIds = elements.map((e) => e.Id);

            let promises = this.tasksConfig.map((conf) => {
                return this.loadTasksFromConfig(conf, elements);
            });

            let tasksResults = await Promise.all(promises);

            let tasks = [];
            for (let i = 0; i < tasksResults.length; i++) {
                let { taskObjectApiName } = this.tasksConfig[i];

                let result = tasksResults[i] || [];
                let mapped = await this.mapElementToTasks(
                    result,
                    elements,
                    taskObjectApiName
                );
                tasks.push(...mapped);
            }

            this.taskManager.dependencies = await getDependencies({
                taskIds: elementIds
            });
            this.taskManager.tasks = tasks;

            this.taskManager.normalizeAllTasks();

            setTimeout(() => {
                this.checkSync();
            }, 100);

            this.refreshUI('FULL_REFRESH');
            this.initializeHistory();
        } catch (err) {
            console.error(err);
        } finally {
            this.loading = false;
        }
    }

    initializeHistory() {
        this.historyManager = new GanttChartHistory(this.taskManager, {
            checkpointInterval: 10,
            maxHistory: 50,
            onStateChange: (state) => {
                this.options = {
                    ...this.options,
                    canUndo: state.canUndo,
                    canRedo: state.canRedo,
                    historyIndex: state.historyIndex
                };
            }
        });

        this.historyManager.initialize(() => this.captureCurrentState());
    }

    async loadTasksFromConfig(conf, elements) {
        try {
            let fields = [
                conf.titleFieldName,
                conf.fromDateFieldName,
                conf.toDateFieldName,
                conf.progressFieldName,
                conf.ownerFieldName
            ];

            // If taskColor is an array of conditions, add exp fields to query
            if (conf.taskColor && Array.isArray(conf.taskColor)) {
                conf.taskColor.forEach((colorConf) => {
                    if (colorConf.exp) {
                        // Extract fields from exp conditions
                        Object.keys(colorConf.exp).forEach((field) => {
                            if (!fields.includes(field)) {
                                fields.push(field);
                            }
                        });
                    }
                });
            }

            if (conf.taskRules && Array.isArray(conf.taskRules)) {
                conf.taskRules.forEach((rule) => {
                    [rule.dateField1, rule.dateField2]
                        .filter(Boolean)
                        .forEach((f) => {
                            if (!fields.includes(f)) {
                                fields.push(f);
                            }
                        });
                });
            }

            if (conf.taskDetailFields?.length > 0) {
                fields = fields.concat(conf.taskDetailFields);
            }
            if (conf.taskPopoverFields?.length > 0) {
                fields = fields.concat(conf.taskPopoverFields);
            }

            fields = [...new Set(fields.filter((f) => f))];

            // Root load
            let ids = elements
                .filter(
                    (e) => conf.taskObjectApiName === e.gmpkg__SObjectType__c
                )
                .map((e) => e.gmpkg__Id__c);

            //Build filter
            let filterBy = {
                Id: {
                    operator: 'in',
                    value: `('${ids.join("','")}')`
                }
            };

            if (conf.filter) {
                let jsonFilter = JSON.stringify(conf.filter);
                if (this.masterRecordId) {
                    jsonFilter = jsonFilter.replace(
                        /\$recordId/g,
                        this.masterRecordId
                    );
                }
                filterBy = { and: [JSON.parse(jsonFilter), filterBy] };
            }

            // --- Fetch records
            let ganttTasks = await getObjectItems({
                objectName: conf.taskObjectApiName,
                objectFields: fields,
                filterBy: JSON.stringify(filterBy),
                sortBy: conf.fromDateFieldName,
                orderBy: 'asc',
                rowLimit: 5000,
                rowOffset: 0
            });

            return ganttTasks;
        } catch (err) {
            console.error(err);
            throw err.body?.exceptionType && err.body?.message
                ? `[ ${err.body.exceptionType} ] : ${err.body.message}`
                : JSON.stringify(err);
        }
    }

    async loadProjectResources() {
        const resourceConfigs = this.options.projectConfig?.resourceConfig;
        if (!Array.isArray(resourceConfigs) || resourceConfigs.length === 0) {
            this.options.availableResources = [];
            return;
        }

        const allResources = [];

        // Loop through each resource config
        for (const resourceConf of resourceConfigs) {
            const {
                objectApiName,
                titleField,
                subtitleField,
                avatarUrlField,
                filter
            } = resourceConf;

            // --- Collect fields to query
            const fields = ['Id'];
            [titleField, subtitleField, avatarUrlField]
                .filter(Boolean)
                .forEach((f) => {
                    if (!fields.includes(f)) {
                        fields.push(f);
                    }
                });

            // --- Build filter
            let filterBy = {};
            if (filter) {
                let jsonFilter = JSON.stringify(filter);
                if (this.masterRecordId) {
                    jsonFilter = jsonFilter.replace(
                        /\$recordId/g,
                        this.masterRecordId
                    );
                }
                filterBy = JSON.parse(jsonFilter);
            }

            try {
                // --- Fetch records
                const projectResources = await getObjectItems({
                    objectName: objectApiName,
                    objectFields: fields,
                    filterBy: JSON.stringify(filterBy),
                    sortBy: 'LastModifiedDate',
                    orderBy: 'desc',
                    rowLimit: 5000,
                    rowOffset: 0
                });

                if (projectResources && projectResources.length > 0) {
                    // --- Map resources with type from label
                    const mappedResources = projectResources.map((r) => ({
                        gm__resourceId: r.Id,
                        title: this.getNestedValue(r, titleField),
                        subtitle: this.getNestedValue(r, subtitleField),
                        src: this.getNestedValue(r, avatarUrlField),
                        objectApiName: objectApiName
                    }));

                    allResources.push(...mappedResources);
                }
            } catch (error) {
                console.error(
                    `Error loading resources for ${objectApiName}:`,
                    error
                );
            }
        }

        this.options.availableResources = allResources;
    }

    async fetchTasksRecursive(
        config,
        parentIds = null,
        depth = 0,
        recursionGuard
    ) {
        // Initialize recursion tracking on first call
        if (!recursionGuard) {
            recursionGuard = {
                seen: new Set(),
                calls: 0,
                recordLevels: new Map()
            };
        }

        // Safety checks to prevent infinite recursion
        recursionGuard.calls++;

        if (recursionGuard.calls > FETCH_MAX_CALLS) {
            console.warn('[fetchTasksRecursive] Aborted: too many calls');
            return [];
        }

        if (depth > FETCH_MAX_DEPTH) {
            console.warn('[fetchTasksRecursive] Max depth reached:', depth);
            return [];
        }

        // Build unique query key to avoid duplicate fetches
        let sortedParentIds = '';
        if (Array.isArray(parentIds)) {
            sortedParentIds = parentIds.slice().sort().join(',');
        }

        const queryKey = `${config.taskObjectApiName}|${config._parentFieldName}|${sortedParentIds}`;

        if (recursionGuard.seen.has(queryKey)) {
            return [];
        }

        recursionGuard.seen.add(queryKey);

        // Collect all required fields for the query
        const allFields = [
            config.titleFieldName,
            config.fromDateFieldName,
            config.toDateFieldName,
            config.progressFieldName,
            config.ownerFieldName,
            config.orderFieldName,
            config._parentFieldName,
            ...(config.taskDetailFields || []),
            ...(config.taskPopoverFields || [])
        ];
        const uniqueFields = [...new Set(allFields.filter(Boolean))];

        // Build query filters
        const filters = [];

        if (config.filter) {
            let filterJson = JSON.stringify(config.filter);

            if (this.masterRecordId) {
                filterJson = filterJson.replace(
                    /\$recordId/g,
                    this.masterRecordId
                );
            }

            filters.push(JSON.parse(filterJson));
        }

        if (parentIds && parentIds.length > 0 && config._parentFieldName) {
            filters.push({
                [config._parentFieldName]: {
                    operator: 'in',
                    value: `('${parentIds.join("','")}')`
                }
            });
        }

        let filterBy = {};
        if (filters.length === 1) {
            filterBy = filters[0];
        } else if (filters.length > 1) {
            filterBy = { and: filters };
        }

        // Fetch records from database
        const records = await getObjectItems({
            objectName: config.taskObjectApiName,
            objectFields: uniqueFields,
            filterBy: JSON.stringify(filterBy),
            sortBy: config.fromDateFieldName,
            orderBy: 'asc',
            rowLimit: 5000,
            rowOffset: 0
        });

        if (!records || records.length === 0) {
            return [];
        }

        // Store raw records with their hierarchy level
        for (const record of records) {
            const recordId = record.Id;
            const existingEntry = recursionGuard.recordLevels.get(recordId);

            let shouldKeepThisLevel = false;
            if (!existingEntry) {
                shouldKeepThisLevel = true;
            } else if (depth > existingEntry.level) {
                shouldKeepThisLevel = true;
            }

            if (shouldKeepThisLevel) {
                recursionGuard.recordLevels.set(recordId, {
                    level: depth,
                    parentField: config._parentFieldName,
                    apiName: config.taskObjectApiName,
                    rawRecord: record
                });
            }
        }

        // Recursively fetch child records
        const acceptedChildren = config.acceptedChildren || [];

        for (const childDef of acceptedChildren) {
            const { apiName: childObjectApiName, parentFieldName } = childDef;
            const childConfig = this.configByObjectName.get(childDef.apiName);
            if (!childConfig) {
                continue;
            }

            const isSelfReference =
                childObjectApiName === config.taskObjectApiName &&
                parentFieldName === config._parentFieldName;
            const wouldExceedDepth = depth + 1 > FETCH_MAX_DEPTH;

            if (isSelfReference && wouldExceedDepth) {
                continue;
            }

            const childConfigWithMetadata = {
                ...childConfig,
                _parentFieldName: childDef.parentFieldName,
                filter: {
                    ...(childConfig.filter || {}),
                    ...(childDef.filter || {})
                }
            };

            const childParentIds = records.map((r) => r.Id);

            await this.fetchTasksRecursive(
                childConfigWithMetadata,
                childParentIds,
                depth + 1,
                recursionGuard
            );
        }

        // Process all fetched records only at root level
        if (depth === 0) {
            const finalTasks = [];
            const taskMap = new Map();

            // Convert raw records to task objects
            for (const [recordId, entry] of recursionGuard.recordLevels) {
                const task = this.mapObjectToTask(
                    entry.rawRecord,
                    entry.apiName
                );

                task._level = entry.level;
                task._parentFieldName = entry.parentField;
                task._rawParentId = entry.rawRecord[entry.parentField];

                taskMap.set(recordId, task);
                finalTasks.push(task);
            }

            // Link tasks to their parents
            for (const task of finalTasks) {
                const rawParentId = task._rawParentId;
                task.gm__parentId = null;

                if (rawParentId) {
                    let parentTask = taskMap.get(rawParentId);

                    // if parent is not a new task, find in existing tasks
                    if (!parentTask) {
                        parentTask = this.taskManager.tasks.find(
                            (t) => t.gm__recordId === rawParentId
                        );
                    }

                    if (parentTask) {
                        if (parentTask.gm__elementId) {
                            task.gm__parentId = parentTask.gm__elementId;
                        } else {
                            task.gm__parentId = parentTask.Id;
                        }
                    }
                }

                delete task._rawParentId;
            }

            return finalTasks;
        }

        return [];
    }

    async checkSync() {
        const allFetchedTasks = await this.fetchTasksRecursive(
            this.tasksConfig[0]
        );

        const currentGanttTaskIds = new Set(
            this.taskManager.tasks.map((task) => task.Id)
        );
        const fetchedTaskIds = new Set(allFetchedTasks.map((task) => task.Id));

        const deletedTaskIds = [...currentGanttTaskIds].filter(
            (taskId) => !fetchedTaskIds.has(taskId)
        );

        const missingTaskIds = [...fetchedTaskIds].filter(
            (taskId) => !currentGanttTaskIds.has(taskId)
        );

        const missingTaskRecords = allFetchedTasks.filter((task) =>
            missingTaskIds.includes(task.Id)
        );

        if (missingTaskRecords.length > 0) {
            this.options.elementToSync = missingTaskRecords.length;
            this.missingRecords = missingTaskRecords;
        } else {
            this.options.elementToSync = 0;
            this.missingRecords = [];
        }
    }

    async insertMissingTasksByLevel() {
        setTimeout(() => {
            this.loading = true;
        }, 0);

        if (!this.missingRecords || this.missingRecords.length === 0) {
            console.log('No missing records to insert');
            return;
        }

        // Group records by their hierarchy level
        let recordsByLevel = {};
        for (let record of this.missingRecords) {
            if (!recordsByLevel[record._level]) {
                recordsByLevel[record._level] = [];
            }
            recordsByLevel[record._level].push(record);
        }

        // Sort levels in ascending order
        let sortedLevels = Object.keys(recordsByLevel)
            .map((levelStr) => parseInt(levelStr, 10))
            .sort((a, b) => a - b);

        // Process each level sequentially
        for (let currentLevel of sortedLevels) {
            let recordsAtLevel = recordsByLevel[currentLevel];
            let newElementsAtLevel = {};

            // Prepare elements for this level
            let elementsToSave = recordsAtLevel.map((record) => {
                let existingElement = this.taskManager.getTaskByRecordId(
                    record.Id
                );

                let parentRecord = this.taskManager.getTaskByRecordId(
                    record[record._parentFieldName]
                );

                return {
                    Name: record?.Name || 'New element',
                    gm__elementUID: existingElement?.gm__elementUID,
                    gmpkg__Parent__c:
                        parentRecord?.gm__elementId ?? parentRecord?.Id, // if exist map by element Id, if new Id
                    gmpkg__Order__c: 999,
                    gmpkg__Id__c: record.Id,
                    gmpkg__GanttId__c: this.masterRecordId,
                    gmpkg__SObjectType__c: record.gm__objectApiName,
                    attributes: { type: 'gmpkg__GanttElement__c' }
                };
            });

            // Group by object type
            for (let record of recordsAtLevel) {
                let matchingElement = elementsToSave.find(
                    (element) =>
                        element.gmpkg__Id__c === record.Id &&
                        element.gmpkg__SObjectType__c ===
                            record.gm__objectApiName
                );

                if (matchingElement) {
                    if (!newElementsAtLevel[record.gm__objectApiName]) {
                        newElementsAtLevel[record.gm__objectApiName] = {
                            records: [],
                            elements: []
                        };
                    }

                    newElementsAtLevel[record.gm__objectApiName].records.push(
                        record
                    );
                    newElementsAtLevel[record.gm__objectApiName].elements.push(
                        matchingElement
                    );
                }
            }

            // Map elements to tasks and add to manager
            let tasksAtLevel = [];
            for (let [objectApiName, data] of Object.entries(
                newElementsAtLevel
            )) {
                let mappedTasks = await this.mapElementToTasks(
                    data.records,
                    data.elements,
                    objectApiName
                );
                tasksAtLevel.push(...mappedTasks);
            }

            if (tasksAtLevel.length > 0) {
                this.taskManager.addTasks(tasksAtLevel);
            }
        }

        // Track the new state after all tasks added
        this.historyManager.track('addTask');

        this.options.elementToSync = 0;
        this.missingRecords = [];

        await this.syncAndRefresh('TASK_ADDED');
    }

    // ----------------------------------------------------
    // 5. UI EVENT HANDLERS
    // ----------------------------------------------------

    handleTreeScroll(event) {
        this.scrollPosition = event.detail.scrollTop;
    }

    handleTimelineScroll(event) {
        this.scrollPosition = event.detail.scrollTop;
    }

    handleEditorAction(event) {
        let { action, value } = event.detail;

        switch (action) {
            case 'saveChecklist': {
                this.saveChecklist(value);
                break;
            }
            case 'updateTask': {
                this.updateTask(value);
                break;
            }
            case 'deleteTask': {
                this.deleteTask([value.gm__elementUID]);
                break;
            }
            case 'createRule': {
                this.createRule(value);
                break;
            }
            case 'updateRule': {
                this.updateRule(value);
                break;
            }
            case 'deleteRule': {
                this.deleteRule(value);
                break;
            }
            case 'deleteDependency': {
                this.deleteDependency(value, true);
                break;
            }
            case 'updateDependency': {
                this.upsertDependency(value, 'delay');
                break;
            }

            default:
                break;
        }
    }

    async handleToolbarAction(event) {
        let { action, value } = event.detail;

        switch (action) {
            case 'handleDelete':
                this.deleteTask(this.selectedRows);
                break;
            case 'handleReorder':
                this.reorderTasks(value);
                break;
            case 'handleExpandAll':
                this.toggleExpandAll(true);
                break;
            case 'handleCollapseAll':
                this.toggleExpandAll(false);
                break;
            case 'handleChangeDate': {
                this.refs.timeline?.goToDate(new Date(value));
                break;
            }
            case 'handleSaveHistory': {
                this.handleSave();
                break;
            }
            case 'handleRefresh': {
                if (this.historyManager.isDirty) {
                    let confirm = await LightningConfirm.open({
                        message: this.labels.ConfirmReloadMsg,
                        variant: 'headerless'
                    });
                    if (!confirm) {
                        return;
                    }
                }
                this.loadTasks();
                break;
            }
            case 'handleUndoHistory': {
                this.handlePrevious();
                break;
            }
            case 'handleRedoHistory': {
                this.handleNext();
                break;
            }
            case 'toggleFullscreen':
                this.toggleFullscreen();
                break;

            case 'toggleLeftPanel': {
                this.refs.splitTree?.toggleSplitView();
                break;
            }
            case 'handleSync': {
                try {
                    this.insertMissingTasksByLevel();
                } catch (e) {
                    this.handleServerError(e);
                    this.loading = false;
                }
                break;
            }
            case 'toggleRightPanel': {
                this.refs.splitEditor?.toggleSplitView();
                break;
            }
            case 'handleViewChange': {
                this.selectedView = undefined;

                window.requestAnimationFrame(() => {
                    this.selectedView = value;
                    this.taskManager.selectedView = value;
                });

                break;
            }
            case 'handleZoom': {
                this.options = {
                    ...this.options,
                    zoomLevel: value
                };
                break;
            }
            case 'toggleAutoHScroll': {
                this.options = {
                    ...this.options,
                    enableHScroll: !this.options.enableHScroll
                };
                break;
            }
            case 'toggleCriticalPath': {
                this.options = {
                    ...this.options,
                    showCriticalPath: value
                };

                break;
            }
            case 'addBaseline': {
                let res = await recordFormModal.open({
                    objectApiName: 'gmpkg__GanttBaseline__c',
                    fields: ['Name', 'gmpkg__Description__c'],
                    title: 'Add Baseline',
                    size: 'small'
                });

                if (res && res.action === 'submit') {
                    this.handleBaselineSave(res.fieldValues);
                }

                break;
            }
            case 'baselineChanged': {
                await this.loadBaselineData(value);
                break;
            }
            default:
                throw new Error('Not imeplemented');
        }
    }

    async handleBaselineSave(baseline) {
        try {
            this.loading = true;
            const snapshot = JSON.stringify(
                Object.fromEntries(
                    this.taskManager.tasks.map((t) => [
                        t.Id,
                        { start: t.gm__start, end: t.gm__end }
                    ])
                )
            );

            const newBaseline = Object.assign(baseline, {
                gmpkg__GanttId__c: this.masterRecordId,
                gmpkg__Snapshot__c: snapshot,
                attributes: { type: 'gmpkg__GanttBaseline__c' }
            });

            await saveRelatedItems({ jsonData: JSON.stringify([newBaseline]) });

            await this.loadBaselines();
            this.showToast('success', 'Success', 'Baseline saved successfully');
        } catch (err) {
            this.showToast('error', 'Error', 'Failed to save baseline');
            console.error('Error saving baseline:', err);
        } finally {
            this.loading = false;
        }
    }

    async loadBaselineData(baselineId) {
        if (!baselineId) {
            this.taskManager.baselineData = null;

            // reset row height to base value
            this.options.rowHeight = this.options.rowHeightBase;
            this.refs.timeline.refreshTasks('DELETE_BASELINE');
            this.refs.tree.refreshTasks();
            return;
        }

        const filterBy = {
            Id: {
                operator: '=',
                value: baselineId
            }
        };

        try {
            this.loading = true;
            const baseline = await getObjectItems({
                objectName: 'gmpkg__GanttBaseline__c',
                objectFields: ['Id', 'gmpkg__Snapshot__c'],
                filterBy: JSON.stringify(filterBy),
                orderBy: 'asc',
                rowLimit: 5000
            });

            const snapshot = baseline[0].gmpkg__Snapshot__c;
            this.taskManager.baselineData = JSON.parse(snapshot);

            // add 5 to row height to accommodate baseline bar
            this.options.rowHeight = this.options.rowHeightBase + 5;
            this.refs.timeline.refreshTasks('LOAD_BASELINE');
            this.refs.tree.refreshTasks();
        } catch (err) {
            console.error('Error loading baseline data:', err);
        } finally {
            this.loading = false;
        }
    }

    async handleTreeRowAction(event) {
        let { action, value } = event.detail;

        switch (action) {
            case 'highlight': {
                this.highlightedRows = value;
                break;
            }
            case 'toggle': {
                let { name, isExpanded } = value;
                this.toggleExpanded(name, isExpanded);
                break;
            }
            case 'add-child': {
                this.addTask(action, value);
                break;
            }
            case 'insert-before': {
                this.addTask(action, value);
                break;
            }
            case 'insert-after': {
                this.addTask(action, value);
                break;
            }
            case 'updateTask': {
                await this.updateTask(value);
                break;
            }
            case 'reorderRows': {
                await this.updateTask(value);
                await this.syncAndRefresh('TASKS_REORDERED');
                break;
            }
            case 'select': {
                this.selectedRows = value;
                this.refreshEditor();
                break;
            }
            case 'goto': {
                let { gm__elementUID } = value;
                this.refs.timeline.goToTask(gm__elementUID);
                break;
            }
            case 'sort': {
                const { sortDirection, sortedBy } = value;
                await this.reorderAllTasks(sortedBy, sortDirection);
                break;
            }
            default:
                break;
        }
    }

    async handleTimelineRowAction(event) {
        let { action, value } = event.detail;

        switch (action) {
            case 'select': {
                this.selectedRows = value || [];
                this.refreshEditor();
                break;
            }
            case 'updateTask': {
                await this.updateTask(value);
                break;
            }
            case 'createDependency': {
                await this.upsertDependency(value, 'type');
                break;
            }
            case 'deleteDependency': {
                await this.deleteDependency(value);
                break;
            }
            case 'changeViewZoom': {
                this.selectedView = value.viewType;
                this.options = { ...this.options, zoomLevel: value.zoomLevel };
                break;
            }
            case 'deleteTask': {
                this.deleteTask([value.gm__elementUID]);
                break;
            }
            default:
                break;
        }
    }

    // ----------------------------------------------------
    // 6. CORE BUSINESS LOGIC (CRUD)
    // ----------------------------------------------------
    async saveChecklist(update) {
        const task = this.taskManager.getTaskById(update.gm__elementUID);
        const taskId = task.gm__elementId;
        task.gm__checkList = update.checkList.items;

        const payload = {
            Id: taskId,
            gmpkg__Checklist__c: JSON.stringify(update.checkList),
            attributes: { type: 'gmpkg__GanttElement__c' }
        };

        await saveRelatedItems({ jsonData: JSON.stringify([payload]) });
    }

    async updateTask(updates) {
        this.loading = true;
        try {
            let updatesList = Array.isArray(updates) ? updates : [updates];
            updatesList = updatesList.filter((u) => u?.gm__elementUID);

            if (updatesList.length === 0) return;

            for (let update of updatesList) {
                const uid = update.gm__elementUID;
                const task = this.taskManager.getTaskById(uid);
                if (!task) continue;

                // Check dependencies if dates changed
                if (update.gm__start || update.gm__end) {
                    const { canProceed, violatedDependencies, anomalies } =
                        await this.taskManager.checkRulesBeforeUpdate(
                            uid,
                            update
                        );

                    if (canProceed === false) {
                        if (anomalies?.length > 0) {
                            this.showToast(
                                'warning',
                                this.labels.InconsistenciesDetectedLabel,
                                this.labels.AnomaliesFoundMsg.replace(
                                    '###',
                                    anomalies.length
                                )
                            );
                            continue;
                        }

                        if (violatedDependencies?.length > 0) {
                            const ok = await LightningConfirm.open({
                                label: this.labels.RuleConflictsLabel,
                                theme: 'warning',
                                message:
                                    this.labels.RuleConflictsConfirmMsg.replace(
                                        '###',
                                        violatedDependencies.length
                                    )
                            });

                            if (!ok) continue;
                            this.removeViolatedDependencies(
                                violatedDependencies
                            );
                        }
                    }
                }

                // Apply the change
                this.taskManager.updateTask(uid, update);

                // Recalculate task color after update
                this.recalculateTaskColor(task);
            }

            // Track the new state
            this.historyManager.track('updateTask');

            await this.syncAndRefresh('TASK_UPDATED');
        } catch (err) {
            console.error('Error in updateTask:', err);
            const msg = this.handleServerError(err);
            this.showToast('error', this.labels.TaostError, msg);
        } finally {
            this.loading = false;
        }
    }

    async deleteTask(taskIds) {
        if (taskIds.length < 1) return;

        const confirm = await LightningConfirm.open({
            message: this.labels.ConfirmDeleteMsg,
            variant: 'headerless'
        });

        if (confirm !== true) return;

        try {
            this.loading = true;

            let isTask = this.taskManager.tasks.findIndex((t) =>
                taskIds.includes(t.gm__elementUID)
            );

            if (isTask !== -1) {
                this.taskManager.deleteTasks(taskIds);
            }
            this.taskManager.deleteDependencies(taskIds);

            // Track the new state
            if (isTask !== -1) {
                this.historyManager.track('deleteTask');
                await this.syncAndRefresh('TASK_DELETED');
            } else {
                this.historyManager.track('deleteDependency');
                await this.syncAndRefresh('DEPENDENCY_DELETED');
            }

            this.selectedRows = [];

            this.showToast(
                'success',
                this.labels.TaostSuccess,
                this.labels.RecordsDeletedSuccessfully
            );
        } catch (err) {
            console.error(err);
            const errMsg = this.handleServerError(err);
            this.showToast('error', this.labels.TaostError, errMsg);
        } finally {
            this.loading = false;
        }
    }

    async addTask(type, row, occurences = 1) {
        let relatedConfigs = this.tasksConfig;
        let task = this.taskManager.tasks.find((t) => t.Id === row?.Id);
        let parentTask = null;
        let order = row?.gm__orderId;

        if (this.taskManager.tasks.length > 0) {
            parentTask = this.taskManager.tasks[0];
        }

        switch (type) {
            case 'add-child': {
                relatedConfigs = this.getChildrenConfigs(row);
                parentTask = row;
                order = row?.gm__children.length;
                break;
            }
            case 'insert-before': {
                relatedConfigs = this.getSiblingsConfigs(row);
                parentTask = this.taskManager.getTaskParent(row);
                order = row?.gm__orderId;
                break;
            }
            case 'insert-after': {
                relatedConfigs = this.getSiblingsConfigs(row);
                parentTask = this.taskManager.getTaskParent(row);
                order = row?.gm__orderId + 1;
                break;
            }
            case 'add-multiple': {
                break;
            }

            default:
                return;
        }

        let objectConfigs = relatedConfigs.map((config) => {
            let startDate = task?.[config.fromDateFieldName]
                ? new Date(task[config.fromDateFieldName]).toISOString()
                : new Date().toISOString();

            let endDate = task?.[config.toDateFieldName]
                ? new Date(task[config.toDateFieldName]).toISOString()
                : new Date().toISOString();

            // Build default values
            let defaultValues = {
                [config.titleFieldName]: {
                    value: null,
                    required: true,
                    disabled: false
                },
                [config.progressFieldName]: {
                    value: 0,
                    required: true,
                    disabled: false
                },
                [config.fromDateFieldName]: {
                    value: startDate,
                    required: true,
                    disabled: false
                },
                [config.toDateFieldName]: {
                    value: endDate,
                    required: true,
                    disabled: false
                },
                ...(config.orderFieldName
                    ? {
                          [config.orderFieldName]: {
                              value: order,
                              required: true,
                              disabled: false
                          }
                      }
                    : {}),
                ...(config.defaultValues || {})
            };

            if (parentTask) {
                if (parentTask) {
                    // Find parent config
                    let parentConf = this.configByObjectName.get(
                        parentTask.gm__objectApiName
                    );

                    if (parentConf) {
                        // Find child definition in parent's acceptedChildren
                        let childDef = parentConf.acceptedChildren?.find(
                            (child) =>
                                child.apiName === config.taskObjectApiName
                        );

                        if (childDef?.parentFieldName) {
                            defaultValues[childDef.parentFieldName] = {
                                value: parentTask?.Id,
                                required: false,
                                disabled: false
                            };
                        }
                    }
                }
            }

            return {
                name: config.taskObjectApiName,
                icon: config.taskIconName,
                defaultValues: defaultValues
            };
        });

        const result = await newRecordModal.open({
            objectConfigs,
            parentTask,
            ganttId: this.masterRecordId,
            occurences,
            order,
            size: 'medium'
        });

        if (result && result.status === 'success') {
            const { elements, records, objectApiName } = result;

            const tasks = await this.mapElementToTasks(
                records,
                elements,
                objectApiName
            );

            this.taskManager.addTasks(tasks);

            // Track the new state
            this.historyManager.track('addTask');

            if (type === 'add-child' && parentTask) {
                this.toggleExpanded(parentTask.gm__elementUID, true);
            }

            await this.syncAndRefresh('TASK_ADDED');
        }
    }

    async upsertDependency(dependency) {
        this.loading = true;

        try {
            const { gm__predecessorUID: predUID, gm__successorUID: succUID } =
                dependency;

            const existingDep = this.taskManager.dependencies?.find((d) => {
                const {
                    gm__predecessorUID: exPredUID,
                    gm__successorUID: exSuccUID
                } = d;
                return (
                    (exPredUID === predUID && exSuccUID === succUID) ||
                    (exPredUID === succUID && exSuccUID === predUID)
                );
            });

            if (
                !existingDep &&
                this.taskManager.wouldCreateCycle(predUID, succUID)
            ) {
                await LightningAlert.open({
                    label: this.labels.CircularDependencyLabel,
                    theme: 'error',
                    message: this.labels.CircularDependencyMsg
                });
                return;
            }

            const depUID =
                existingDep?.gm__dependencyUID ||
                `dep_${Date.now()}_${Math.random()}`;

            const depData = {
                gm__dependencyUID: depUID,
                gmpkg__Type__c: dependency.gmpkg__Type__c,
                gmpkg__Delay__c: dependency.gmpkg__Delay__c || 'immediate',
                gmpkg__DelaySpan__c: dependency.gmpkg__DelaySpan__c || 0,
                gmpkg__DelaySpanType__c:
                    dependency.gmpkg__DelaySpanType__c || 'days',
                gmpkg__PredecessorId__c: dependency.gmpkg__PredecessorId__c,
                gmpkg__SuccessorId__c: dependency.gmpkg__SuccessorId__c,
                gm__predecessorUID: predUID,
                gm__successorUID: succUID
            };

            if (existingDep) {
                Object.assign(existingDep, depData);
                // Force reactivity by creating new array reference
                this.taskManager.dependencies = [
                    ...this.taskManager.dependencies
                ];
            } else {
                const newDep = { ...depData, Id: null };
                this.taskManager.dependencies = [
                    ...(this.taskManager.dependencies || []),
                    newDep
                ];
            }

            this.taskManager.enforceSingleDependency(
                existingDep ||
                    this.taskManager.dependencies[
                        this.taskManager.dependencies.length - 1
                    ]
            );

            // Track the new state
            this.historyManager.track(
                existingDep ? 'updateDependency' : 'addDependency'
            );

            await this.syncAndRefresh('DEPENDENCY_UPDATED');
        } catch (err) {
            console.error('Error upserting dependency:', err);
            this.showToast(
                'error',
                'Error',
                this.labels.UpdateDependencyErrorMsg
            );
        } finally {
            this.loading = false;
        }
    }

    async deleteDependency(dependencyUID, keepSelection) {
        this.loading = true;
        try {
            const confirm = await LightningConfirm.open({
                message: this.labels.ConfirmDeleteMsg,
                variant: 'headerless'
            });

            if (confirm) {
                this.taskManager.deleteDependencies([dependencyUID]);
                if (!keepSelection) {
                    this.selectedRows = [];
                }

                // Track the new state
                this.historyManager.track('deleteDependency');

                await this.syncAndRefresh('DEPENDENCY_DELETED');
            }
        } catch (err) {
            console.error(err);
        } finally {
            this.loading = false;
        }
    }

    async createRule(payload) {
        const taskUID = payload.gm__elementUID;
        const task = this.taskManager.getTaskById(taskUID);

        const ruleUID =
            payload.gm__ruleUID || `rule_${Date.now()}_${Math.random()}`;
        payload.gm__ruleUID = ruleUID;

        task.gm__rules.push(payload);
        this.taskManager.updateTask(taskUID, {});

        this.historyManager.track('addRule');
        await this.syncAndRefresh('RULE_ADDED');
    }

    async updateRule(payload) {
        const ruleUID = payload.gm__ruleUID;
        const taskUID = payload.gm__elementUID;
        const task = this.taskManager.getTaskById(taskUID);
        const rule = task.gm__rules.find((r) => r.gm__ruleUID === ruleUID);

        Object.assign(rule, payload);
        this.taskManager.updateTask(taskUID, {});

        this.historyManager.track('updateRule');
        await this.syncAndRefresh('RULE_UPDATED');
    }

    async deleteRule(payload) {
        const confirm = await LightningConfirm.open({
            message: this.labels.ConfirmDeleteMsg,
            variant: 'headerless'
        });

        if (confirm !== true) return;

        const ruleUID = payload.gm__ruleUID;
        const taskUID = payload.gm__elementUID;
        const task = this.taskManager.getTaskById(taskUID);

        task.gm__rules = task.gm__rules.filter(
            (r) => r.gm__ruleUID !== ruleUID
        );
        this.taskManager.updateTask(taskUID, {});

        this.historyManager.track('deleteRule');
        await this.syncAndRefresh('RULE_DELETED');
    }

    async reorderTasks(action) {
        try {
            if (!this.selectedRows.length) return;

            let flatTree = this.taskManager.getFlattenedTasks();
            let selected = flatTree.filter((t) =>
                this.selectedRows.includes(t.gm__elementUID)
            );

            if (!this.taskManager.haveSameParent(selected)) {
                throw new Error(this.labels.AllTasksSameParentError);
            }

            clearTimeout(this.timeoutId);

            switch (action) {
                case 'up':
                    this.taskManager.reorderUp(selected);
                    break;
                case 'down':
                    this.taskManager.reorderDown(selected);
                    break;
                case 'right':
                    this.taskManager.reorderRight(selected);
                    this.setExpandedRows();
                    break;
                case 'left':
                    this.taskManager.reorderLeft(selected);
                    break;
                default:
                    throw new Error(`Unknown reorder action: ${action}`);
            }

            this.historyManager.track('reorder');
            try {
                this.loading = true;
                await this.syncAndRefresh('TASKS_REORDERED');
            } catch (error) {
                console.log(error);
            } finally {
                this.loading = false;
            }
        } catch (err) {
            console.error(err);
            this.showToast('error', this.labels.ReorderErrorTitle, err.message);
        }
    }

    async reorderAllTasks(sortedBy, sortDirection) {
        try {
            this.loading = true;

            this.taskManager.reorderAllTasks(sortedBy, sortDirection);

            this.historyManager.track('reorder');
            await this.syncAndRefresh('TASKS_REORDERED');
        } catch (err) {
            console.error(err);
        } finally {
            this.loading = false;
        }
    }

    // ----------------------------------------------------
    // 7. DATA MAPPING AND CONFIG HELPERS
    // ----------------------------------------------------

    getNestedValue(record, fieldPath) {
        if (!fieldPath) return null;
        return fieldPath
            .split('.')
            .reduce((acc, key) => (acc ? acc[key] : null), record);
    }

    getSiblingsConfigs(row) {
        let parentType = this.taskManager.getTaskParent(row)?.gm__objectApiName;
        let multipleRootsAllowed = row?.gm__multipleRootsAllowed ?? false;

        if (!parentType) {
            if (multipleRootsAllowed) {
                return this.tasksConfig.filter(
                    (config) =>
                        config.taskObjectApiName === row?.gm__objectApiName
                );
            }
            return [];
        }

        let parentConf = this.configByObjectName.get(parentType);

        if (!parentConf?.acceptedChildren?.length) return [];

        return this.tasksConfig.filter((config) =>
            parentConf.acceptedChildren.some(
                (child) => child.apiName === config.taskObjectApiName
            )
        );
    }

    getChildrenConfigs(row) {
        let parentType = row?.gm__objectApiName;

        let parentConf = this.configByObjectName.get(parentType);

        if (!parentConf?.acceptedChildren?.length) return [];

        return this.tasksConfig.filter((conf) =>
            parentConf.acceptedChildren.some(
                (child) => child.apiName === conf.taskObjectApiName
            )
        );
    }

    mapObjectToTask(item, objectApiName) {
        const conf = this.configByObjectName.get(objectApiName);
        if (!conf) return item;

        const md = this.objectsMetadata[conf.taskObjectApiName];
        if (!md) return item;

        item.gm__config = conf;
        item.gm__recordId = item.Id;
        item.gm__parentId = null;
        item.gm__iconName = conf.taskIconName;
        item.gm__title = item[conf.titleFieldName] ?? '';
        item.gm__owner = item[conf.ownerFieldName] ?? '';
        item.gm__objectApiName = conf.taskObjectApiName;
        item.gm__multipleRootsAllowed = conf.multipleRootsAllowed ?? false;
        //item.gm__detailFields = this.mapTaskDetailFields(conf);
        item.gm__popoverFields = conf.taskPopoverFields?.join(',') ?? '';
        item.gm__acceptedChildren = conf.acceptedChildren || [];
        item.gm__defaultValues = conf.defaultValues || {};

        item.gm__hasProgressField =
            !!conf.progressFieldName &&
            md.fields[conf.progressFieldName]?.updateable;
        item.gm__progress = conf.progressFieldName
            ? parseFloat(item[conf.progressFieldName]) || 0
            : null;

        item.gm__start = toUserDate(item[conf.fromDateFieldName], TIMEZONE);
        item.gm__end = toUserDate(item[conf.toDateFieldName], TIMEZONE);

        const fromField = md.fields[conf.fromDateFieldName];
        const toField = md.fields[conf.toDateFieldName];
        item.gm__startDateType = fromField?.type;
        item.gm__endDateType = toField?.type;
        item.gm__startTimeFormat =
            fromField?.type === 'datetime' ? '2-digit' : undefined;
        item.gm__endTimeFormat =
            toField?.type === 'datetime' ? '2-digit' : undefined;

        item.gm__rules = [];
        if (conf.taskRules && Array.isArray(conf.taskRules)) {
            const ruleEngine = this.refs.ruleEngine;

            const computedRules = conf.taskRules
                .map((ruleCfg) => {
                    if (
                        ruleCfg.condition &&
                        ruleEngine &&
                        !ruleEngine.evalBoolExp(ruleCfg.condition, item)
                    ) {
                        return null;
                    }

                    const startRaw = item[ruleCfg.dateField1];
                    const endRaw = item[ruleCfg.dateField2];

                    if (!startRaw) return null;
                    if (ruleCfg.category === 'Segment' && !endRaw) return null;

                    return {
                        Id: null,
                        gmpkg__TaskId__c: item.gm__recordId,
                        gmpkg__Category__c: ruleCfg.category,
                        gmpkg__Type__c: ruleCfg.type,
                        gmpkg__StartDate__c: startRaw,
                        gmpkg__EndDate__c: endRaw ? endRaw : null,
                        gmpkg__Color__c: ruleCfg.color,
                        gmpkg__IsActive__c: true,
                        gm__key:
                            ruleCfg.category +
                            '_' +
                            startRaw +
                            (endRaw ? `_${endRaw}` : ''),
                        gm__ruleUID: `row_${ruleCfg.category}_${Math.random()}`,
                        gm__locked: true
                    };
                })
                .filter(Boolean);

            if (computedRules.length > 0) {
                item.gm__rules = [...item.gm__rules, ...computedRules];
            }
        }

        const canEdit = this.options.canEdit;
        const canDelete = this.options.canDelete;
        const nameField = md.fields[conf.titleFieldName];

        item.gm__workDayStart = this.options.workDayStart;
        item.gm__workDayEnd = this.options.workDayEnd;
        item.gm__workWeekStart = this.options.workWeekStart;
        item.gm__workWeekEnd = this.options.workWeekEnd;

        item.gm__canEdit = canEdit && md.canEdit;
        item.gm__canDelete = canDelete && md.canDelete;
        item.gm__canCreate = canDelete && md.canCreate;

        item.gm__canEditName = item.gm__canEdit && nameField?.updateable;
        item.gm__canEditStart = item.gm__canEdit && fromField?.updateable;
        item.gm__canEditEnd = item.gm__canEdit && toField?.updateable;
        item.gm__canEditProgress =
            item.gm__canEdit &&
            conf.progressFieldName &&
            md.fields[conf.progressFieldName]?.updateable;

        item.gm__canHaveChildren = this.getChildrenConfigs(item).length > 0;
        this.recalculateTaskColor(item);
        return item;
    }

    mapTaskDetailFields(conf) {
        const fields = [];
        if (!conf?.taskDetailFields || !Array.isArray(conf.taskDetailFields)) {
            return fields;
        }

        const md = this.objectsMetadata[conf.taskObjectApiName];
        if (!md) {
            return fields;
        }

        for (const fieldName of conf.taskDetailFields) {
            const fieldMetadata = md.fields[fieldName];
            if (fieldMetadata) {
                fields.push(fieldMetadata);
            }
        }

        return fields;
    }

    mapTaskToObject(item) {
        const conf = item.gm__config;
        if (!conf) {
            console.warn(
                `No config found for task type: ${item.gm__objectApiName}`
            );
            return { Id: item.Id };
        }

        const obj = {
            Id: item.Id,
            elementUID: item.gm__elementUID,
            attributes: {
                type: conf.taskObjectApiName
            }
        };

        const toISO = (date) => {
            return date ? new Date(date).toISOString() : null;
        };

        const mapField = (fieldName, value) => {
            if (fieldName && value !== undefined && value !== null) {
                obj[fieldName] = value;
            }
        };

        // handle any field update in the editor
        let detailFields = conf.taskDetailFields || [];
        for (const fieldName of detailFields) {
            mapField(fieldName, item[fieldName]);
        }

        // handle polymorphic columns
        mapField(conf.titleFieldName, item.gm__title);
        mapField(conf.progressFieldName, item.gm__progress);
        mapField(conf.orderFieldName, item.gm__orderId);
        mapField(conf.fromDateFieldName, toISO(item.gm__start));
        mapField(conf.toDateFieldName, toISO(item.gm__end));

        // Dynamic parent lookup
        if (item.gm__parentUID) {
            const parent = this.taskManager.getTaskParent(item);
            if (parent) {
                const parentConf = this.configByObjectName.get(
                    parent.gm__objectApiName
                );
                const childDef = parentConf?.acceptedChildren?.find(
                    (c) => c.apiName === conf.taskObjectApiName
                );
                if (childDef?.parentFieldName) {
                    obj[childDef.parentFieldName] = parent.Id;
                }
            }
        }

        return obj;
    }

    async mapElementToTasks(records = [], elements = [], objectApiName) {
        records = records.map((item) =>
            this.mapObjectToTask(item, objectApiName)
        );

        // Get the config for this object type
        const conf = this.configByObjectName.get(objectApiName);

        const elementRelatedIds = elements
            .filter((el) => el.gmpkg__SObjectType__c === objectApiName)
            .map((el) => el.gmpkg__Id__c)
            .filter(Boolean); // Filter out null/undefined IDs

        // Fetch assignments if resourceConfig exists
        let assignmentMap = {};
        if (conf?.resourceConfig) {
            if (elementRelatedIds.length > 0) {
                assignmentMap = await this.fetchTaskAssignments(
                    elementRelatedIds,
                    conf.resourceConfig
                );
            }
        }

        // Fetch task rules
        let ruleMap = await this.fetchTaskRules(elementRelatedIds);

        return elements
            .filter((el) => el.gmpkg__SObjectType__c === objectApiName)
            .map((el, index) => {
                let record;

                // If it's a new record, match by index
                if (!el.Id) {
                    record = records[index];
                } else if (el.gmpkg__Id__c) {
                    record = records.find((r) => el.gmpkg__Id__c === r.Id);
                }

                if (!record) {
                    return null;
                }
                if (!el.gmpkg__Parent__c) {
                    let parentConf = null;
                    for (const c of this.tasksConfig) {
                        if (
                            c.acceptedChildren?.some(
                                (child) => child.apiName === objectApiName
                            )
                        ) {
                            parentConf = c;
                            break;
                        }
                    }

                    let childDef = parentConf?.acceptedChildren?.find(
                        (child) => child.apiName === objectApiName
                    );

                    if (childDef?.parentFieldName) {
                        el.gmpkg__Parent__c = record[childDef.parentFieldName];
                    }
                }

                let dbResources = [];
                let dbRules = [];
                if (el.gmpkg__Id__c) {
                    dbResources = assignmentMap[el.gmpkg__Id__c] || [];
                    dbRules = ruleMap[el.gmpkg__Id__c] || [];
                }
                const configRules = record.gm__rules;
                const checkList = el.gmpkg__Checklist__c
                    ? JSON.parse(el.gmpkg__Checklist__c)
                    : { items: [] };
                const counter = checkList.items.filter(
                    (item) => !item.completed
                ).length;

                return {
                    ...record,
                    gm__elementId: el.Id,
                    gm__elementType: el.gmpkg__SObjectType__c,
                    gm__taskId: el.gmpkg__Id__c,
                    gm__parentId: el.gmpkg__Parent__c,
                    gm__parentUID: el.gm__parentUID,
                    gm__orderId: el.gmpkg__Order__c,
                    gm__type: el.gmpkg__Type__c,
                    gm__resourceData: dbResources,
                    gm__checkList: checkList.items,
                    gm__checkListCounter: counter,
                    gm__rules: [...dbRules, ...configRules]
                };
            })
            .filter(Boolean);
    }

    async fetchTaskRules(taskIds) {
        const fields = [
            'Id',
            'gmpkg__TaskId__c',
            'gmpkg__Category__c',
            'gmpkg__Type__c',
            'gmpkg__StartDate__c',
            'gmpkg__EndDate__c',
            'gmpkg__Description__c',
            'gmpkg__IsActive__c'
        ];

        const filterBy = {
            gmpkg__TaskId__c: {
                operator: 'in',
                value: `('${taskIds.join("','")}')`
            }
        };

        // Get the raw assignments
        const rules = await getObjectItems({
            objectName: 'gmpkg__GanttTaskRule__c',
            objectFields: fields,
            filterBy: JSON.stringify(filterBy),
            orderBy: 'asc',
            rowLimit: 5000
        });

        const ruleMap = {};
        if (rules) {
            // Group assignments by task ID
            for (const r of rules) {
                const taskId = r.gmpkg__TaskId__c;
                const rule = {
                    ...r,
                    gm__ruleUID: `row_${r.gmpkg__Category__c}_${Math.random()}`
                };

                if (!ruleMap[taskId]) {
                    ruleMap[taskId] = [rule];
                } else {
                    ruleMap[taskId].push(rule);
                }
            }
        }

        return ruleMap;
    }

    async fetchTaskAssignments(taskIds, taskResConfig) {
        const projectResources = this.options?.availableResources || [];
        const resourceById = new Map(
            projectResources.map((r) => [r.gm__resourceId, r])
        );

        if (!taskResConfig?.objectApiName || !taskResConfig?.taskIdField) {
            return {};
        }

        // Handle both old structure (resourceIdField) and new structure (resourceField)
        let resourceIdField;
        let resourceObjectApiName;

        if (taskResConfig.resourceField) {
            // New structure
            resourceIdField = taskResConfig.resourceField.fieldApiName;
            resourceObjectApiName = taskResConfig.resourceField.objectApiName;
        } else {
            return {};
        }

        const filterBy = {
            [taskResConfig.taskIdField]: {
                operator: 'in',
                value: `('${taskIds.join("','")}')`
            }
        };

        const fields = ['Id', taskResConfig.taskIdField, resourceIdField];

        // Get the raw assignments
        const assignments = await getObjectItems({
            objectName: taskResConfig.objectApiName,
            objectFields: fields,
            filterBy: JSON.stringify(filterBy),
            orderBy: 'asc',
            rowLimit: 5000
        });

        const assignmentMap = {};
        if (assignments) {
            // Group assignments by task ID
            for (const a of assignments) {
                const taskId = a[taskResConfig.taskIdField];
                const resourceId = a[resourceIdField];
                const res = resourceById.get(resourceId);

                // Only include resources that match the expected object type (if specified)
                if (res?.objectApiName !== resourceObjectApiName) {
                    continue;
                }

                const enriched = {
                    gm__assignmentId: a.Id,
                    gm__resourceId: resourceId,
                    id: res?.id,
                    title: res?.title || 'Unknown Resource',
                    subtitle: res?.subtitle || '',
                    src: res?.src,
                    objectApiName: resourceObjectApiName,
                    initials:
                        res?.initials ||
                        (res?.title || '')
                            .split(' ')
                            .map((w) => w[0])
                            .join('')
                            .slice(0, 3)
                            .toUpperCase()
                };

                if (!assignmentMap[taskId]) {
                    assignmentMap[taskId] = [enriched];
                } else {
                    assignmentMap[taskId].push(enriched);
                }
            }
        }

        return assignmentMap;
    }

    // ----------------------------------------------------
    // 8. SYNCHRONIZATION LOGIC
    // ----------------------------------------------------

    async syncTasks() {
        const currentState = this.captureCurrentState();
        const mode = this.saveDatabase ? 'save' : 'previous_sync';
        const diffs = this.historyManager.getDifferences(currentState, mode);

        if (this.hasNoChanges(diffs)) {
            return diffs;
        }

        if (!this.saveDatabase) {
            return diffs;
        }

        await this.handleServerSync(diffs);
        return diffs;
    }

    // Optimized method that syncs and refreshes in one call
    async syncAndRefresh(action) {
        const diffs = await this.syncTasks();
        this.refreshUI(action, diffs);
        return diffs;
    }

    async handleServerSync(diffs) {
        this.loading = true;

        try {
            const changes = {
                addedOrModifiedTasks: [
                    ...(diffs.tasks.added || []),
                    ...(diffs.tasks.modified || [])
                ],
                removedTasks: diffs.tasks.removed || [],
                addedOrModifiedDependencies: [
                    ...(diffs.dependencies.added || []),
                    ...(diffs.dependencies.modified || [])
                ],
                removedDependencies: diffs.dependencies.removed || [],
                addedOrModifiedRules: [
                    ...(diffs.rules.added || []),
                    ...(diffs.rules.modified || [])
                ],
                removedRules: diffs.rules.removed || []
            };

            await this.deleteRules(changes.removedRules);
            await this.deleteRecords(changes);
            await this.upsertBusinessRecords(changes.addedOrModifiedTasks);
            await this.upsertElements(changes.addedOrModifiedTasks);
            await this.upsertRules(changes.addedOrModifiedRules);
            await this.syncAssignments(diffs.assignments, changes.removedTasks);
            await this.upsertDependencies(changes.addedOrModifiedDependencies);

            // Success - mark as saved
            await this.loadTasks();
            this.historyManager.markAsSaved(this.captureCurrentState());

            this.setExpandedRows();
            this.showToast(
                'success',
                'Success',
                this.labels.ChangesSavedSuccessfully
            );
        } catch (error) {
            const errorList = this.handleServerError(error);
            const errorMessage =
                errorList.length > 0
                    ? errorList
                          .map((e) => e.message)
                          .filter(Boolean)
                          .join('\n')
                    : error?.message || 'Unknown error';

            this.showToast(
                'error',
                'Error',
                this.labels.SyncFailedMessage + ' ' + errorMessage
            );
            throw error;
        } finally {
            this.loading = false;
            this.saveDatabase = false;
        }
    }

    hasNoChanges(diffs) {
        // 1. Safety Check
        if (!diffs) return true;

        // 2. Check Tasks
        const hasTaskChanges =
            diffs.tasks.added.length > 0 ||
            diffs.tasks.removed.length > 0 ||
            diffs.tasks.modified.length > 0;

        // 3. Check Dependencies
        const hasDependencyChanges =
            diffs.dependencies.added.length > 0 ||
            diffs.dependencies.removed.length > 0 ||
            diffs.dependencies.modified.length > 0;

        // 4. Check Rules (Constraints/Deadlines/Segments)
        const hasRuleChanges =
            (diffs.rules?.added?.length || 0) > 0 ||
            (diffs.rules?.removed?.length || 0) > 0 ||
            (diffs.rules?.modified?.length || 0) > 0;

        // 5. Check Assignments
        const hasAssignmentChanges =
            (diffs.assignments?.added?.length || 0) > 0 ||
            (diffs.assignments?.removed?.length || 0) > 0;

        return (
            !hasTaskChanges &&
            !hasDependencyChanges &&
            !hasAssignmentChanges &&
            !hasRuleChanges
        );
    }

    async upsertRules(rules) {
        if (!rules || !rules.length) return;

        // as we save date not datetime, timezone is not taken into account
        const toStorageDate = (v) => {
            if (!v) return null;
            const d = v instanceof Date ? v : new Date(v);
            return new Date(
                d.getTime() - getTimezoneDiff(d, TIMEZONE)
            ).toISOString();
        };

        const payload = rules.map((r) => {
            const recordId = r.Id;
            const task = this.taskManager.getTaskById(r.gm__elementUID);
            const taskId = task.gm__recordId;

            return {
                Id: recordId,
                gmpkg__TaskId__c: taskId,
                gmpkg__Category__c: r.gmpkg__Category__c,
                gmpkg__Type__c: r.gmpkg__Type__c,
                gmpkg__StartDate__c: toStorageDate(r.gmpkg__StartDate__c),
                gmpkg__EndDate__c: toStorageDate(r.gmpkg__EndDate__c),
                gmpkg__IsActive__c: r.gmpkg__IsActive__c,
                attributes: { type: 'gmpkg__GanttTaskRule__c' }
            };
        });

        await saveRelatedItems({ jsonData: JSON.stringify(payload) });
    }

    async deleteRules(rules) {
        if (!rules || !rules.length) return;

        const dbRules = rules.filter((r) => r.Id);
        if (!dbRules.length) return;

        const payload = dbRules.map((r) => ({
            Id: r.Id,
            attributes: {
                type: 'gmpkg__GanttTaskRule__c',
                deleted: true
            }
        }));

        await saveRelatedItems({ jsonData: JSON.stringify(payload) });
    }

    async upsertBusinessRecords(tasks) {
        if (!tasks.length) return;

        const records = tasks.map((t) => this.mapTaskToObject(t));
        const groupedRecords = this.groupBySObjectType(records);

        for (const group of groupedRecords) {
            const response = await saveRelatedItems({
                jsonData: JSON.stringify(group)
            });

            const tasksUpserted = []
                .concat(response.createdItems)
                .concat(response.updatedItems);

            if (tasksUpserted.length === 0) return;

            for (let i = 0; i < tasksUpserted.length; i++) {
                const newRecordId = tasksUpserted[i].Id;
                const uid = group[i].elementUID;

                if (newRecordId && uid) {
                    const task = this.taskManager.taskMap.get(uid);
                    if (task) {
                        task.gm__recordId = newRecordId;
                        task.Id = newRecordId;
                    }
                }
            }
        }
    }

    async deleteRecords(changes) {
        await this.deleteDependencies(changes.removedDependencies);
        await this.deleteTasksAndRecords(changes.removedTasks);
    }

    async deleteDependencies(dependencies) {
        const deletes = dependencies
            .filter((d) => d.Id)
            .map((d) => ({
                Id: d.Id,
                attributes: {
                    type: 'gmpkg__GanttDependency__c',
                    deleted: true
                }
            }));

        if (deletes.length) {
            await saveRelatedItems({ jsonData: JSON.stringify(deletes) });
        }
    }

    async deleteTasksAndRecords(tasks) {
        if (!tasks.length) return;

        // Delete elements first
        const elementDeletes = tasks
            .filter((t) => t.gm__elementId)
            .map((t) => ({
                Id: t.gm__elementId,
                attributes: {
                    type: 'gmpkg__GanttElement__c',
                    deleted: true
                }
            }));

        if (elementDeletes.length) {
            await saveRelatedItems({
                jsonData: JSON.stringify(elementDeletes)
            });
        }

        // Then delete business records
        const recordDeletes = tasks
            .filter((t) => t.gm__recordId && t.gm__objectApiName)
            .map((t) => ({
                Id: t.gm__recordId,
                attributes: {
                    type: t.gm__objectApiName,
                    deleted: true
                }
            }));

        if (recordDeletes.length) {
            await saveRelatedItems({ jsonData: JSON.stringify(recordDeletes) });
        }
    }

    async upsertElements(tasks) {
        if (!tasks.length) return;

        const tasksByLevel = new Map();
        for (const task of tasks) {
            const depth = task.gm__level;
            if (!tasksByLevel.has(depth)) {
                tasksByLevel.set(depth, []);
            }
            tasksByLevel.get(depth).push(task);
        }

        const levels = [...tasksByLevel.keys()].sort((a, b) => a - b);
        for (const level of levels) {
            const levelTasks = tasksByLevel.get(level);
            await this.upsertElementLevel(levelTasks);
        }
    }

    async upsertElementLevel(tasks) {
        const payload = tasks.map((task) => this.buildElementPayload(task));

        if (payload.length) {
            const response = await saveRelatedItems({
                jsonData: JSON.stringify(payload)
            });

            const tasksUpserted = []
                .concat(response.createdItems)
                .concat(response.updatedItems);

            if (tasksUpserted.length === 0) return;

            for (let i = 0; i < tasksUpserted.length; i++) {
                const newElementId = tasksUpserted[i].Id;
                const uid = payload[i].elementUID;

                if (newElementId && uid) {
                    const task = this.taskManager.taskMap.get(uid);
                    if (task) {
                        task.gm__elementId = newElementId;
                    }
                    this.taskManager.idToUIDMap.set(newElementId, uid);
                }
            }
        }
    }

    buildElementPayload(task) {
        const parent = this.taskManager.taskMap.get(task.gm__parentUID);

        const parentElementId = parent?.gm__elementId || null;
        const currentTask = this.taskManager.taskMap.get(task.gm__elementUID);
        const businessRecordId = currentTask.gm__recordId;

        return {
            Id: task.gm__elementId || null,
            Name: task.gm__title,
            gmpkg__Type__c: task.gm__type || 'task',
            gmpkg__Order__c: task.gm__orderId ?? 0,
            gmpkg__SObjectType__c: task.gm__objectApiName,
            gmpkg__Parent__c: parentElementId,
            gmpkg__GanttId__c: this.masterRecordId,
            gmpkg__Id__c: businessRecordId,
            attributes: { type: 'gmpkg__GanttElement__c' },
            elementUID: task.gm__elementUID
        };
    }

    async syncAssignments(assignmentDiffs, removedTasks) {
        if (!assignmentDiffs && !removedTasks) return;

        const deletes = [];
        const upserts = [];

        const isDirectField = (config, task) => {
            return (
                config.objectApiName === task.gm__objectApiName &&
                config.taskIdField === 'Id'
            );
        };

        const getResourceFieldName = (config) => {
            return config.resourceField?.fieldApiName || config.resourceIdField;
        };

        // Handle removed assignments
        for (const item of assignmentDiffs?.removed || []) {
            const task = this.taskManager.taskMap.get(item.elementUID);
            const config = task?.gm__config?.resourceConfig;
            if (!config || !task?.gm__taskId) continue;

            if (isDirectField(config, task)) {
                continue;
            }

            for (const resourceId of item.removed || []) {
                if (!resourceId) continue;

                const resourceInfo = task.gm__resourceData?.find(
                    (r) => r.gm__resourceId === resourceId
                );

                if (resourceInfo?.gm__assignmentId) {
                    deletes.push({
                        Id: resourceInfo.gm__assignmentId,
                        attributes: {
                            type: config.objectApiName,
                            deleted: true
                        }
                    });
                }
            }
        }

        // Handle assignments from removed tasks
        for (const task of removedTasks || []) {
            const config = task?.gm__config?.resourceConfig;
            if (!config || !Array.isArray(task.gm__resourceData)) continue;

            if (isDirectField(config, task)) {
                continue;
            }

            for (const owner of task.gm__resourceData) {
                const assignId = owner?.gm__assignmentId;
                if (assignId) {
                    deletes.push({
                        Id: assignId,
                        attributes: {
                            type: config.objectApiName,
                            deleted: true
                        }
                    });
                }
            }
        }

        // Handle added assignments
        for (const item of assignmentDiffs?.added || []) {
            const task = this.taskManager.taskMap.get(item.elementUID);
            const config = task?.gm__config?.resourceConfig;
            if (!config || !task?.gm__taskId) continue;

            const resourceFieldName = getResourceFieldName(config);
            for (const gmResourceId of item.added || []) {
                upserts.push({
                    [config.taskIdField]: task.gm__taskId,
                    [resourceFieldName]: gmResourceId,
                    attributes: { type: config.objectApiName }
                });
            }
        }

        if (deletes.length) {
            await saveRelatedItems({ jsonData: JSON.stringify(deletes) });
        }
        if (upserts.length) {
            await saveRelatedItems({ jsonData: JSON.stringify(upserts) });
        }
    }

    async upsertDependencies(dependencies) {
        if (!dependencies.length) return;

        const payload = dependencies
            .map((dep) => this.buildDependencyPayload(dep))
            .filter(Boolean);

        if (payload.length) {
            await saveRelatedItems({ jsonData: JSON.stringify(payload) });
        }
    }

    buildDependencyPayload(dependency) {
        const predecessor = this.taskManager.taskMap.get(
            dependency.gm__predecessorUID
        );
        const successor = this.taskManager.taskMap.get(
            dependency.gm__successorUID
        );

        if (!predecessor?.gm__elementId || !successor?.gm__elementId) {
            return null;
        }

        return {
            ...dependency,
            gmpkg__Delay__c: dependency.gmpkg__Delay__c,
            gmpkg__DelaySpan__c: dependency.gmpkg__DelaySpan__c,
            gmpkg__DelaySpanType__c: dependency.gmpkg__DelaySpanType__c,
            gmpkg__Type__c: dependency.gmpkg__Type__c,
            gmpkg__PredecessorId__c: predecessor.gm__elementId,
            gmpkg__SuccessorId__c: successor.gm__elementId,
            attributes: { type: 'gmpkg__GanttDependency__c' }
        };
    }

    groupBySObjectType(records) {
        let recordsByType = records.reduce((groups, record) => {
            let type = record.attributes?.type || 'Unknown';
            if (!groups[type]) groups[type] = [];
            groups[type].push(record);
            return groups;
        }, {});

        return Object.values(recordsByType);
    }

    removeViolatedDependencies(offenders) {
        if (!Array.isArray(offenders) || !offenders.length) {
            return;
        }
        if (!Array.isArray(this.taskManager.dependencies)) {
            return;
        }

        this.taskManager.dependencies = this.taskManager.dependencies.filter(
            (d) => {
                return !offenders.some(
                    (v) =>
                        v.gm__predecessorUID === d.gm__predecessorUID &&
                        v.gm__successorUID === d.gm__successorUID
                );
            }
        );
    }

    // ----------------------------------------------------
    // 9. UTILITY & UI HELPERS
    // ----------------------------------------------------

    recalculateTaskColor(task) {
        if (!task || !task.gm__config) return;

        const conf = task.gm__config;

        if (!conf.taskColor) {
            task.gm__taskColor = null;
            return;
        }

        if (typeof conf.taskColor === 'string') {
            task.gm__taskColor = conf.taskColor;
            return;
        }

        if (Array.isArray(conf.taskColor)) {
            const ruleEngine = this.refs.ruleEngine;

            if (!ruleEngine) {
                task.gm__taskColor = null;
                return;
            }

            task.gm__taskColor = null;
            for (const { exp, color } of conf.taskColor) {
                if (exp && ruleEngine.evalBoolExp(exp, task)) {
                    task.gm__taskColor = color;
                    break;
                }
            }
        }
    }

    toggleLoading(event) {
        this.loading = event.detail.loading;
    }

    scheduleTimelineRefresh(delay = 200) {
        if (this.selectedView === 'full') {
            if (this.refreshTimeout) {
                clearTimeout(this.refreshTimeout);
            }

            this.refreshTimeout = setTimeout(() => {
                this.refreshTimeout = null;
                this.refs.timeline.refreshTasks();
            }, delay);
        }
    }

    // ganttchartlwc.js
    refreshUI(action = 'FULL_REFRESH', payload = {}) {
        if (this.init) {
            this.expandToLevel(5);
            this.setReferenceDate();
            this.init = false;
        }

        this.refs.toolbar?.refreshToolbar();
        this.refs.timeline?.refreshTasks(action, payload);
        this.refs.tree?.refreshTasks(action, payload);
        this.refreshEditor();
    }

    refreshEditor() {
        if (this.selectedRows.length === 0) {
            this.selectedElement = null;
        } else if (this.selectedRows.length !== 1) {
            return;
        }

        setTimeout(() => {
            let elementUID = this.selectedRows[0];
            let task = this.taskManager.tasks.find(
                (t) => t.gm__elementUID === elementUID
            );
            let dependency = this.taskManager.dependencies.find(
                (t) => t.gm__dependencyUID === elementUID
            );

            if (task) {
                this.selectedElement = { ...task, type: 'task' };
            } else if (dependency) {
                this.selectedElement = { ...dependency, type: 'dependency' };
            } else {
                this.selectedElement = null;
            }
        }, 0);
    }

    toggleFullscreen() {
        this.fullscreen = !this.fullscreen;
    }

    handleSplitViewEditorToggle(event) {
        let { open } = event.detail;
        this.options = { ...this.options, defaultRightPanelOpen: open };
        this.scheduleTimelineRefresh(300);
    }

    handleSplitViewTreeToggle(event) {
        let { open } = event.detail;
        this.options = { ...this.options, defaultLeftPanelOpen: open };
        this.scheduleTimelineRefresh(300);
    }

    expandToLevel(level) {
        this.taskManager.expandToLevel(level);
        this.setExpandedRows();
    }

    setReferenceDate(date) {
        const { minDate, maxDate } = this.taskManager.getRange();
        const today = new Date();
        const inRange = today >= minDate && today <= maxDate;
        this.options.referenceDate = inRange ? today : minDate;
    }

    toggleExpandAll(isExpanding) {
        if (isExpanding) {
            let nodes = this.taskManager.tasks
                .filter((t) => t.gm__type === 'summary')
                .map((t) => t.gm__elementUID);
            this.setExpandedRows(nodes);
        } else {
            this.setExpandedRows([]);
        }
    }

    setExpandedRows(rows) {
        if (rows && Array.isArray(rows)) {
            this.taskManager.expandedRows = [...rows];
        }

        this.expandedRows = [...this.taskManager.expandedRows];
    }

    toggleExpanded(name, isExpanded) {
        let expandedRows = [...this.expandedRows];
        let itemPosition = expandedRows.indexOf(name);

        if (itemPosition > -1 && isExpanded === false) {
            expandedRows.splice(itemPosition, 1);
        } else if (itemPosition === -1 && isExpanded) {
            expandedRows.push(name);
        }

        this.setExpandedRows(expandedRows);
    }

    // history management
    captureStateBeforeChanges() {
        this.initialState = JSON.parse(
            JSON.stringify(this.captureCurrentState())
        );
    }

    captureCurrentState() {
        return {
            tasks: this.deepClone(this.taskManager.ttasks),
            dependencies: this.deepClone(this.taskManager.tdependencies),
            expandedRows: this.deepClone(this.taskManager.texpandedRows)
        };
    }

    handlePrevious() {
        if (!this.historyManager?.canUndo) return;

        const result = this.historyManager.undo();
        if (!result) return;

        if (result.expandedRows) {
            this.setExpandedRows(result.expandedRows);
        } else {
            this.setExpandedRows();
        }

        // Utiliser les diffs retournés par undo()
        this.refreshUI(result.refreshAction, result.diffs);
    }

    handleNext() {
        if (!this.historyManager?.canRedo) return;

        const result = this.historyManager.redo();
        if (!result) return;

        if (result.expandedRows) {
            this.setExpandedRows(result.expandedRows);
        } else {
            this.setExpandedRows();
        }

        // Utiliser les diffs retournés par redo()
        this.refreshUI(result.refreshAction, result.diffs);
    }

    async handleSave() {
        this.saveDatabase = true;
        const diffs = await this.syncTasks();

        this.historyManager.markAsSaved();
        this.refreshUI('FULL_REFRESH', diffs);
    }

    // Error / Toast Helpers
    handleServerError(err) {
        let errList = [];
        let firstErr = err;

        if (err && Array.isArray(err)) {
            firstErr = err[0];
        }

        if (firstErr && firstErr.body.message) {
            try {
                errList = JSON.parse(firstErr.body.message).map((e) => {
                    return { message: `${e.UID} : ${e.message}` };
                });
            } catch (e) {
                errList = [{ message: firstErr.body.message }];
            }
        }

        if (firstErr && firstErr.pageErrors) {
            errList = [{ message: firstErr.pageErrors[0].message }];
        }

        return errList;
    }

    showToast(variant, title, message) {
        this.dispatchEvent(
            new ShowToastEvent({
                variant,
                title,
                message
            })
        );
    }

    // Deep Clone Utility
    deepClone(value, seen = new WeakMap()) {
        // Handle primitives (string, number, boolean, null, undefined, symbol)
        if (value === null || typeof value !== 'object') {
            return value;
        }

        // Handle circular references
        if (seen.has(value)) {
            return seen.get(value);
        }

        // Handle Date
        if (value instanceof Date) {
            return new Date(value);
        }

        // Handle RegExp
        if (value instanceof RegExp) {
            return new RegExp(value.source, value.flags);
        }

        // Handle Map
        if (value instanceof Map) {
            const mapClone = new Map();
            seen.set(value, mapClone);
            value.forEach((v, k) => {
                mapClone.set(this.deepClone(k, seen), this.deepClone(v, seen));
            });
            return mapClone;
        }

        // Handle Set
        if (value instanceof Set) {
            const setClone = new Set();
            seen.set(value, setClone);
            value.forEach((v) => {
                setClone.add(this.deepClone(v, seen));
            });
            return setClone;
        }

        // Handle Array
        if (Array.isArray(value)) {
            const arrClone = [];
            seen.set(value, arrClone);
            value.forEach((v, i) => {
                arrClone[i] = this.deepClone(v, seen);
            });
            return arrClone;
        }

        // Handle plain Object
        const objClone = {};
        seen.set(value, objClone);
        Object.keys(value).forEach((key) => {
            objClone[key] = this.deepClone(value[key], seen);
        });
        return objClone;
    }

    // POPOVER HANDLING

    handleShowPopover = (event) => {
        // Clear any pending hide timeout
        if (this.popoverHideTimeout) {
            clearTimeout(this.popoverHideTimeout);
        }

        this.handleHidePopover(0);

        setTimeout(() => {
            const detail = event.detail;
            this.popoverData = {
                show: true,
                record: detail.record,
                id: detail.id,
                title: detail.title,
                canDelete: detail.canDelete,
                popoverFields: detail.popoverFields,
                iconName: detail.iconName,
                top: detail.top,
                left: detail.left,
                height: detail.height
            };
        }, 0); 
    };

    handleUpdatePopover = (event) => {
        if (this.popoverData.show && event.detail.id === this.popoverData.id) {
            this.popoverData = {
                ...this.popoverData,
                left: event.detail.left
            };
        }
    };

    handleHidePopover = (timer = 500) => {
        // Clear any existing timeout
        if (this.popoverHideTimeout) {
            clearTimeout(this.popoverHideTimeout);
        }

        if (this.popoverDataIgnoreMouseLeave) return;

        // Set new timeout to hide
        this.popoverHideTimeout = setTimeout(() => {
            this.popoverData = { ...this.popoverData, show: false };
            this.popoverDataIgnoreMouseLeave = false;
            this.popoverHideTimeout = null;
        }, timer);
    };

    handlePopoverEnter = () => {
        // Cancel hide timeout when entering popover
        if (this.popoverHideTimeout) {
            clearTimeout(this.popoverHideTimeout);
        }
        this.popoverDataIgnoreMouseLeave = true;
    };

    handlePopoverLeave = () => {
        this.popoverDataIgnoreMouseLeave = false;
        this.handleHidePopover();
    };

    handlePopoverClose = () => {
        // Clear timeout and hide immediately
        if (this.popoverHideTimeout) {
            clearTimeout(this.popoverHideTimeout);
        }
        this.popoverDataIgnoreMouseLeave = false;
        this.popoverData = {
            ...this.popoverData,
            top: 0,
            left: 0,
            show: false
        };
    };

    handlePopoverDelete = (event) => {
        // Dispatch to handle delete action
        this.deleteTask(this.popoverData.id);
        this.handlePopoverClose();
    };
}
