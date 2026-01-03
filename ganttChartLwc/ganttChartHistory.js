// ganttChartHistory.js

export default class GanttChartHistory {
    // ==========================
    // CONFIGURATION
    // ==========================
    CHECKPOINT_INTERVAL = 10;
    MAX_HISTORY = 50;

    // ==========================
    // STATE
    // ==========================
    history = [];
    historyIndex = -1;
    savedStateIndex = -1;

    // External references
    taskManager = null;
    captureState = null;
    onStateChange = () => {};

    constructor(taskManager, options = {}) {
        this.taskManager = taskManager;
        this.CHECKPOINT_INTERVAL = options.checkpointInterval ?? 10;
        this.MAX_HISTORY = options.maxHistory ?? 50;
        this.onStateChange = options.onStateChange ?? (() => {});
    }

    // ==========================
    // GETTERS
    // ==========================
    get canUndo() {
        return this.historyIndex > 0;
    }

    get canRedo() {
        return this.historyIndex < this.history.length - 1;
    }

    get isDirty() {
        return this.historyIndex !== this.savedStateIndex;
    }

    // ==========================
    // INITIALIZATION
    // ==========================
    initialize(captureStateFn) {
        this.captureState = captureStateFn;
        this.reset();
    }

    reset() {
        this.history = [];
        this.historyIndex = -1;
        this.savedStateIndex = -1;

        if (this.captureState) {
            this.history.push(this.deepClone(this.captureState()));
            this.historyIndex = 0;
            this.savedStateIndex = 0;
        }

        this.notifyStateChange();
    }

    markAsSaved(newState = null) {
        if (newState) {
            this.history[this.historyIndex] = this.deepClone(newState);
        }
        this.savedStateIndex = this.historyIndex;
        this.notifyStateChange();
    }

    // ==========================
    // HISTORY TRACKING
    // ==========================
    track(actionType = 'update') {
        if (!this.captureState) return;

        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        const currentState = this.deepClone(this.captureState());
        currentState._actionType = actionType;

        this.history.push(currentState);
        this.historyIndex = this.history.length - 1;

        this.trimHistory();
        this.notifyStateChange();
    }

    // ==========================
    // UNDO / REDO
    // ==========================
    static getRefreshAction(actionType, isUndo = false) {
        const actionMap = {
            addTask: isUndo ? 'TASK_DELETED' : 'TASK_ADDED',
            deleteTask: isUndo ? 'TASK_ADDED' : 'TASK_DELETED',
            updateTask: 'TASK_UPDATED',
            reorder: 'TASKS_REORDERED',
            addDependency: isUndo ? 'DEPENDENCY_DELETED' : 'DEPENDENCY_UPDATED',
            updateDependency: 'DEPENDENCY_UPDATED',
            deleteDependency: isUndo
                ? 'DEPENDENCY_UPDATED'
                : 'DEPENDENCY_DELETED',
            addRule: isUndo ? 'RULE_DELETED' : 'RULE_ADDED',
            updateRule: 'RULE_UPDATED',
            deleteRule: isUndo ? 'RULE_ADDED' : 'RULE_DELETED'
        };

        return actionMap[actionType] || (isUndo ? 'UNDO' : 'REDO');
    }

    undo() {
        if (!this.canUndo) return null;

        // Capturer l'état AVANT de restore
        const beforeState = this.captureState();
        const targetState = this.history[this.historyIndex - 1];

        // Calculer les diffs: FROM current TO previous
        const diffs = {
            tasks: this.getTaskDifferences(
                beforeState.tasks,
                targetState.tasks
            ),
            dependencies: this.getDependencyDifferences(
                beforeState.dependencies,
                targetState.dependencies
            ),
            rules: this.getRuleDifferences(
                beforeState.tasks,
                targetState.tasks
            ),
            assignments: this.getAssignmentDifferences(
                beforeState.tasks,
                targetState.tasks
            )
        };

        // Maintenant on change l'index et restore
        const fromState = this.history[this.historyIndex];
        this.historyIndex--;

        this.restoreState(targetState);
        this.notifyStateChange();

        return {
            type: fromState._actionType || 'update',
            expandedRows: targetState.expandedRows || [],
            refreshAction: GanttChartHistory.getRefreshAction(
                fromState._actionType || 'update',
                true
            ),
            diffs
        };
    }

    redo() {
        if (!this.canRedo) return null;

        // Capturer l'état AVANT de restore
        const beforeState = this.captureState();
        const targetState = this.history[this.historyIndex + 1];

        // Calculer les diffs: FROM current TO next
        const diffs = {
            tasks: this.getTaskDifferences(
                beforeState.tasks,
                targetState.tasks
            ),
            dependencies: this.getDependencyDifferences(
                beforeState.dependencies,
                targetState.dependencies
            ),
            rules: this.getRuleDifferences(
                beforeState.tasks,
                targetState.tasks
            ),
            assignments: this.getAssignmentDifferences(
                beforeState.tasks,
                targetState.tasks
            )
        };

        // Maintenant on change l'index et restore
        this.historyIndex++;

        this.restoreState(targetState);
        this.notifyStateChange();

        return {
            type: targetState._actionType || 'update',
            expandedRows: targetState.expandedRows || [],
            refreshAction: GanttChartHistory.getRefreshAction(
                targetState._actionType || 'update',
                false
            ),
            diffs
        };
    }

    // ==========================
    // STATE RESTORATION
    // ==========================
    restoreState(state) {
        this.taskManager.tasks = this.deepClone(state.tasks);
        this.taskManager.dependencies = this.deepClone(state.dependencies);
        this.taskManager.expandedRows = this.deepClone(
            state.expandedRows || []
        );
    }

    // ==========================
    // DIFFERENCES CALCULATION
    // ==========================

    /**
     * Get differences between states
     * @param {Object} currentState - The current live state
     * @param {string} mode - 'previous' | 'next' | 'save'
     */
    getDifferences(currentState, mode = 'previous') {
        console.log('=== getDifferences ===');
        console.log('mode:', mode);
        console.log('historyIndex:', this.historyIndex);
        console.log('savedStateIndex:', this.savedStateIndex);
        console.log('history.length:', this.history.length);

        let fromState;
        let toState;

        switch (mode) {
            case 'previous_sync':
            case 'previous':
                // Normal operation: FROM previous TO current
                console.log(
                    'previous: comparing history[',
                    this.historyIndex - 1,
                    '] vs currentState'
                );
                fromState = this.history[Math.max(0, this.historyIndex - 1)];
                toState = currentState;
                break;

            case 'next':
                console.log(
                    'next: comparing currentState vs history[',
                    this.historyIndex + 1,
                    ']'
                );
                fromState = currentState;
                toState =
                    this.history[
                        Math.min(this.history.length - 1, this.historyIndex + 1)
                    ];
                break;

            case 'save':
            default:
                console.log(
                    'save: comparing history[',
                    this.savedStateIndex,
                    '] vs currentState'
                );
                fromState = this.history[Math.max(0, this.savedStateIndex)];
                toState = currentState;
                break;
        }
        console.log('fromState tasks count:', fromState?.tasks?.length);
        console.log('toState tasks count:', toState?.tasks?.length);

        if (!fromState || !toState) {
            return this.emptyDiff();
        }

        return {
            tasks: this.getTaskDifferences(fromState.tasks, toState.tasks),
            dependencies: this.getDependencyDifferences(
                fromState.dependencies,
                toState.dependencies
            ),
            rules: this.getRuleDifferences(fromState.tasks, toState.tasks),
            assignments: this.getAssignmentDifferences(
                fromState.tasks,
                toState.tasks
            )
        };
    }

    emptyDiff() {
        return {
            tasks: { added: [], removed: [], modified: [] },
            dependencies: { added: [], removed: [], modified: [] },
            rules: { added: [], removed: [], modified: [] },
            assignments: { added: [], removed: [] }
        };
    }

    /**
     * Get task differences
     * @param {Array} fromTasks - Tasks we're coming FROM
     * @param {Array} toTasks - Tasks we're going TO
     */
    getTaskDifferences(fromTasks = [], toTasks = []) {
        const fromMap = new Map(fromTasks.map((t) => [t.gm__elementUID, t]));
        const toMap = new Map(toTasks.map((t) => [t.gm__elementUID, t]));

        const added = [];
        const removed = [];
        const modified = [];

        // Find added and modified (in target state)
        for (const [uid, toTask] of toMap) {
            const fromTask = fromMap.get(uid);
            if (!fromTask) {
                // Task exists in TO but not in FROM = added
                added.push(toTask);
            } else if (this.hasTaskChanged(fromTask, toTask)) {
                // Task changed = modified (push the TO task)
                modified.push(toTask);
            }
        }

        // Find removed (in source state but not in target)
        for (const [uid, fromTask] of fromMap) {
            if (!toMap.has(uid)) {
                // Task exists in FROM but not in TO = removed
                removed.push(fromTask);
            }
        }

        return { added, removed, modified };
    }

    hasTaskChanged(fromTask, toTask) {
        const fieldsToCompare = [
            'gm__title',
            'gm__start',
            'gm__end',
            'gm__progress',
            'gm__orderId',
            'gm__parentId',
            'gm__parentUID',
            'gm__type'
        ];

        for (const field of fieldsToCompare) {
            const fromVal = fromTask[field];
            const toVal = toTask[field];

            if (field === 'gm__start' || field === 'gm__end') {
                const fromDate = fromVal ? new Date(fromVal).getTime() : null;
                const toDate = toVal ? new Date(toVal).getTime() : null;
                if (fromDate !== toDate) return true;
            } else if (fromVal !== toVal) {
                return true;
            }
        }

        const config = toTask.gm__config;
        if (config?.taskDetailFields) {
            for (const field of config.taskDetailFields) {
                if (fromTask[field] !== toTask[field]) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get dependency differences
     * @param {Array} fromDeps - Dependencies we're coming FROM
     * @param {Array} toDeps - Dependencies we're going TO
     */
    getDependencyDifferences(fromDeps = [], toDeps = []) {
        const fromMap = new Map(fromDeps.map((d) => [d.gm__dependencyUID, d]));
        const toMap = new Map(toDeps.map((d) => [d.gm__dependencyUID, d]));

        const added = [];
        const removed = [];
        const modified = [];

        for (const [uid, toDep] of toMap) {
            const fromDep = fromMap.get(uid);
            if (!fromDep) {
                added.push(toDep);
            } else if (this.hasDependencyChanged(fromDep, toDep)) {
                modified.push(toDep);
            }
        }

        for (const [uid, fromDep] of fromMap) {
            if (!toMap.has(uid)) {
                removed.push(fromDep);
            }
        }

        return { added, removed, modified };
    }

    hasDependencyChanged(fromDep, toDep) {
        const fieldsToCompare = [
            'gmpkg__Type__c',
            'gmpkg__Delay__c',
            'gmpkg__DelaySpan__c',
            'gmpkg__DelaySpanType__c',
            'gm__predecessorUID',
            'gm__successorUID'
        ];

        for (const field of fieldsToCompare) {
            if (fromDep[field] !== toDep[field]) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get rule differences
     * @param {Array} fromTasks - Tasks we're coming FROM
     * @param {Array} toTasks - Tasks we're going TO
     */
    getRuleDifferences(fromTasks = [], toTasks = []) {
        const fromRules = this.extractRules(fromTasks);
        const toRules = this.extractRules(toTasks);

        const fromMap = new Map(fromRules.map((r) => [r.gm__ruleUID, r]));
        const toMap = new Map(toRules.map((r) => [r.gm__ruleUID, r]));

        const added = [];
        const removed = [];
        const modified = [];

        for (const [uid, toRule] of toMap) {
            const fromRule = fromMap.get(uid);
            if (!fromRule) {
                added.push(toRule);
            } else if (this.hasRuleChanged(fromRule, toRule)) {
                modified.push(toRule);
            }
        }

        for (const [uid, fromRule] of fromMap) {
            if (!toMap.has(uid)) {
                removed.push(fromRule);
            }
        }

        return { added, removed, modified };
    }

    extractRules(tasks = []) {
        const rules = [];
        for (const task of tasks) {
            if (task.gm__rules && Array.isArray(task.gm__rules)) {
                for (const rule of task.gm__rules) {
                    if (!rule.gm__locked) {
                        rules.push({
                            ...rule,
                            gm__elementUID: task.gm__elementUID
                        });
                    }
                }
            }
        }
        return rules;
    }

    hasRuleChanged(fromRule, toRule) {
        const fieldsToCompare = [
            'gmpkg__Category__c',
            'gmpkg__Type__c',
            'gmpkg__StartDate__c',
            'gmpkg__EndDate__c',
            'gmpkg__IsActive__c',
            'gmpkg__Description__c'
        ];

        for (const field of fieldsToCompare) {
            const fromVal = fromRule[field];
            const toVal = toRule[field];

            if (
                field === 'gmpkg__StartDate__c' ||
                field === 'gmpkg__EndDate__c'
            ) {
                const fromDate = fromVal ? new Date(fromVal).getTime() : null;
                const toDate = toVal ? new Date(toVal).getTime() : null;
                if (fromDate !== toDate) return true;
            } else if (fromVal !== toVal) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get assignment differences
     * @param {Array} fromTasks - Tasks we're coming FROM
     * @param {Array} toTasks - Tasks we're going TO
     */
    getAssignmentDifferences(fromTasks = [], toTasks = []) {
        const added = [];
        const removed = [];

        const fromMap = new Map(fromTasks.map((t) => [t.gm__elementUID, t]));
        const toMap = new Map(toTasks.map((t) => [t.gm__elementUID, t]));

        // Check tasks in target state
        for (const [uid, toTask] of toMap) {
            const fromTask = fromMap.get(uid);
            const fromResourceIds = this.getResourceIds(fromTask);
            const toResourceIds = this.getResourceIds(toTask);

            const addedIds = toResourceIds.filter(
                (id) => !fromResourceIds.includes(id)
            );
            const removedIds = fromResourceIds.filter(
                (id) => !toResourceIds.includes(id)
            );

            if (addedIds.length > 0) {
                added.push({ elementUID: uid, added: addedIds });
            }
            if (removedIds.length > 0) {
                removed.push({ elementUID: uid, removed: removedIds });
            }
        }

        // Check removed tasks
        for (const [uid, fromTask] of fromMap) {
            if (!toMap.has(uid)) {
                const fromResourceIds = this.getResourceIds(fromTask);
                if (fromResourceIds.length > 0) {
                    removed.push({ elementUID: uid, removed: fromResourceIds });
                }
            }
        }

        return { added, removed };
    }

    getResourceIds(task) {
        if (!task?.gm__resourceData || !Array.isArray(task.gm__resourceData)) {
            return [];
        }
        return task.gm__resourceData
            .map((r) => r.gm__resourceId)
            .filter(Boolean);
    }

    // ==========================
    // UTILS
    // ==========================
    trimHistory() {
        if (this.history.length <= this.MAX_HISTORY) return;

        const removeCount = this.history.length - this.MAX_HISTORY;
        this.history = this.history.slice(removeCount);
        this.historyIndex -= removeCount;
        this.savedStateIndex -= removeCount;

        this.historyIndex = Math.max(0, this.historyIndex);
        this.savedStateIndex = Math.max(-1, this.savedStateIndex);
    }

    notifyStateChange() {
        this.onStateChange({
            canUndo: this.canUndo,
            canRedo: this.canRedo,
            historyIndex: this.historyIndex,
            isDirty: this.isDirty
        });
    }

    deepClone(value, seen = new WeakMap()) {
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);

        if (value instanceof Date) return new Date(value);

        if (value instanceof Map) {
            const mapClone = new Map();
            seen.set(value, mapClone);
            value.forEach((v, k) => {
                mapClone.set(this.deepClone(k, seen), this.deepClone(v, seen));
            });
            return mapClone;
        }

        if (value instanceof Set) {
            const setClone = new Set();
            seen.set(value, setClone);
            value.forEach((v) => {
                setClone.add(this.deepClone(v, seen));
            });
            return setClone;
        }

        if (Array.isArray(value)) {
            const arr = [];
            seen.set(value, arr);
            value.forEach((v, i) => (arr[i] = this.deepClone(v, seen)));
            return arr;
        }

        const obj = {};
        seen.set(value, obj);
        Object.keys(value).forEach(
            (k) => (obj[k] = this.deepClone(value[k], seen))
        );
        return obj;
    }
}
