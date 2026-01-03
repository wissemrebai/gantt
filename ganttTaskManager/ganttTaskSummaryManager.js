export default class TaskSummaryManager {
    constructor(manager) {
        this.manager = manager;
    }

    resolveSummaryFields(task) {
        if (task) {
            if (task.gm__type === 'summary') {
                this.resolveSummaryStart(task);
                this.resolveSummaryEnd(task);
                this.resolveSummaryPercentComplete(task);
                this.resolveSummaryResource(task);
                //this.resolveSummaryDays(task);
            }
        }
    }

    resolveSummaryStart(task) {
        let findEarliestStart = (t) => {
            let children = this.manager.treeManager.getTaskChildren(t);
            if (children.length === 0) {
                return new Date(t.gm__start.getTime());
            }

            children = children.filter(
                (child) => child.gm__start != null
            );
            if(children.length === 0) {
                return new Date(t.gm__start.getTime());
            }

            let earliestStart = children[0].gm__start.getTime();

            for (let i = 1; i < children.length; i++) {
                let startTime = children[i].gm__start.getTime();
                if (startTime < earliestStart) {
                    earliestStart = startTime;
                }
            }
            return new Date(earliestStart);
        };

        this.updateSummaryRecursive(task, 'gm__start', findEarliestStart);
    }

    resolveSummaryEnd(task) {
        let findLatestEnd = (t) => {
            let children = this.manager.treeManager.getTaskChildren(t);
            if (children.length === 0) {
                return new Date(t.gm__end.getTime());
            }

            children = children.filter(
                (child) => child.gm__end != null
            );
            if(children.length === 0) {
                return new Date(t.gm__end.getTime());
            }

            let latestEnd = children[0].gm__end.getTime();

            for (let i = 1; i < children.length; i++) {
                let endTime = children[i].gm__end.getTime();
                if (endTime > latestEnd) {
                    latestEnd = endTime;
                }
            }

            return new Date(latestEnd);
        };

        this.updateSummaryRecursive(task, 'gm__end', findLatestEnd);
    }

    resolveSummaryPercentComplete(task) {
        let calculateAveragePercent = (t) => {
            let children = this.manager.treeManager.getTaskChildren(t);
            if (children.length === 0) {
                return 0;
            }

            let totalProgress = children.reduce((sum, child) => {
                return Number(sum) + (Number(child.gm__progress) || 0);
            }, 0);

            return Math.round(totalProgress / children.length);
        };

        this.updateSummaryRecursive(
            task,
            'gm__progress',
            calculateAveragePercent
        );
    }

    resolveSummaryResource(task) {
        const calculateResourceStats = (t) => {
            const children = this.manager.treeManager.getTaskChildren(t);
            if (!children || children.length === 0) {
                return {
                    resourceCount: t.gm__ownerData?.length || 0,
                    uniqueResources: new Set(
                        t.gm__ownerData?.map((o) => o.id) || []
                    ),
                    totalEffort: t.gm__effort || 0
                };
            }

            return children.reduce(
                (stats, child) => {
                    if (child.gm__ownerData?.length > 0) {
                        child.gm__ownerData.forEach((owner) => {
                            stats.uniqueResources.add(owner.id);
                        });
                        stats.resourceCount += child.gm__ownerData.length;
                    }
                    stats.totalEffort += child.gm__effort || 0;
                    return stats;
                },
                {
                    resourceCount: 0,
                    uniqueResources: new Set(),
                    totalEffort: 0
                }
            );
        };

        this.updateSummaryRecursive(task, 'gm__ownerData', (t) => {
            const stats = calculateResourceStats(t);

            // Convert unique resources to owner data array
            const ownerData = Array.from(stats.uniqueResources)
                .map((id) => {
                    // Find first occurrence of this owner in children to get full data
                    const children =
                        this.manager.treeManager.getTaskChildren(t);
                    for (const child of children) {
                        const ownerInfo = child.gm__ownerData?.find(
                            (o) => o.id === id
                        );
                        if (ownerInfo) return ownerInfo;
                    }
                    return null;
                })
                .filter(Boolean);

            return ownerData;
        });
    }

    resolveSummaryDays(task) {
        if (!task) return;

        let calculateTotalDays = (t) => {
            let children = this.manager.treeManager.getTaskChildren(t);
            if (children.length === 0) {
                return 0;
            }

            let totalDays = children.reduce((sum, child) => {
                let days = parseFloat(child.gm__days);
                return sum + (isNaN(days) ? 0 : days);
            }, 0);

            return totalDays;
        };

        this.updateSummaryRecursive(task, 'gm__days', calculateTotalDays);
    }

    updateSummaryRecursive(task, field, resolveFn) {
        if (task) {
            let resolvedValue = resolveFn(task);
            task[field] = resolvedValue;
            let parentTask = this.manager.treeManager.getTaskParent(task);
            if (parentTask) {
                this.updateSummaryRecursive(parentTask, field, resolveFn);
            }
        }
    }
}
