export default class TaskHierarchyManager {
    constructor(manager) {
        this.manager = manager;
        this.childIndex = new Map();
        this._childIndexDirty = true;
        this._sortConditionHash = null;
    }

    // ─────────────────────────────────────────────────────────────
    // Child Index Management
    // ─────────────────────────────────────────────────────────────
    
    rebuildChildIndex() {
        this.childIndex.clear();

        for (const task of this.manager.ttasks) {
            const parentUID = task.gm__parentUID;
            if (parentUID) {
                if (!this.childIndex.has(parentUID)) {
                    this.childIndex.set(parentUID, []);
                }
                this.childIndex.get(parentUID).push(task);
            }
        }

        this.sortAllChildren();
        this._childIndexDirty = false;
        this._sortConditionHash = this.hashSortCondition();
    }

    sortAllChildren() {
        const sortCondition = this.manager.tsort;
        if (!sortCondition?.length) return;

        for (const children of this.childIndex.values()) {
            this.sortChildren(children, sortCondition);
        }
    }

    sortChildren(children, sortCondition) {
        if (!children?.length || !sortCondition?.length) return;
        
        children.sort((a, b) => {
            for (const sort of sortCondition) {
                const field = sort.field;
                const direction = sort.dir === 'asc' ? 1 : -1;
                if (a[field] < b[field]) return -1 * direction;
                if (a[field] > b[field]) return 1 * direction;
            }
            return 0;
        });
    }

    hashSortCondition() {
        const sort = this.manager.tsort;
        if (!sort?.length) return '';
        return sort.map(s => `${s.field}:${s.dir}`).join('|');
    }

    invalidateChildIndex() {
        this._childIndexDirty = true;
    }

    ensureChildIndex() {
        const currentHash = this.hashSortCondition();
        if (this._childIndexDirty || this._sortConditionHash !== currentHash) {
            this.rebuildChildIndex();
        }
    }

    // Update index incrementally when a task's parent changes
    updateChildIndexForParentChange(task, oldParentUID, newParentUID) {
        // Remove from old parent's children
        if (oldParentUID && this.childIndex.has(oldParentUID)) {
            const oldChildren = this.childIndex.get(oldParentUID);
            const idx = oldChildren.indexOf(task);
            if (idx !== -1) {
                oldChildren.splice(idx, 1);
            }
            if (oldChildren.length === 0) {
                this.childIndex.delete(oldParentUID);
            }
        }

        // Add to new parent's children
        if (newParentUID) {
            if (!this.childIndex.has(newParentUID)) {
                this.childIndex.set(newParentUID, []);
            }
            const newChildren = this.childIndex.get(newParentUID);
            newChildren.push(task);
            this.sortChildren(newChildren, this.manager.tsort);
        }
    }

    // Re-sort a specific parent's children (e.g., after orderId change)
    resortChildrenOf(parentUID) {
        if (!parentUID || !this.childIndex.has(parentUID)) return;
        this.sortChildren(this.childIndex.get(parentUID), this.manager.tsort);
    }

    // ─────────────────────────────────────────────────────────────
    // Task Normalization
    // ─────────────────────────────────────────────────────────────

    normalizeTask(task, index) {
        if (!task) return null;

        task.gm__taskIndex = index;
        task.gm__elementUID ??= this.manager.generateUUID(
            task.gm__elementId || task.Id
        );

        this.manager.taskMap.set(task.gm__elementUID, task);

        if (task.Id) {
            this.manager.taskMapRecordId.set(task.Id, task);
        }

        if (task.gm__parentId) {
            task.gm__parentUID = this.manager.generateUUID(task.gm__parentId);
        }

        task.gm__start = task.gm__start ? new Date(task.gm__start) : null;
        task.gm__end = task.gm__end ? new Date(task.gm__end) : null;
        task.gm__expanded = this.manager.texpandedRows.includes(
            task.gm__elementUID
        );
        task.gm__type = this.getTaskType(task);

        const isSummary = task.gm__type === 'summary';
        task.gm__canEditStartTree = task.gm__canEditStart && !isSummary;
        task.gm__canEditEndTree = task.gm__canEditEnd && !isSummary;

        this.manager.summaryManager?.resolveSummaryFields(task);
        return task;
    }

    normalizeAllTasks() {
        this.manager.ttasks.forEach((task, index) => {
            this.normalizeTask(task, index);
        });

        // Rebuild child index BEFORE dependency resolution and tree building
        this.rebuildChildIndex();

        this.manager.dependencyManager?.refreshDependenciesAndCriticalPath();

        this.rebuildTree();
    }

    normalizeTaskOnly(task) {
        if (!task) return;
        this.normalizeTask(task, task.gm__taskIndex);
    }

    normalizeParent(task) {
        const parent = this.getTaskParent(task);
        if (parent) {
            this.normalizeTaskOnly(parent);
            this.manager.summaryManager?.resolveSummaryFields(parent);
        }
    }

    normalizeSubtree(task) {
        if (!task) return;
        this.normalizeTaskOnly(task);
        this.getAllTaskChildren(task).forEach((c) => this.normalizeTaskOnly(c));
        this.manager.summaryManager?.resolveSummaryFields(task);
    }

    // ─────────────────────────────────────────────────────────────
    // Tree Building
    // ─────────────────────────────────────────────────────────────

    rebuildTree() {
        this.ensureChildIndex();

        const buildTree = (task, parentKey, index, level) => {
            const key = parentKey
                ? `${parentKey}.${index + 1}`
                : `${index + 1}`;

            task.gm__level = level;
            task.gm__key = key;
            task.gm__fullTitle = `${key} - ${task.gm__title}`;

            task.gm__children = this.getTaskChildren(task);
            task.gm__children.forEach((child, i) =>
                buildTree(child, key, i, level + 1)
            );

            return task;
        };

        this.manager.tree = this.manager.ttasks
            .filter((t) => !t.gm__parentUID)
            .map((t, i) => buildTree(t, null, i, 0));

        this.refreshVisibleTasks();
    }

    // ─────────────────────────────────────────────────────────────
    // Getters (Optimized)
    // ─────────────────────────────────────────────────────────────

    getTaskById(taskId) {
        return this.manager.taskMap.get(taskId);
    }

    getTaskByRecordId(recordId) {
        return this.manager.taskMapRecordId.get(recordId);
    }

    getTaskParent(task) {
        if (!task?.gm__parentUID) return null;
        return this.getTaskById(task.gm__parentUID);
    }

    // O(1) lookup instead of O(n) filter + sort
    getTaskChildren(parentTask) {
        if (!parentTask) return [];
        this.ensureChildIndex();
        return this.childIndex.get(parentTask.gm__elementUID) || [];
    }

    getAllTaskChildren(task) {
        const allChildren = [];

        const collectChildrenRecursively = (t) => {
            const children = this.getTaskChildren(t);
            for (const child of children) {
                allChildren.push(child);
                collectChildrenRecursively(child);
            }
        };

        collectChildrenRecursively(task);
        return allChildren;
    }

    getTaskSiblings(task) {
        if (!task) return [];
        const parentTask = this.getTaskParent(task);
        if (!parentTask) {
            // Root-level tasks: filter those without parent
            this.ensureChildIndex();
            return this.manager.ttasks.filter((t) => !t.gm__parentUID);
        }
        return this.getTaskChildren(parentTask);
    }

    getParentHierarchy(task) {
        const hierarchy = [];
        let current = task;

        while (current?.gm__parentUID) {
            hierarchy.push(current.gm__parentUID);
            current = this.getTaskById(current.gm__parentUID);
        }

        return hierarchy;
    }

    getTaskLevel(task) {
        return this.getParentHierarchy(task).length;
    }

    getFlattenedTasks() {
        const flattenedTasks = [];
        
        const flatten = (tasks) => {
            for (const task of tasks) {
                flattenedTasks.push(task);
                if (task.gm__children?.length) {
                    flatten(task.gm__children);
                }
            }
        };
        
        flatten(this.manager.tree);
        return flattenedTasks;
    }

    getTaskType(task) {
        const type = task.gm__type || 'task';
        this.ensureChildIndex();
        const children = this.childIndex.get(task.gm__elementUID);
        if (children?.length > 0) {
            return 'summary';
        }
        return type;
    }

    isMilestone(task) {
        return task.gm__isMilestone === true;
    }

    // ─────────────────────────────────────────────────────────────
    // Visible Tasks
    // ─────────────────────────────────────────────────────────────

    buildVisibleTasks(tasks) {
        const visibleTasks = [];

        const build = (taskList) => {
            for (const task of taskList) {
                visibleTasks.push(task.gm__elementUID);
                
                const children = task.gm__children || [];
                const childCount = this.countVisibleDescendants(task);
                task.gm__visibleTasksLength = childCount;

                if (task.gm__expanded && children.length > 0) {
                    build(children);
                }
            }
        };

        build(tasks);
        return visibleTasks;
    }

    countVisibleDescendants(task) {
        let count = 0;
        const children = task.gm__children || [];
        
        for (const child of children) {
            count++;
            if (child.gm__expanded && child.gm__children?.length) {
                count += this.countVisibleDescendants(child);
            }
        }
        
        return count;
    }

    refreshVisibleTasks() {
        this.manager.visibleTasks = this.buildVisibleTasks(this.manager.tree);
    }

    // ─────────────────────────────────────────────────────────────
    // Update Tasks
    // ─────────────────────────────────────────────────────────────

    updateTask(taskId, updates) {
        const targetTask = this.getTaskById(taskId);
        if (!targetTask) {
            console.warn(`Task ${taskId} not found`);
            return;
        }

        const originalTask = { ...targetTask };

        if (updates.gm__start || updates.gm__end) {
            this.handleImplicitConstraintChange(targetTask, updates);
        }

        if (updates.gm__parentUID !== undefined) {
            const oldParentUID = targetTask.gm__parentUID;
            const newParentUID = updates.gm__parentUID;
            const newParentId = updates.gm__parentId;

            if (oldParentUID !== newParentUID) {
                // Update the child index incrementally
                this.updateChildIndexForParentChange(targetTask, oldParentUID, newParentUID);

                targetTask.gm__parentUID = newParentUID;
                targetTask.gm__parentId = newParentId;

                this.childRemoved(oldParentUID, targetTask.gm__orderId);

                const newSiblings = this.getTaskSiblings(targetTask);
                targetTask.gm__orderId = newSiblings.length - 1;

                const newParentTask = this.getTaskById(newParentUID);
                if (newParentTask) {
                    newParentTask.gm__children = this.getTaskChildren(newParentTask);
                }

                delete updates.gm__parentUID;
            }
        }

        for (let field in updates) {
            if (!field) continue;

            if (field === 'gm__orderId') {
                const siblings = this.getTaskSiblings(targetTask);
                if (updates[field] < 0) updates[field] = 0;
                if (updates[field] > siblings.length - 1)
                    updates[field] = siblings.length - 1;
            }
            if(targetTask[field] === updates[field]) continue;

            targetTask[field] = updates[field];

            switch (field) {
                case 'gm__start': {
                    this.manager.summaryManager.resolveSummaryStart(
                        this.getTaskParent(targetTask)
                    );
                    this.updateTaskOffsets(
                        targetTask,
                        originalTask[field],
                        field
                    );
                    break;
                }
                case 'gm__end':
                    this.manager.summaryManager.resolveSummaryEnd(
                        this.getTaskParent(targetTask)
                    );
                    break;
                case 'gm__progress':
                    this.manager.summaryManager.resolveSummaryPercentComplete(
                        this.getTaskParent(targetTask)
                    );
                    break;
                case 'gm__orderId':
                    this.manager.reorderingManager?.reorderSiblings(
                        targetTask,
                        targetTask[field]
                    );
                    // Re-sort just this parent's children
                    this.resortChildrenOf(targetTask.gm__parentUID);
                    break;
                case 'gm__expanded':
                    if (targetTask[field] === true) {
                        if (
                            !this.manager.expandedRows.includes(
                                targetTask.gm__elementUID
                            )
                        ) {
                            this.manager.expandedRows = [
                                ...this.manager.expandedRows,
                                targetTask.gm__elementUID
                            ];
                        }
                    } else {
                        this.manager.expandedRows =
                            this.manager.expandedRows.filter(
                                (id) => id !== targetTask.gm__elementUID
                            );
                    }
                    break;
                default:
                    break;
            }
        }

        console.log(`Enforcing dependencies after updating ${taskId}`);
        this.manager.dependencyManager?.enforceAllDependencies([taskId]);

        if (updates.gm__parentUID !== undefined) {
            const oldParentUID = originalTask.gm__parentUID;
            const newParentUID = targetTask.gm__parentUID;

            const oldParentTask = this.getTaskById(oldParentUID);
            const newParentTask = this.getTaskById(newParentUID);

            console.log('=== FINAL STATE ===');
            console.log('Old parent children FINAL:', oldParentTask?.gm__children);
            console.log('New parent children FINAL:', newParentTask?.gm__children);
        }
    }

    handleImplicitConstraintChange(task, updates) {
        let rules = task.gm__rules || [];

        const isLock = (t) => t === 'MSO' || t === 'MFO';
        const hasLock = rules.some(
            (r) => r.gmpkg__IsActive__c !== false && isLock(r.gmpkg__Type__c)
        );
        if (hasLock) return;

        let ruleType = '';
        let dateValue = null;
        let constraintsToDelete = [];

        if (updates.gm__start) {
            ruleType = 'SNET';
            dateValue = updates.gm__start;
            constraintsToDelete.push('SNET');

            if (updates.gm__end) {
                constraintsToDelete.push('FNET');
            }
        } else if (updates.gm__end) {
            ruleType = 'FNET';
            dateValue = updates.gm__end;
            constraintsToDelete.push('FNET');
        }

        if (ruleType && dateValue) {
            rules = rules.filter((r) => {
                if (r.gmpkg__Category__c !== 'Constraint') return true;
                if (isLock(r.gmpkg__Type__c)) return true;
                return !constraintsToDelete.includes(r.gmpkg__Type__c);
            });

            const newRule = this.createMemoryRule(task, ruleType, dateValue);
            task.gm__rules = [...rules, newRule];
        }
    }

    createMemoryRule(task, type, dateValue) {
        const toStorageDate = (v) => {
            if (!v) return null;
            const d = v instanceof Date ? v : new Date(v);
            return new Date(d.getTime());
        };

        return {
            gmpkg__TaskId__c: task.gm__recordId,
            gmpkg__Category__c: 'Constraint',
            gmpkg__Type__c: type,
            gmpkg__StartDate__c: toStorageDate(dateValue).toISOString(),
            gmpkg__IsActive__c: true,
            gm__ruleUID: 'row_' + Date.now() + Math.floor(Math.random() * 1000),
            gm__elementUID: task.gm__elementUID
        };
    }

    handleConstraintChange(targetTask, originalTask) {
        const originalStart = new Date(originalTask.gm__start);
        const originalEnd = new Date(originalTask.gm__end);

        const newConstraintType = targetTask.gm__elementConstraintType;
        const newConstraintDate = targetTask.gm__elementConstraintDate;

        if (
            !newConstraintType ||
            !newConstraintDate ||
            newConstraintType === 'ASAP' ||
            newConstraintType === 'ALAP'
        ) {
            return;
        }

        const cDate = new Date(newConstraintDate);
        const duration = originalEnd.getTime() - originalStart.getTime();

        let newStart = originalStart;
        let newEnd = originalEnd;

        switch (newConstraintType) {
            case 'MSO':
            case 'SNET':
            case 'SNLT':
                newStart = new Date(cDate);
                newEnd = new Date(newStart.getTime() + duration);
                break;
            case 'MFO':
            case 'FNET':
            case 'FNLT':
                newEnd = new Date(cDate);
                newStart = new Date(newEnd.getTime() - duration);
                break;
            default:
                break;
        }

        targetTask.gm__start = newStart;
        targetTask.gm__end = newEnd;

        const startChanged = originalStart.getTime() !== newStart.getTime();
        const endChanged = originalEnd.getTime() !== newEnd.getTime();

        if (startChanged || endChanged) {
            const parentTask = this.getTaskParent(targetTask);
            if (parentTask) {
                this.manager.summaryManager?.resolveSummaryStart(parentTask);
                this.manager.summaryManager?.resolveSummaryEnd(parentTask);
            }

            if (targetTask.gm__type === 'summary') {
                if (startChanged) {
                    this.updateTaskOffsets(targetTask, originalStart, 'gm__start');
                } else if (endChanged) {
                    this.updateTaskOffsets(targetTask, originalEnd, 'gm__end');
                }
            }
        }
    }

    updateTaskOffsets(task, originalValue, field) {
        if (!originalValue || !task || !field) return;

        const offset = task[field].getTime() - originalValue.getTime();
        const children = this.getAllTaskChildren(task);
        const childIds = new Set(children.map((c) => c.Id));

        let maxAllowedOffset = offset;

        for (const t of children) {
            const proposedStartDate = new Date(t.gm__start.getTime() + offset);
            const proposedEndDate = new Date(t.gm__end.getTime() + offset);

            const constrained =
                this.manager.dependencyManager?.applyAllConstraints(
                    t,
                    proposedStartDate.getTime(),
                    proposedEndDate.getTime()
                );

            if (constrained) {
                const startDiff =
                    constrained.start.getTime() - proposedStartDate.getTime();
                const endDiff =
                    constrained.end.getTime() - proposedEndDate.getTime();

                if (startDiff > 0 || endDiff > 0) {
                    const constraintOffset = offset + Math.max(startDiff, endDiff);
                    if (Math.abs(constraintOffset) < Math.abs(maxAllowedOffset)) {
                        maxAllowedOffset = constraintOffset;
                    }
                } else if (startDiff < 0 || endDiff < 0) {
                    const constraintOffset = offset + Math.min(startDiff, endDiff);
                    if (Math.abs(constraintOffset) < Math.abs(maxAllowedOffset)) {
                        maxAllowedOffset = constraintOffset;
                    }
                }
            }
        }

        for (const t of children) {
            t.gm__start = new Date(t.gm__start.getTime() + maxAllowedOffset);
            t.gm__end = new Date(t.gm__end.getTime() + maxAllowedOffset);
        }

        if (maxAllowedOffset !== offset) {
            task[field] = new Date(originalValue.getTime() + maxAllowedOffset);
        }
    }

    childRemoved(parentId, removedOrderId) {
        const parentTask = this.getTaskById(parentId);
        if (!parentTask) return;

        const children = this.getTaskChildren(parentTask);

        for (let i = removedOrderId; i < children.length; i++) {
            children[i].gm__orderId = i;
        }

        parentTask.gm__type = this.getTaskType(parentTask);
        parentTask.gm__children = children;

        this.manager.summaryManager?.resolveSummaryFields(parentTask);
    }

    // ─────────────────────────────────────────────────────────────
    // Add & Delete Tasks
    // ─────────────────────────────────────────────────────────────

    addTasks(newTasks) {
        this.manager.ttasks = [...this.manager.ttasks, ...newTasks];

        // Invalidate and let normalizeAllTasks rebuild
        this.invalidateChildIndex();

        newTasks.forEach((task) => {
            this.manager.reorderingManager?.reorderSiblings(task, task.gm__orderId);
        });

        this.normalizeAllTasks();

        newTasks.forEach((task) => {
            const parentTask = this.getTaskParent(task);

            if (
                parentTask &&
                !this.manager.expandedRows.includes(parentTask.gm__elementUID)
            ) {
                this.manager.expandedRows.push(parentTask.gm__elementUID);
            }
        });
    }

    deleteTasks(taskIds = []) {
        if (!Array.isArray(taskIds) || taskIds.length === 0) return;

        const indices = new Set();
        const uidsToRemove = new Set();

        for (const uid of taskIds) {
            const task = this.getTaskById(uid);
            if (!task) continue;

            uidsToRemove.add(uid);
            indices.add(task.gm__taskIndex);

            if (task.gm__type === 'summary') {
                const children = this.getAllTaskChildren(task) || [];
                for (const ch of children) {
                    if (Number.isInteger(ch.gm__taskIndex)) {
                        indices.add(ch.gm__taskIndex);
                    }
                    uidsToRemove.add(ch.gm__elementUID);
                }
            }
        }

        const sorted = [...indices]
            .filter(Number.isInteger)
            .sort((a, b) => b - a);
        for (const idx of sorted) {
            this.manager.ttasks.splice(idx, 1);
        }

        for (const uid of uidsToRemove) {
            this.manager.taskMap.delete(uid);
            // Also remove from child index
            this.childIndex.delete(uid);
        }

        // Clean up removed tasks from parent child arrays
        for (const [parentUID, children] of this.childIndex.entries()) {
            const filtered = children.filter(c => !uidsToRemove.has(c.gm__elementUID));
            if (filtered.length !== children.length) {
                this.childIndex.set(parentUID, filtered);
            }
        }

        if (
            this.manager.tdependencies &&
            Array.isArray(this.manager.tdependencies)
        ) {
            this.manager.tdependencies = this.manager.tdependencies.filter(
                (dep) =>
                    !uidsToRemove.has(dep.gm__predecessorUID) &&
                    !uidsToRemove.has(dep.gm__successorUID)
            );
        }

        this.normalizeAllTasks();
    }

    // ─────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────

    computeWorkingDays(start, end, task = {}) {
        if (!start || !end) return 0;

        const workDayStart = task.gm__workDayStart;
        const workDayEnd = task.gm__workDayEnd;
        const weekStart = task.gm__workWeekStart;
        const weekEnd = task.gm__workWeekEnd;

        const hoursPerDay = workDayEnd - workDayStart;
        if (hoursPerDay <= 0) return 0;
        const msPerDay = hoursPerDay * 3600000;

        const s = new Date(start);
        const e = new Date(end);
        if (e < s) return 0;

        let workingMs = 0;

        let day = new Date(s.getFullYear(), s.getMonth(), s.getDate());

        while (day <= e) {
            const dow = day.getDay();
            const iso = dow === 0 ? 7 : dow;

            if (iso >= weekStart && iso <= weekEnd) {
                const workStart = new Date(day);
                workStart.setHours(workDayStart, 0, 0, 0);

                const workEnd = new Date(day);
                workEnd.setHours(workDayEnd, 0, 0, 0);

                const intervalStart = Math.max(workStart.getTime(), s.getTime());
                const intervalEnd = Math.min(workEnd.getTime(), e.getTime());

                if (intervalEnd > intervalStart) {
                    workingMs += intervalEnd - intervalStart;
                }
            }

            day.setDate(day.getDate() + 1);
        }

        return workingMs / msPerDay;
    }
}