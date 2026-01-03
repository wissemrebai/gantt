export default class TaskReorderingManager {
    constructor(manager) {
        this.manager = manager;
    }

    reorderSiblings(task, targetIndex) {
        let parentTask = this.manager.treeManager.getTaskParent(task);
        let siblings = this.manager.treeManager.getTaskSiblings(task);

        if (!siblings?.length) return;

        siblings.sort((a, b) => a.gm__orderId - b.gm__orderId);

        const maxIndex = siblings.length - 1;
        if (targetIndex < 0) targetIndex = 0;
        if (targetIndex > maxIndex) targetIndex = maxIndex;

        const otherSiblings = siblings.filter(
            (s) => s.gm__elementUID !== task.gm__elementUID
        );

        otherSiblings.splice(targetIndex, 0, task);

        otherSiblings.forEach((sibling, index) => {
            sibling.gm__orderId = index;
        });

        if (parentTask) {
            parentTask.gm__children =
                this.manager.treeManager.getTaskChildren(parentTask);
        }
    }

    reorderAllTasks(sortBy, sortDirection = 'asc') {
        let { ttasks } = this.manager;

        if (!sortBy) {
            console.warn('sortBy field is required');
            return;
        }

        const direction = sortDirection === 'desc' ? -1 : 1;

        const getNestedValue = (obj, path) => {
            return path.split('.').reduce((acc, key) => acc?.[key], obj);
        };

        // Helper function to compare values
        const compareValues = (a, b, field) => {
            let valA = getNestedValue(a, field);
            let valB = getNestedValue(b, field);

            // Handle dates
            if (valA instanceof Date || valB instanceof Date) {
                valA =
                    valA instanceof Date
                        ? valA.getTime()
                        : new Date(valA).getTime();
                valB =
                    valB instanceof Date
                        ? valB.getTime()
                        : new Date(valB).getTime();
            }

            // Handle null/undefined
            if (valA == null && valB == null) return 0;
            if (valA == null) return 1;
            if (valB == null) return -1;

            // Handle strings (case-insensitive)
            if (typeof valA === 'string' && typeof valB === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return -1 * direction;
            if (valA > valB) return 1 * direction;
            return 0;
        };

        // Recursive function to sort tasks and their children
        const sortTasksRecursively = (parentTask) => {
            const children =
                this.manager.treeManager.getTaskChildren(parentTask);
            if (!children || children.length === 0) {
                return;
            }

            children.sort((a, b) => compareValues(a, b, sortBy));
            children.forEach((child, index) => {
                child.gm__orderId = index;
                if (child.gm__type === 'summary') {
                    sortTasksRecursively(child);
                }
            });
        };

        const rootTasks = ttasks.filter((task) => !task.gm__parentUID);
        rootTasks.sort((a, b) => compareValues(a, b, sortBy));

        rootTasks.forEach((task, index) => {
            task.gm__orderId = index;
        });

        rootTasks.forEach((rootTask) => {
            if (rootTask.gm__type === 'summary') {
                sortTasksRecursively(rootTask);
            }
        });

        this.manager.treeManager.normalizeAllTasks();
    }

    reorderUp(selected) {
        if (!selected?.length) return;

        const siblings = this.manager.treeManager.getTaskSiblings(selected[0]);
        siblings.sort((a, b) => a.gm__orderId - b.gm__orderId);

        const firstSelectedIndex = siblings.findIndex(
            (s) => s.gm__elementUID === selected[0].gm__elementUID
        );

        if (firstSelectedIndex === 0) {
            return;
        }

        selected.sort((a, b) => a.gm__orderId - b.gm__orderId);

        selected.forEach((task) => {
            const currentIndex = siblings.findIndex(
                (s) => s.gm__elementUID === task.gm__elementUID
            );

            if (currentIndex > 0) {
                const targetIndex = currentIndex - 1;

                this.manager.treeManager.updateTask(task.gm__elementUID, {
                    gm__orderId: targetIndex
                });

                siblings.sort((a, b) => a.gm__orderId - b.gm__orderId);
            }
        });

        this.manager.treeManager.rebuildTree();
    }

    reorderDown(selected) {
        if (!selected?.length) return;

        const siblings = this.manager.treeManager.getTaskSiblings(selected[0]);
        siblings.sort((a, b) => a.gm__orderId - b.gm__orderId);

        const lastSelected = selected.reduce(
            (max, task) => (task.gm__orderId > max.gm__orderId ? task : max),
            selected[0]
        );
        const lastSelectedIndex = siblings.findIndex(
            (s) => s.gm__elementUID === lastSelected.gm__elementUID
        );

        if (lastSelectedIndex === siblings.length - 1) {
            return;
        }

        selected.sort((a, b) => b.gm__orderId - a.gm__orderId);

        selected.forEach((task) => {
            const currentIndex = siblings.findIndex(
                (s) => s.gm__elementUID === task.gm__elementUID
            );

            if (currentIndex < siblings.length - 1) {
                const targetIndex = currentIndex + 1;

                this.manager.treeManager.updateTask(task.gm__elementUID, {
                    gm__orderId: targetIndex
                });

                siblings.sort((a, b) => a.gm__orderId - b.gm__orderId);
            }
        });

        this.manager.treeManager.rebuildTree();
    }

    reorderLeft(selected) {
        let results = [];
        let errors = [];

        let canMoveLeft = selected.every((task) => {
            let parent = this.manager.treeManager.getTaskParent(task);
            if (!parent) {
                return false;
            }

            let gParent = this.manager.treeManager.getTaskParent(parent);
            if (!gParent) {
                return false;
            }

            return gParent.gm__acceptedChildren
                ?.map((c) => c.apiName)
                .includes(task.gm__objectApiName);
        });

        if (!canMoveLeft) {
            throw new Error('Tasks cannot be moved left');
        }

        let oldParent = this.manager.treeManager.getTaskParent(selected[0]);
        let newParent = this.manager.treeManager.getTaskParent(oldParent);
        let newParentId = newParent.gm__recordId;
        let targetOrderId = oldParent.gm__orderId + 1;

        selected.forEach((task, index) => {
            try {
                this.manager.treeManager.updateTask(task.gm__elementUID, {
                    gm__parentUID: newParent.gm__elementUID,
                    gm__parentId: newParentId,
                    gm__orderId: targetOrderId + index
                });
                results.push(task);
            } catch (error) {
                errors.push(error.message);
            }
        });

        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        this.manager.treeManager.normalizeParent(oldParent);
        this.manager.treeManager.normalizeParent(newParent);
        this.manager.treeManager.rebuildTree();
    }

    reorderRight(selected) {
        let { texpandedRows } = this.manager;
        let errors = [];

        // Sort tasks by order
        selected.sort((a, b) => a.gm__orderId - b.gm__orderId);

        // Check if the first task is not selected
        if (selected[0].gm__orderId === 0) {
            throw new Error('1st task cannot be selected');
        }

        // Check if tasks have the same parent
        if (!this.haveSameParent(selected)) {
            throw new Error('Selected tasks must be siblings');
        }

        let maxDistance = selected.reduce((acc, cur, index) => {
            if (index < selected.length - 1) {
                return Math.max(
                    acc,
                    selected[index + 1].gm__orderId - cur.gm__orderId
                );
            }
            return acc;
        }, 1);

        // Check the distance between selected tasks
        if (maxDistance > 1) {
            throw new Error('Cannot move right - tasks must be consecutive');
        }

        const siblings = this.manager.treeManager.getTaskSiblings(selected[0]);
        const idx = siblings.findIndex(
            (t) => t.gm__elementUID === selected[0].gm__elementUID
        );

        let newParent = siblings[idx - 1];

        // Check if all selected tasks can be children of new parent using acceptedParents
        let canAllBeChildren = selected.every((task) =>
            newParent.gm__acceptedChildren
                ?.map((c) => c.apiName)
                .includes(task.gm__objectApiName)
        );

        if (!canAllBeChildren) {
            throw new Error(
                `Tasks cannot be children of ${newParent.gm__title}`
            );
        }

        const depconflit = this.hasDependencyConflict(selected, newParent);
        if (depconflit) {
            throw new Error(
                'Cannot move tasks: dependency conflict with new parent'
            );
        }

        selected.forEach((task) => {
            try {
                this.manager.treeManager.updateTask(task.gm__elementUID, {
                    gm__parentUID: newParent.gm__elementUID,
                    gm__parentId: newParent.gm__elementId
                });
            } catch (error) {
                errors.push(error.message);
            }
        });

        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        this.manager.texpandedRows = [
            ...texpandedRows,
            newParent.gm__elementUID
        ];

        this.manager.treeManager.rebuildTree();
        selected.forEach((task) => {
            this.manager.treeManager.normalizeParent(task);
        });
    }

    reorderRows(sourceRowKey, targetRowKey, position) {
        if (!sourceRowKey || !targetRowKey || sourceRowKey === targetRowKey) {
            return {
                valid: false,
                reason: `Source or target not found`
            };
        }

        const sourceTask = this.manager.treeManager.getTaskById(sourceRowKey);
        const targetTask = this.manager.treeManager.getTaskById(targetRowKey);

        if (!sourceTask || !targetTask) {
            return {
                valid: false,
                reason: `Source or target not found`
            };
        }

        switch (position) {
            case 'top':
                return this.validateMoveAbove(sourceTask, targetTask);
            case 'bottom':
                return this.validateMoveBelow(sourceTask, targetTask);
            case 'middle':
                return this.validateMoveAsChild(sourceTask, targetTask);
            default:
                return {
                    valid: false,
                    reason: `Invalid position: ${position}. Must be 'top', 'bottom', or 'middle'`
                };
        }
    }

    validateMoveAbove(sourceTask, targetTask) {
        const targetParent = this.manager.treeManager.getTaskById(
            targetTask.gm__parentUID
        );

        const canBeChild = this.canBeChildOf(sourceTask, targetParent);
        if (!canBeChild.valid) {
            return canBeChild; // Return the detailed error
        }

        const siblings = this.manager.treeManager.getTaskChildren(targetParent);
        const targetIndex = siblings.findIndex(
            (task) => task.gm__elementUID === targetTask.gm__elementUID
        );

        // Check if same parent
        const isSameParent =
            sourceTask.gm__parentUID === targetTask.gm__parentUID;
        let newIndex = targetIndex;

        if (isSameParent) {
            // Find source's current index
            const sourceIndex = siblings.findIndex(
                (task) => task.gm__elementUID === sourceTask.gm__elementUID
            );

            // For moving above in same parent: if newIndex > currentIndex, subtract 1
            if (targetIndex > sourceIndex) {
                newIndex = targetIndex - 1;
            }
        }

        const newParentId =
            sourceTask.gm__parentUID !== targetParent?.gm__elementUID
                ? targetParent?.gm__elementUID
                : undefined;

        return {
            valid: true,
            sourceRowId: sourceTask.Id,
            newIndex: newIndex,
            newParentId
        };
    }

    validateMoveBelow(sourceTask, targetTask) {
        const targetParent = this.manager.treeManager.getTaskById(
            targetTask.gm__parentUID
        );

        const canBeChild = this.canBeChildOf(sourceTask, targetParent);
        if (!canBeChild.valid) {
            return canBeChild; // Return the detailed error
        }

        const siblings = this.manager.treeManager.getTaskChildren(targetParent);
        const targetIndex = siblings.findIndex(
            (task) => task.gm__elementUID === targetTask.gm__elementUID
        );

        const newParentId =
            sourceTask.gm__parentUID !== targetParent?.gm__elementUID
                ? targetParent?.gm__elementUID
                : undefined;

        // Check if same parent
        const isSameParent =
            sourceTask.gm__parentUID === targetTask.gm__parentUID;
        let newIndex = targetIndex + 1; // Default: insert after target

        if (isSameParent) {
            // Find source's current index
            const sourceIndex = siblings.findIndex(
                (task) => task.gm__elementUID === sourceTask.gm__elementUID
            );

            // For moving below in same parent: if newIndex < currentIndex, add 1
            if (targetIndex < sourceIndex) {
                newIndex = targetIndex + 1; // This is already the default
            } else {
                newIndex = targetIndex; // Move to target's position (target will shift down)
            }
        }
        return {
            valid: true,
            sourceRowId: sourceTask.Id,
            newIndex: newIndex,
            newParentId
        };
    }

    validateMoveAsChild(sourceTask, targetTask) {
        // First check if target can have children
        const canHaveChildren = this.canHaveChildren(targetTask);
        if (!canHaveChildren.valid) {
            return canHaveChildren; // Return the detailed error
        }

        // Then check if source can be child of target
        const canBeChild = this.canBeChildOf(sourceTask, targetTask);
        if (!canBeChild.valid) {
            return canBeChild; // Return the detailed error
        }

        // Calculate new index - as last child
        const children = this.manager.treeManager.getTaskChildren(targetTask);
        return {
            valid: true,
            sourceRowId: sourceTask.Id,
            newIndex: children.length, // Add as last child
            newParentId: targetTask.gm__elementUID
        };
    }

    // helper

    hasDependencyConflict(tasks, newParent) {
        const dependencies = this.manager.tdependencies || [];
        if (!dependencies.length) return false;

        return tasks.some((task) => {
            // Check if there's any dependency relationship between task and new parent
            return dependencies.some((dep) => {
                const predUID = dep.gm__predecessorUID;
                const succUID = dep.gm__successorUID;

                // Check both directions:
                // 1. New parent is predecessor and task is successor
                // 2. Task is predecessor and new parent is successor
                return (
                    (predUID === newParent.gm__elementUID &&
                        succUID === task.gm__elementUID) ||
                    (predUID === task.gm__elementUID &&
                        succUID === newParent.gm__elementUID)
                );
            });
        });
    }

    canHaveChildren(task) {
        // 1. Check task type
        if (task.gm__type === 'milestone') {
            return {
                valid: false,
                reason: 'Milestones cannot have children'
            };
        }

        if (
            task.gm__acceptedChildren &&
            task.gm__acceptedChildren.length === 0
        ) {
            return {
                valid: false,
                reason: 'Task cannot have children - no accepted children defined'
            };
        }

        const currentLevel = this.manager.treeManager.getTaskLevel(task);
        if (currentLevel >= this.maxHierarchyLevels) {
            return {
                valid: false,
                reason: `Maximum hierarchy depth (${this.maxHierarchyLevels}) reached`
            };
        }

        return {
            valid: true
        };
    }

    canBeChildOf(sourceTask, parentTask) {
        // If parentTask is null, it means root level
        if (!parentTask) {
            return {
                valid: false,
                reason: 'Task cannot be at root level'
            };
        }

        // Check if parent can have children
        const parentCanHaveChildren = this.canHaveChildren(parentTask);
        if (!parentCanHaveChildren.valid) {
            return {
                valid: false,
                reason: `Parent task cannot have children: ${parentCanHaveChildren.reason}`
            };
        }

        if (parentTask.gm__acceptedChildren) {
            // Check if source task type is allowed as child
            const acceptedChildren = parentTask.gm__acceptedChildren.map(
                (c) => c.apiName
            );
            if (!acceptedChildren.includes(sourceTask.gm__objectApiName)) {
                return {
                    valid: false,
                    reason: `Task type ${sourceTask.gm__objectApiName} not allowed as child of ${parentTask.gm__title}`
                };
            }
        }

        return {
            valid: true
        };
    }

    haveSameParent(selectedTasks) {
        if (!selectedTasks || selectedTasks.length === 0) return false;

        let firstParentId = selectedTasks[0].gm__parentUID;
        return selectedTasks.every(
            (task) => task.gm__parentUID === firstParentId
        );
    }
}
