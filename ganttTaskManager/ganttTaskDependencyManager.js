import { getTimezoneDiff } from 'c/dateUtils';
import TIMEZONE from '@salesforce/i18n/timeZone';

export default class TaskDependencyManager {
    constructor(manager) {
        this.manager = manager;
    }

    refreshDependenciesAndCriticalPath() {
        if (!this.manager.ttasks?.length) return;

        const { ttasks, tdependencies, idToUIDMap } = this.manager;

        tdependencies.forEach((dep) => {
            dep.gm__predecessorUID ??= idToUIDMap.get(
                dep.gmpkg__PredecessorId__c
            );
            dep.gm__successorUID ??= idToUIDMap.get(dep.gmpkg__SuccessorId__c);
        });

        const criticalPathTasks = this.getCriticalPathTasks(
            ttasks,
            tdependencies
        );
        const criticalUIDs = new Set(
            criticalPathTasks.map((t) => t.gm__elementUID)
        );

        ttasks.forEach((task) => {
            const uid = task.gm__elementUID;

            // Critical Path Flags
            task.gm__isCriticalPath = criticalUIDs.has(uid);
            task.gm__isCriticalPathIcon = task.gm__isCriticalPath ? 'CP' : '';
        });
    }

    enforceAllDependencies(userMovedTaskIds = []) {
        const deps = this.manager.tdependencies ?? [];
        if (!deps.length) return;

        console.log('🔄 enforceAllDependencies START', {
            userMovedTaskIds,
            totalDependencies: deps.length
        });

        const { successors, inDegree, allNodes } = this.buildGraph(deps);
        console.log('GRAPH', successors, inDegree, allNodes);
        if (this.hasCycle(successors)) {
            console.warn('Cycle detected. Aborting auto-scheduling.');
            return;
        }

        const movedOrDirty = new Set(userMovedTaskIds);
        const isFullRefresh = userMovedTaskIds.length === 0;
        const userMovedSet = new Set(userMovedTaskIds); // Track originally moved tasks

        console.log('📊 Graph built', {
            isFullRefresh,
            totalNodes: allNodes.size,
            initialMovedTasks: Array.from(movedOrDirty)
        });

        const queue = Array.from(allNodes).filter(
            (uid) => (inDegree.get(uid) || 0) === 0
        );
        
        // Add user-moved tasks to queue even if they have predecessors
        // This ensures they get processed and their successors cascade
        for (const uid of userMovedTaskIds) {
            if (allNodes.has(uid) && !queue.includes(uid)) {
                queue.push(uid);
                console.log(`➕ Added user-moved task ${uid} to queue (has predecessors)`);
            }
        }
        
        const processedEdges = new Set();

        console.log('🚀 Starting topological sort', {
            initialQueue: queue,
            userMovedTasksInQueue: userMovedTaskIds.filter(uid => queue.includes(uid))
        });

        while (queue.length) {
            const predUID = queue.shift();
            const outgoingDeps = successors.get(predUID) || [];

            // Check if this predecessor was moved
            // - If user manually moved it, always treat as moved (even if it has predecessors)
            // - Otherwise, check if it was moved by its own predecessors
            const predWasMoved = userMovedSet.has(predUID) || movedOrDirty.has(predUID);

            console.log(`\n📦 Processing node: ${predUID}`, {
                predWasMoved,
                outgoingDepsCount: outgoingDeps.length,
                currentMovedSet: Array.from(movedOrDirty)
            });

            for (const dep of outgoingDeps) {
                const succUID = dep.gm__successorUID;
                const edgeKey = `${dep.gmpkg__Type__c}:${predUID}->${succUID}`;

                if (processedEdges.has(edgeKey)) continue;
                processedEdges.add(edgeKey);

                const shouldCheck =
                    isFullRefresh || predWasMoved || movedOrDirty.has(succUID);

                console.log(`  🔗 Dependency: ${predUID} -> ${succUID}`, {
                    type: dep.gmpkg__Type__c,
                    shouldCheck,
                    currentInDegree: inDegree.get(succUID), // ← ADD THIS
                    reasons: {
                        isFullRefresh,
                        predWasMoved,
                        succAlreadyMoved: movedOrDirty.has(succUID)
                    }
                });

                if (shouldCheck) {
                    const didSuccessorMove = this.enforceSingleDependency(
                        dep,
                        new Set()
                    );

                    console.log(`    ✅ Enforced dependency`, {
                        didSuccessorMove
                    });

                    if (predWasMoved && !movedOrDirty.has(succUID)) {
                        movedOrDirty.add(succUID);
                        console.log(
                            `    ➕ Added ${succUID} to movedOrDirty (predecessor moved)`
                        );
                    } else if (didSuccessorMove) {
                        movedOrDirty.add(succUID);
                        console.log(
                            `    ➕ Added ${succUID} to movedOrDirty (task moved)`
                        );
                    }
                }

                const oldDegree = inDegree.get(succUID) || 0;
                const newDegree = oldDegree - 1;
                inDegree.set(succUID, newDegree);

                console.log(
                    `    📊 Updated inDegree for ${succUID}: ${oldDegree} -> ${newDegree}`
                ); // ← ADD THIS

                if (newDegree === 0) {
                    queue.push(succUID);
                    console.log(
                        `    🎯 Added ${succUID} to queue (inDegree=0)`
                    );
                } else {
                    console.log(
                        `    ⏸️  ${succUID} not ready (inDegree=${newDegree})`
                    ); // ← ADD THIS
                }
            }
        }

        console.log('✅ enforceAllDependencies COMPLETE', {
            finalMovedTasks: Array.from(movedOrDirty),
            totalMoved: movedOrDirty.size
        });

        this.recalcSummaries();
    }

    // Constraints

    getConstraints(task) {
        if (!task || !task.gm__rules) return [];
        return task.gm__rules.filter(
            (r) =>
                r.gmpkg__IsActive__c !== false &&
                r.gmpkg__Category__c === 'Constraint'
        );
    }

    applyConstraint(task, proposedStart, proposedEnd, dependencyType = null) {
        const rules = this.getConstraints(task);
        const duration = proposedEnd.getTime() - proposedStart.getTime();

        let start = new Date(proposedStart);
        let end = new Date(proposedEnd);

        if (!rules.length) return { start, end };

        const toDateMidnight = (v) => {
            if (!v) return null;
            let newdate;
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                const [y, m, d] = v.split('-').map(Number);
                newdate = new Date(Date.UTC(y, m - 1, d));
            } else {
                const d = v instanceof Date ? v : new Date(v);
                newdate = new Date(d.getTime() - getTimezoneDiff(d, TIMEZONE));
            }
            newdate.setHours(0, 0, 0, 0);
            return newdate;
        };

        const compareDates = (date1, date2) => {
            const d1 = toDateMidnight(date1);
            const d2 = toDateMidnight(date2);
            return d1.getTime() - d2.getTime();
        };

        const applyConstraintDate = (sourceDateTime, constraintDateStr) => {
            if (
                typeof constraintDateStr === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(constraintDateStr)
            ) {
                const [y, m, d] = constraintDateStr.split('-').map(Number);
                const constraintDate = new Date(Date.UTC(y, m - 1, d));
                const source = new Date(sourceDateTime);
                const sourceWithTZ = new Date(
                    source.getTime() - getTimezoneDiff(source, TIMEZONE)
                );
                const hours = sourceWithTZ.getHours();
                const minutes = sourceWithTZ.getMinutes();
                const seconds = sourceWithTZ.getSeconds();
                const ms = sourceWithTZ.getMilliseconds();
                const result = new Date(constraintDate);
                result.setHours(hours, minutes, seconds, ms);
                return new Date(
                    result.getTime() + getTimezoneDiff(result, TIMEZONE)
                );
            }
            return new Date(constraintDateStr);
        };

        // STEP 1: HARD LOCKS
        const mso = rules.find((r) => r.gmpkg__Type__c === 'MSO');
        const mfo = rules.find((r) => r.gmpkg__Type__c === 'MFO');

        if (mso && mfo) {
            start = applyConstraintDate(proposedStart, mso.gmpkg__StartDate__c);
            end = applyConstraintDate(proposedEnd, mfo.gmpkg__StartDate__c);
            return { start, end };
        }
        if (mso) {
            start = applyConstraintDate(proposedStart, mso.gmpkg__StartDate__c);
            end = new Date(start.getTime() + duration);
            return { start, end };
        }
        if (mfo) {
            end = applyConstraintDate(proposedEnd, mfo.gmpkg__StartDate__c);
            start = new Date(end.getTime() - duration);
            return { start, end };
        }

        // STEP 2: Apply based on dependency type
        const checkEndFirst =
            dependencyType &&
            (dependencyType === 'end-to-start' ||
                dependencyType === 'end-to-end');

        let startMoved = false;
        let endMoved = false;

        if (checkEndFirst) {
            // Check END constraints first
            let newEnd;
            for (const rule of rules) {
                const constraintDate = rule.gmpkg__StartDate__c;
                const comparison = compareDates(end, constraintDate);
                if (rule.gmpkg__Type__c === 'FNET') {
                    if (comparison < 0) {
                        newEnd = applyConstraintDate(end, constraintDate);
                        endMoved = true;
                        break;
                    }
                } else if (rule.gmpkg__Type__c === 'FNLT') {
                    if (comparison > 0) {
                        newEnd = applyConstraintDate(end, constraintDate);
                        endMoved = true;
                        break;
                    }
                }
            }
            if (endMoved) {
                end = new Date(newEnd.getTime());
                start = new Date(end.getTime() - duration);
            }

            // Then check START constraints
            for (const rule of rules) {
                const constraintDate = rule.gmpkg__StartDate__c;
                const comparison = compareDates(start, constraintDate);
                if (rule.gmpkg__Type__c === 'SNET') {
                    if (comparison < 0) {
                        start = applyConstraintDate(start, constraintDate);
                        end = new Date(start.getTime() + duration);
                        startMoved = true;
                        break;
                    }
                } else if (rule.gmpkg__Type__c === 'SNLT') {
                    if (comparison > 0) {
                        start = applyConstraintDate(start, constraintDate);
                        end = new Date(start.getTime() + duration);
                        startMoved = true;
                        break;
                    }
                }
            }
        } else {
            let newStart;
            // Check START constraints first (default)
            for (const rule of rules) {
                const constraintDate = rule.gmpkg__StartDate__c;
                const comparison = compareDates(start, constraintDate);

                if (rule.gmpkg__Type__c === 'SNET') {
                    if (comparison < 0) {
                        newStart = applyConstraintDate(start, constraintDate);
                        startMoved = true;
                        break;
                    }
                } else if (rule.gmpkg__Type__c === 'SNLT') {
                    if (comparison > 0) {
                        newStart = applyConstraintDate(start, constraintDate);
                        startMoved = true;
                        break;
                    }
                }
            }

            if (startMoved) {
                start = new Date(newStart.getTime());
                end = new Date(start.getTime() + duration);
            }

            // Then check END constraints
            for (const rule of rules) {
                const constraintDate = rule.gmpkg__StartDate__c;
                const comparison = compareDates(end, constraintDate);

                if (rule.gmpkg__Type__c === 'FNET') {
                    if (comparison < 0) {
                        end = applyConstraintDate(end, constraintDate);
                        endMoved = true;
                        break;
                    }
                } else if (rule.gmpkg__Type__c === 'FNLT') {
                    if (comparison > 0) {
                        end = applyConstraintDate(end, constraintDate);
                        endMoved = true;
                        break;
                    }
                }
            }

            // FINAL RECONCILIATION
            // FINAL RECONCILIATION
            if (endMoved && !startMoved) {
                const calculatedStart = new Date(end.getTime() - duration);
                let blocked = false;
                for (const rule of rules) {
                    if (rule.gmpkg__Type__c === 'SNET') {
                        const constraintDate = rule.gmpkg__StartDate__c;
                        const comparison = compareDates(
                            calculatedStart,
                            constraintDate
                        );
                        if (comparison < 0) {
                            start = applyConstraintDate(
                                calculatedStart,
                                constraintDate
                            );
                            blocked = true;
                            break;
                        }
                    }
                    // ADD THIS:
                    else if (rule.gmpkg__Type__c === 'SNLT') {
                        const constraintDate = rule.gmpkg__StartDate__c;
                        const comparison = compareDates(
                            calculatedStart,
                            constraintDate
                        );
                        if (comparison > 0) {
                            start = applyConstraintDate(
                                calculatedStart,
                                constraintDate
                            );
                            blocked = true;
                            break;
                        }
                    }
                }
                if (!blocked) {
                    start = calculatedStart;
                }
            }
        }

        return { start, end };
    }

    clampToParent(task, anchor, isStart) {
        const parent = this.manager.treeManager.getTaskParent(task);
        if (!parent || parent.gm__type !== 'summary') return anchor;

        const rules = this.getConstraints(parent);
        if (!rules.length) return anchor;

        const anchorTime = anchor.getTime();
        const duration = this.getDuration(task);
        const proposedStart = isStart ? anchorTime : anchorTime - duration;
        const proposedEnd = isStart ? anchorTime + duration : anchorTime;

        for (const rule of rules) {
            const cDate = new Date(rule.gmpkg__StartDate__c);
            const cTime = cDate.getTime();

            switch (rule.gmpkg__Type__c) {
                case 'MSO':
                    if (proposedStart < cTime) return null;
                    break;
                case 'MFO':
                    if (proposedEnd < cTime) return null;
                    break;
                case 'SNET':
                    if (isStart && anchorTime < cTime) return cDate;
                    break;
                case 'SNLT':
                    if (isStart && anchorTime > cTime) return cDate;
                    break;
                case 'FNET':
                    if (!isStart && anchorTime < cTime) return cDate;
                    break;
                case 'FNLT':
                    if (!isStart && anchorTime > cTime) return cDate;
                    break;
                default:
                    break;
            }
        }
        return anchor;
    }

    applyAllConstraints(task, ps, pe, dependencyType = null) {
        let start = new Date(ps);
        let end = new Date(pe);

        const parent = this.manager.treeManager.getTaskParent(task);

        if (parent?.gm__type === 'summary') {
            const parentResult = this.applyConstraint(
                parent,
                start,
                end,
                dependencyType
            );
            start = parentResult.start;
            end = parentResult.end;
        }

        const taskResult = this.applyConstraint(
            task,
            start,
            end,
            dependencyType
        );
        return { start: taskResult.start, end: taskResult.end };
    }

    // dependencies logic

    enforceSingleDependency(dep, visited = new Set()) {
        const pUID = dep.gm__predecessorUID;
        const sUID = dep.gm__successorUID;

        const pred = this.manager.treeManager.getTaskById(pUID);
        const succ = this.manager.treeManager.getTaskById(sUID);
        if (!pred || !succ) {
            console.log(
                `    ❌ Task not found: pred=${!!pred}, succ=${!!succ}`
            );
            return false;
        }

        const key = `${dep.gmpkg__Type__c}:${pUID}->${sUID}`;
        if (visited.has(key)) {
            console.log(`    ⏭️  Already visited: ${key}`);
            return false;
        }
        visited.add(key);

        const lagMs = this.calculateDelayMs(dep);
        const alignStart = dep.gmpkg__Type__c.endsWith('start');
        const anchor = this.calculateAnchor(pred, dep.gmpkg__Type__c, lagMs);

        console.log(`    📍 Calculated anchor for ${sUID}:`, {
            anchor: anchor.toISOString(),
            alignStart,
            lagMs,
            predStart: pred.gm__start,
            predEnd: pred.gm__end,
            succStart: succ.gm__start,
            succEnd: succ.gm__end
        });

        const clampedAnchor = this.clampToParent(succ, anchor, alignStart);
        if (clampedAnchor === null) {
            console.log(`    🚫 BLOCKED by parent constraint`);
            return false;
        }

        console.log(`    ✓ Clamped anchor:`, {
            original: anchor.toISOString(),
            clamped: clampedAnchor.toISOString(),
            changed: anchor.getTime() !== clampedAnchor.getTime()
        });

        const movedTasks = this.moveTask(
            succ,
            clampedAnchor,
            alignStart,
            dep.gmpkg__Type__c
        );

        console.log(`    🎯 moveTask result:`, {
            movedCount: movedTasks.size,
            movedTaskIds: Array.from(movedTasks).map((t) => t.gm__elementUID)
        });

        movedTasks.forEach((t) => this.cascade(t, visited));

        return movedTasks.size > 0;
    }

    moveTask(task, anchor, isStartMode, dependencyType, movedSet = new Set()) {
        if (task.gm__type === 'summary') {
            return this.moveSummary(task, anchor, isStartMode, movedSet);
        }
        return this.moveRegular(
            task,
            anchor,
            isStartMode,
            dependencyType,
            movedSet
        );
    }

    // Update moveRegular to use dependency type
    moveRegular(task, anchor, isStartMode, dependencyType, movedSet) {
        const duration = this.getDuration(task);
        const proposedStart = isStartMode
            ? anchor
            : new Date(anchor.getTime() - duration);
        const proposedEnd = isStartMode
            ? new Date(anchor.getTime() + duration)
            : anchor;

        const { start, end } = this.applyAllConstraints(
            task,
            proposedStart,
            proposedEnd,
            dependencyType
        );

        if (
            start.getTime() !== new Date(task.gm__start).getTime() ||
            end.getTime() !== new Date(task.gm__end).getTime()
        ) {
            task.gm__start = start;
            task.gm__end = end;
            movedSet.add(task);
            this.updateAncestors(task);
        }
        return movedSet;
    }

    moveSummary(summary, anchor, isStart, movedSet) {
        const pivot = isStart ? summary.gm__start : summary.gm__end;
        const delta = anchor.getTime() - new Date(pivot).getTime();
        if (delta === 0) return movedSet;

        const children = this.manager.treeManager.getAllTaskChildren(summary);
        let isBlocked = false;

        // Check if any child would violate its constraints
        for (const child of children) {
            const oldStart = new Date(child.gm__start);
            const oldEnd = new Date(child.gm__end);

            const propStart = new Date(oldStart.getTime() + delta);
            const propEnd = new Date(oldEnd.getTime() + delta);

            const constrained = this.applyConstraint(child, propStart, propEnd);

            // Block if constraint modified either start or end
            if (
                constrained.start.getTime() !== propStart.getTime() ||
                constrained.end.getTime() !== propEnd.getTime()
            ) {
                isBlocked = true;
                break;
            }
        }

        // Block the entire summary move if any child is constrained
        if (isBlocked) {
            return movedSet;
        }

        // Actually move all children
        children.forEach((child) => {
            const oldStart = new Date(child.gm__start);
            const oldEnd = new Date(child.gm__end);

            const propStart = new Date(oldStart.getTime() + delta);
            const propEnd = new Date(oldEnd.getTime() + delta);

            child.gm__start = propStart;
            child.gm__end = propEnd;
            movedSet.add(child);
        });

        this.manager.summaryManager.resolveSummaryFields(summary);
        this.updateAncestors(summary);

        const visited = new Set();
        this.cascade(summary, visited);

        return movedSet;
    }

    cascade(task, visited) {
        const uid = task?.gm__elementUID;
        if (!uid) return;
        this.manager.tdependencies
            .filter((d) => d.gm__predecessorUID === uid)
            .forEach((d) => this.enforceSingleDependency(d, visited));
    }

    // validation & preview
    async checkRulesBeforeUpdate(taskId, updates) {
        const task = this.manager.treeManager.getTaskById(taskId);
        if (!task) return { canProceed: true };

        let clampedUpdates = { ...updates };

        // Apply the implicit constraint change BEFORE checking rules
        if (updates.gm__start || updates.gm__end) {
            this.manager.treeManager.handleImplicitConstraintChange(
                task,
                updates
            );
        }

        // Only clamp if dates are moving
        if (updates.gm__start || updates.gm__end) {
            const parent = this.manager.treeManager.getTaskParent(task);

            if (parent && parent.gm__type === 'summary') {
                const currentStart = new Date(task.gm__start);
                const currentEnd = new Date(task.gm__end);

                // If update has new start, use it. Else use current.
                const proposedStart = updates.gm__start
                    ? new Date(updates.gm__start)
                    : currentStart;
                const proposedEnd = updates.gm__end
                    ? new Date(updates.gm__end)
                    : currentEnd;

                const clamped = this.applyConstraint(
                    parent,
                    proposedStart,
                    proposedEnd
                );

                if (clamped.start.getTime() !== proposedStart.getTime()) {
                    clampedUpdates.gm__start = clamped.start;
                }
                if (clamped.end.getTime() !== proposedEnd.getTime()) {
                    clampedUpdates.gm__end = clamped.end;
                }
            }
        }

        const changePreview = this.buildChangePreview(task, clampedUpdates);
        const dependencyViolations = this.checkAllDependencies(changePreview);
        const anomalies = changePreview.flatMap((snap) =>
            this.checkAnomalies(snap)
        );

        const isBlocked =
            dependencyViolations.length > 0 || anomalies.length > 0;

        return {
            canProceed: !isBlocked,
            violatedDependencies: dependencyViolations,
            anomalies,
            tasksToCheck: changePreview,
            hasCycle: false
        };
    }

    buildChangePreview(task, updates) {
        const snaps = new Map();

        // 1. Simulate change on main task (applying its constraints)
        const start = updates.gm__start
            ? new Date(updates.gm__start)
            : new Date(task.gm__start);
        const end = updates.gm__end
            ? new Date(updates.gm__end)
            : new Date(task.gm__end);
        const constrained = this.applyConstraint(task, start, end);

        const taskSnap = {
            id: task.gm__elementUID,
            originalStart: task.gm__start,
            originalEnd: task.gm__end,
            newStart: constrained.start,
            newEnd: constrained.end,
            isOriginalTask: true
        };
        snaps.set(taskSnap.id, taskSnap);

        // 2. Cascade simulation to children if summary
        if (task.gm__type === 'summary') {
            const delta =
                constrained.start.getTime() -
                new Date(task.gm__start).getTime();
            const children =
                this.manager.treeManager.getAllTaskChildren(task) || [];

            for (const child of children) {
                snaps.set(child.gm__elementUID, {
                    id: child.gm__elementUID,
                    originalStart: child.gm__start,
                    originalEnd: child.gm__end,
                    newStart: new Date(
                        new Date(child.gm__start).getTime() + delta
                    ),
                    newEnd: new Date(new Date(child.gm__end).getTime() + delta),
                    isChild: true
                });
            }
        }

        // 3. Rollup to parents
        let parent = this.manager.treeManager.getTaskParent(task);
        while (parent?.gm__type === 'summary') {
            const siblings =
                this.manager.treeManager.getAllTaskChildren(parent) || [];
            let minStart = null;
            let maxEnd = null;

            for (const sibling of siblings) {
                const snap = snaps.get(sibling.gm__elementUID);
                const s = snap?.newStart ?? new Date(sibling.gm__start);
                const e = snap?.newEnd ?? new Date(sibling.gm__end);

                if (!minStart || s < minStart) minStart = s;
                if (!maxEnd || e > maxEnd) maxEnd = e;
            }

            if (minStart && maxEnd) {
                snaps.set(parent.gm__elementUID, {
                    id: parent.gm__elementUID,
                    newStart: minStart,
                    newEnd: maxEnd,
                    isParentSummary: true
                });
            }
            parent = this.manager.treeManager.getTaskParent(parent);
        }

        return Array.from(snaps.values());
    }

    checkAllDependencies(snaps) {
        const violations = [];
        const allDeps = this.manager.tdependencies ?? [];

        for (const snap of snaps) {
            const incoming = allDeps.filter(
                (d) => d.gm__successorUID === snap.id
            );

            for (const dep of incoming) {
                const predUID = dep.gm__predecessorUID;
                const predWindow = this.getTaskWindowFromSnapshots(
                    predUID,
                    snaps
                );
                const succStart = new Date(snap.newStart);
                const succEnd = new Date(snap.newEnd);

                const anchor = this.calculateRequiredAnchor(dep, predWindow);
                const violated = this.isDependencyViolated(
                    dep.gmpkg__Type__c,
                    succStart,
                    succEnd,
                    anchor
                );

                if (violated) {
                    const blocking = this.findBlockingConstraint(
                        snap.id,
                        dep.gmpkg__Type__c,
                        anchor
                    );
                    violations.push({
                        ...dep,
                        violatedTaskId: snap.id,
                        requiredAnchor: anchor,
                        blockedByConstraint: blocking
                    });
                }
            }
        }
        return violations;
    }

    checkAnomalies(snap) {
        const issues = [];
        const start = new Date(snap.newStart);
        const end = new Date(snap.newEnd);

        const originalStart = snap.originalStart;
        const originalEnd = snap.originalEnd;

        // ignore if there is no original dates
        if (!originalStart || !originalEnd) {
            return issues;
        }

        if (isNaN(start) || isNaN(end))
            issues.push({ id: snap.id, kind: 'InvalidDate' });
        else if (end < start)
            issues.push({ id: snap.id, kind: 'NegativeDuration' });

        return issues;
    }

    // helpers
    buildGraph(deps) {
        const successors = new Map();
        const inDegree = new Map();
        const allNodes = new Set();

        deps.forEach((dep) => {
            const p = dep.gm__predecessorUID;
            const s = dep.gm__successorUID;
            if (!p || !s) return;

            if (!successors.has(p)) successors.set(p, []);
            successors.get(p).push(dep);

            inDegree.set(s, (inDegree.get(s) || 0) + 1);
            allNodes.add(p);
            allNodes.add(s);
        });

        return { successors, inDegree, allNodes };
    }

    calculateCriticalPath(tasks, deps) {
        return this.getCriticalPathTasks(tasks, deps);
    }

    getCriticalPathTasks(tasks, deps) {
        if (!tasks?.length) return [];

        const taskMap = new Map();
        const predMap = new Map(); // Map of Successor -> [Predecessors]
        const parentMap = new Map(); // Map of Child -> Parent

        // 1. Build Maps
        tasks.forEach((t) => {
            const uid = t.gm__elementUID;
            if (!uid) return;

            // Normalize dates for comparison
            const start = t.gm__start ? new Date(t.gm__start).getTime() : 0;
            const end = t.gm__end ? new Date(t.gm__end).getTime() : 0;

            taskMap.set(uid, { ...t, _start: start, _end: end });
            predMap.set(uid, []);

            if (t.gm__parentUID) {
                parentMap.set(uid, t.gm__parentUID);
            }
        });

        // 2. Link Dependencies
        deps?.forEach((d) => {
            const p = d.gm__predecessorUID;
            const s = d.gm__successorUID;
            // We only care about dependencies connecting existing tasks
            if (p && s && taskMap.has(p) && taskMap.has(s)) {
                predMap.get(s).push({
                    uid: p,
                    type: d.gmpkg__Type__c || 'end-to-start',
                    lag: this.calculateDelayMs(d) // reuse your helper
                });
            }
        });

        // 3. Find the "Anchor" (The task that finishes last)
        let lastTask = null;
        let maxEnd = -Infinity;

        taskMap.forEach((t) => {
            if (t.gm__type === 'summary') return; // Ignore summaries for anchor
            if (t._end > maxEnd) {
                maxEnd = t._end;
                lastTask = t;
            }
        });

        if (!lastTask) return [];

        const criticalSet = new Set();

        // 4. Recursive Trace Backwards
        const trace = (taskUID) => {
            // Avoid cycles or repeats
            if (criticalSet.has(taskUID)) return;
            criticalSet.add(taskUID);

            const predecessors = predMap.get(taskUID) || [];

            predecessors.forEach((link) => {
                const predTask = taskMap.get(link.uid);
                if (!predTask) return;
                trace(link.uid);
            });
        };

        trace(lastTask.gm__elementUID);

        const criticalArray = Array.from(criticalSet);

        criticalArray.forEach((uid) => {
            let parentId = parentMap.get(uid);
            while (parentId) {
                if (!criticalSet.has(parentId)) {
                    criticalSet.add(parentId);
                }
                parentId = parentMap.get(parentId);
            }
        });

        return Array.from(criticalSet)
            .map((uid) => taskMap.get(uid))
            .filter(Boolean);
    }

    getDuration(task) {
        return (
            new Date(task.gm__end).getTime() -
            new Date(task.gm__start).getTime()
        );
    }

    calculateDelayMs(dep) {
        const val = Number(dep.gmpkg__DelaySpan__c) || 0;
        if (
            val === 0 ||
            !dep.gmpkg__Delay__c ||
            dep.gmpkg__Delay__c === 'immediate'
        )
            return 0;

        let ms = val * 24 * 60 * 60 * 1000;
        if (dep.gmpkg__DelaySpanType__c === 'weeks') ms *= 7;
        return dep.gmpkg__Delay__c === 'lead by' ? -ms : ms;
    }

    calculateAnchor(predTask, type, lagMs) {
        const base = type.startsWith('end')
            ? predTask.gm__end
            : predTask.gm__start;
        return new Date(new Date(base).getTime() + lagMs);
    }

    calculateRequiredAnchor(dep, predWindow) {
        const base = dep.gmpkg__Type__c.includes('end')
            ? predWindow.end
            : predWindow.start;
        return new Date(base.getTime() + this.calculateDelayMs(dep));
    }

    isDependencyViolated(type, succStart, succEnd, anchor) {
        if (type.endsWith('start'))
            return succStart.getTime() < anchor.getTime();
        if (type.endsWith('end')) return succEnd.getTime() < anchor.getTime();
        return false;
    }

    recalcSummaries() {
        this.manager.ttasks
            .filter((t) => t.gm__type === 'summary')
            .forEach((s) =>
                this.manager.summaryManager?.resolveSummaryFields(s)
            );
    }

    updateAncestors(task) {
        this.getAncestors(task).forEach((a) =>
            this.manager.summaryManager?.resolveSummaryFields(a)
        );
    }

    getAncestors(task) {
        const list = [];
        let cur = this.manager.treeManager.getTaskParent(task);
        while (cur?.gm__type === 'summary') {
            list.push(cur);
            cur = this.manager.treeManager.getTaskParent(cur);
        }
        return list;
    }

    getTaskWindowFromSnapshots(taskId, snaps) {
        const snap = snaps.find((s) => s.id === taskId);
        if (snap)
            return {
                start: new Date(snap.newStart),
                end: new Date(snap.newEnd)
            };
        const task = this.manager.treeManager.getTaskById(taskId);
        return { start: new Date(task.gm__start), end: new Date(task.gm__end) };
    }

    findBlockingConstraint(taskId, depType, anchor) {
        const task = this.manager.treeManager.getTaskById(taskId);
        const rules = this.getConstraints(task);
        if (!rules.length) return null;

        const anchorTime = anchor.getTime();
        // Check if any hard constraint prevents satisfying the dependency
        for (const rule of rules) {
            const cTime = new Date(rule.gmpkg__StartDate__c).getTime();
            if (
                rule.gmpkg__Type__c === 'MSO' &&
                depType.endsWith('start') &&
                cTime !== anchorTime
            ) {
                return [{ type: 'MSO', date: rule.gmpkg__StartDate__c }];
            }
        }
        return null;
    }

    isConstraintBlockingDependency(task, constraint, dependency) {
        if (!task || !constraint || !dependency) {
            return false;
        }

        const predUID = dependency.gm__predecessorUID;
        const predTask = this.manager.treeManager.getTaskById(predUID);
        if (!predTask) {
            return false;
        }

        const delayMs = this.calculateDelayMs(dependency);
        const depType = dependency.gmpkg__Type__c;
        const constraintType = constraint.gmpkg__Type__c;

        // Use a consistent normalization function
        const toMidnight = (d) => {
            if (!d) return null;
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        };

        // Get constraint date - handle both Date objects and strings
        let constraintDate;
        if (constraint.gmpkg__StartDate__c instanceof Date) {
            constraintDate = toMidnight(constraint.gmpkg__StartDate__c);
        } else if (typeof constraint.gmpkg__StartDate__c === 'number') {
            // Already a timestamp
            constraintDate = constraint.gmpkg__StartDate__c;
        } else {
            // String date
            constraintDate = toMidnight(
                new Date(constraint.gmpkg__StartDate__c)
            );
        }

        // Determine the base date from predecessor
        let baseDate;
        if (depType.startsWith('end')) {
            baseDate = new Date(predTask.gm__end);
        } else {
            baseDate = new Date(predTask.gm__start);
        }

        // Rest of the logic remains the same...
        const affectsSuccessorStart = depType.endsWith('start');
        const affectsSuccessorEnd = depType.endsWith('end');

        if (constraintType === 'SNET' || constraintType === 'SNLT') {
            if (!affectsSuccessorStart) return false;

            const expectedStart = toMidnight(
                new Date(baseDate.getTime() + delayMs)
            );

            if (constraintType === 'SNET') {
                return expectedStart < constraintDate;
            }
            return expectedStart > constraintDate;
        }

        // =====================================================
        // END CONSTRAINTS (Secondary)
        // =====================================================
        if (constraintType === 'FNET' || constraintType === 'FNLT') {
            // Only relevant if dependency affects END
            if (!affectsSuccessorEnd) {
                // Special case: for end-to-start dependencies, check if end constraint is constraining
                if (affectsSuccessorStart) {
                    // Calculate: predecessor_end + delay + task_duration
                    const taskDurationMs =
                        new Date(task.gm__end).getTime() -
                        new Date(task.gm__start).getTime();
                    const expectedStart = toMidnight(
                        new Date(baseDate.getTime() + delayMs)
                    );
                    const calculatedEnd = expectedStart + taskDurationMs;

                    if (constraintType === 'FNET') {
                        // End constraint is constraining if calculated end < constraint end
                        return calculatedEnd < constraintDate;
                    }
                    // FNLT
                    // End constraint is constraining if calculated end > constraint end
                    return calculatedEnd > constraintDate;
                }
                return false;
            }

            // Direct end-to-end dependency
            const expectedEnd = toMidnight(
                new Date(baseDate.getTime() + delayMs)
            );

            if (constraintType === 'FNET') {
                // Finish No Earlier Than: successor end must be >= constraint date
                return expectedEnd < constraintDate;
            }
            // FNLT
            // Finish No Later Than: successor end must be <= constraint date
            return expectedEnd > constraintDate;
        }

        return false;
    }

    hasCycle(successors) {
        const visited = new Set();
        const recStack = new Set();

        const dfs = (uid) => {
            if (recStack.has(uid)) return true;
            if (visited.has(uid)) return false;
            visited.add(uid);
            recStack.add(uid);
            for (const dep of successors.get(uid) ?? []) {
                if (dfs(dep.gm__successorUID)) return true;
            }
            recStack.delete(uid);
            return false;
        };

        for (const uid of successors.keys()) {
            if (!visited.has(uid) && dfs(uid)) return true;
        }
        return false;
    }

    wouldCreateCycle(predUID, succUID, currentDependencyId = null) {
        if (predUID === succUID) return true;

        const successorsMap = new Map();
        const deps = this.manager.tdependencies || [];

        deps.forEach((d) => {
            if (
                currentDependencyId &&
                d.gm__dependencyUID === currentDependencyId
            )
                return;

            const p = d.gm__predecessorUID;
            const s = d.gm__successorUID;
            if (p && s) {
                if (!successorsMap.has(p)) successorsMap.set(p, []);
                successorsMap.get(p).push(s);
            }
        });

        const queue = [succUID];
        const visited = new Set();

        while (queue.length > 0) {
            const current = queue.shift();

            if (current === predUID) return true; // Cycle detected!

            if (!visited.has(current)) {
                visited.add(current);
                const children = successorsMap.get(current) || [];
                children.forEach((child) => queue.push(child));
            }
        }

        return false;
    }

    deleteDependencies(ids = []) {
        this.manager.tdependencies = this.manager.tdependencies.filter(
            (d) =>
                !ids.includes(d.gm__dependencyUID) &&
                !ids.includes(d.gm__predecessorUID) &&
                !ids.includes(d.gm__successorUID)
        );
    }
}
