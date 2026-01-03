/* eslint-disable no-confusing-arrow */
/* eslint-disable no-unused-vars */
/* eslint-disable no-loop-func */

import TaskTreeManager from './ganttTaskTreeManager';
import TaskDependencyManager from './ganttTaskDependencyManager';
import TaskSummaryManager from './ganttTaskSummaryManager';
import TaskReorderingManager from './ganttTaskReorderingManager';
import TimelineManager from './ganttTimelineManager';

export default class GanttTaskManager {
    constructor(t, e) {
        this.tdefaultLevelExpanded = 0;
        this.ttasks = t ?? [];
        this.taskMap = new Map();
        this.taskMapRecordId = new Map();
        this.idToUIDMap = new Map();
        this.tdependencies = [];
        this.texpandedRows = e ?? [];
        this.tobjectsMetadata = [];
        this.tbaselineData = {};
        this.selectedView = 'full';
        this.tsort = [
            { field: 'gm__orderId', dir: 'asc' },
            { field: 'gm__start', dir: 'asc' }
        ];
        this.tree = [];
        this.visibleTasks = [];

        // Store detail fields by object API name (computed once during config)
        this.detailFieldsByObject = new Map();

        this.treeManager = new TaskTreeManager(this);
        this.dependencyManager = new TaskDependencyManager(this);
        this.summaryManager = new TaskSummaryManager(this);
        this.reorderingManager = new TaskReorderingManager(this);
        this.timelineManager = new TimelineManager(this);
    }

    //@api expanded rows
    get expandedRows() {
        return this.texpandedRows;
    }
    set expandedRows(expandedRows) {
        this.texpandedRows = expandedRows;

        //Update expanded flag
        this.ttasks.forEach((task) => {
            task.gm__expanded = expandedRows.includes(task.gm__elementUID);
        });

        //Build visbile tasks
        this.refreshVisibleTasks();
    }

    //@api tasks
    get tasks() {
        return this.ttasks;
    }
    set tasks(tasks) {
        tasks.forEach((newTask) => {
            let oldTask = this.getTaskById(newTask.gm__elementUID);
            if (oldTask) {
                newTask.left = oldTask.left;
                newTask.posInSet = oldTask.posInSet;
                newTask.width = oldTask.width;
            }
        });

        // Clear all stale caches
        this.taskMap.clear();
        this.taskMapRecordId.clear();
        this.treeManager.invalidateChildIndex();
        
        this.ttasks = tasks;
        this.normalizeAllTasks();
    }

    //@api dependencies
    get dependencies() {
        return this.tdependencies;
    }

    set dependencies(dependencies) {
        if (!Array.isArray(dependencies)) {
            console.warn('Dependencies must be an array');
            return;
        }

        this.tdependencies = dependencies.map((dep) => {
            const newDep = {
                ...dep,
                gm__dependencyUID: this.generateUUID(dep.Id)
            };

            if (dep.gm__predecessorUID && !dep.gmpkg__PredecessorId__c) {
                const predTask = this.taskMap.get(dep.gm__predecessorUID);
                newDep.gmpkg__PredecessorId__c = predTask?.gm__elementId;
            }

            if (dep.gm__successorUID && !dep.gmpkg__SuccessorId__c) {
                const succTask = this.taskMap.get(dep.gm__successorUID);
                newDep.gmpkg__SuccessorId__c = succTask?.gm__elementId;
            }

            return newDep;
        });

        this.dependencyManager.refreshDependenciesAndCriticalPath();
    }

    get objectsMetadata() {
        return this.tobjectsMetadata;
    }

    set objectsMetadata(objectsMetadata) {
        this.tobjectsMetadata = objectsMetadata;
    }

    get baselineData() {
        return this.tbaselineData;
    }

    set baselineData(baselineData) {
        this.tbaselineData = baselineData;
    }

    /**
     * Get detail fields for a specific object API name.
     * @param {string} objectApiName - The object API name
     * @returns {Array} Array of field metadata objects
     */
    getDetailFields(objectApiName) {
        return this.detailFieldsByObject.get(objectApiName) || [];
    }

    /**
     * Set detail fields for a specific object API name.
     * Called once during config initialization.
     * @param {string} objectApiName - The object API name
     * @param {Array} fields - Array of field metadata objects
     */
    setDetailFields(objectApiName, fields) {
        this.detailFieldsByObject.set(objectApiName, fields);
    }

    normalizeAllTasks() {
        return this.treeManager.normalizeAllTasks();
    }

    normalizeTaskOnly(task) {
        return this.treeManager.normalizeTaskOnly(task);
    }

    normalizeParent(task) {
        return this.treeManager.normalizeParent(task);
    }

    // getters
    getTaskParent(task) {
        return this.treeManager.getTaskParent(task);
    }

    getTaskById(taskId) {
        return this.treeManager.getTaskById(taskId);
    }

    getTaskByRecordId(recordId) {
        return this.treeManager.getTaskByRecordId(recordId);
    }

    getTasksTree() {
        return this.tree;
    }

    // visible tasks
    getVisibleTasks() {
        return this.visibleTasks;
    }

    refreshVisibleTasks() {
        this.visibleTasks = this.treeManager.buildVisibleTasks(this.tree);
    }

    refreshDependenciesAndCriticalPath() {
        this.dependencyManager.refreshDependenciesAndCriticalPath();
    }

    // flat tree
    getFlattenedTasks() {
        let flattenedTasks = [...this.tree];

        this.tree.forEach((task) => {
            flattenedTasks = [
                ...flattenedTasks,
                ...this.treeManager.getAllTaskChildren(task)
            ];
        });

        return flattenedTasks;
    }

    // task actions
    updateTask(taskId, updates) {
        return this.treeManager.updateTask(taskId, updates);
    }

    addTasks(newTasks) {
        return this.treeManager.addTasks(newTasks);
    }

    deleteTasks(taskIds = []) {
        return this.treeManager.deleteTasks(taskIds);
    }

    deleteDependencies(depIds = []) {
        return this.dependencyManager.deleteDependencies(depIds);
    }

    // Reordering
    reorderRows(sourceRowKey, targetRowKey, position) {
        return this.reorderingManager.reorderRows(
            sourceRowKey,
            targetRowKey,
            position
        );
    }

    reorderUp(t) {
        return this.reorderingManager.reorderUp(t);
    }

    reorderDown(t) {
        return this.reorderingManager.reorderDown(t);
    }

    reorderLeft(t) {
        return this.reorderingManager.reorderLeft(t);
    }

    reorderRight(t) {
        return this.reorderingManager.reorderRight(t);
    }

    reorderAllTasks(sortBy, sortDirection = 'asc') {
        return this.reorderingManager.reorderAllTasks(sortBy, sortDirection);
    }

    // timeline
    getRange() {
        return this.timelineManager.getRange();
    }

    computeRange() {
        return this.timelineManager.computeRange();
    }

    getAutoViewZoomType(containerWidth, slotConfig) {
        return this.timelineManager.getAutoViewZoomType(
            containerWidth,
            slotConfig
        );
    }

    // dependency methods
    enforceSingleDependency(dep, visited) {
        return this.dependencyManager.enforceSingleDependency(dep, visited);
    }

    checkRulesBeforeUpdate(taskId, proposedUpdates) {
        return this.dependencyManager.checkRulesBeforeUpdate(
            taskId,
            proposedUpdates
        );
    }

    wouldCreateCycle(predUID, succUID, currentDependencyId) {
        return this.dependencyManager.wouldCreateCycle(
            predUID,
            succUID,
            currentDependencyId
        );
    }

    isConstraintBlockingDependency(task, constraint, dependency) {
        return this.dependencyManager.isConstraintBlockingDependency(
            task,
            constraint,
            dependency
        );
    }

    // helper
    haveSameParent(selectedTasks) {
        return this.reorderingManager.haveSameParent(selectedTasks);
    }

    generateUUID(elementId) {
        if (elementId && this.idToUIDMap.has(elementId)) {
            return this.idToUIDMap.get(elementId);
        }

        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
            /[xy]/g,
            function (c) {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            }
        );

        if (elementId) {
            this.idToUIDMap.set(elementId, uuid);
        }

        return uuid;
    }

    expandToLevel(level) {
        let newExpandedRows = [];

        this.ttasks.forEach((task) => {
            let taskLevel = this.treeManager.getTaskLevel(task);

            if (taskLevel < level) {
                newExpandedRows.push(task.gm__elementUID);
            }
        });

        this.expandedRows = newExpandedRows;
    }

    // Store active interaction state centrally
    setActiveInteraction(activeInteraction) {
        this.activeInteraction = activeInteraction;
    }

    getActiveInteraction() {
        return this.activeInteraction;
    }

    // Validate dependency connection between two tasks
    validateDependencyConnection(activeTaskKey, currentTaskKey) {
        if (!activeTaskKey || !currentTaskKey) return false;

        let startDragKey = activeTaskKey;
        let endDragKey = currentTaskKey;

        // Swap if needed to ensure longer key is first
        if (startDragKey.length < endDragKey.length) {
            [startDragKey, endDragKey] = [endDragKey, startDragKey];
        }

        // Check if one task is a parent/ancestor of the other
        return startDragKey.startsWith(endDragKey);
    }
}
