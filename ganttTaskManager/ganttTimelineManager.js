import {
    addDays,
    addMonths,
    addYears,
    endOfMonth,
    endOfWeek,
    startOfMonth,
    startOfWeek,
    dateNew,
    startOfDay,
    endOfDay
} from 'c/dateUtils';

export default class TaskDateRangeManager {
    constructor(manager) {
        this.manager = manager;
        this.range = {};
    }

    getRange() {
        const tasks = this.manager.ttasks;

        let minDate = Infinity;
        let maxDate = -Infinity;

        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            const s = Date.parse(t.gm__start);
            const e = Date.parse(t.gm__end);
            if (s < minDate) minDate = s;
            if (e > maxDate) maxDate = e;
        }

        if (minDate === Infinity) {
            const now = Date.now();
            minDate = startOfDay(new Date(now));
            maxDate = endOfDay(new Date(now));
        } else {
            minDate = new Date(minDate);
            maxDate = new Date(maxDate);
        }

        return { minDate, maxDate };
    }

    computeRange() {
        const { minDate, maxDate } = this.getRange();
        const view =
            this.manager.selectedView === 'full'
                ? this.getAutoViewType()
                : this.manager.selectedView;

        const start = dateNew(minDate);
        const end = dateNew(maxDate, true);

        let rangeStart = new Date(start);
        let rangeEnd = new Date(end);

        switch (view) {
            case 'day':
                rangeStart = addDays(start, -1);
                rangeEnd = addDays(end, +1);
                break;
            case 'week': {
                const startDay = start.getDate();
                const endDay = end.getDate();

                // First half of month (1-15) or second half (16-31)
                rangeStart = startOfWeek(
                    startDay <= 15
                        ? startOfMonth(addMonths(start, -1))
                        : startOfMonth(start)
                );
                rangeEnd = endOfWeek(
                    endDay <= 15
                        ? endOfMonth(end)
                        : endOfMonth(addMonths(end, 1))
                );
                break;
            }
            case 'month': {
                const startMonth = start.getMonth();
                const endMonth = end.getMonth();

                const startQuarter = Math.floor(startMonth / 3);
                const endQuarter = Math.floor(endMonth / 3);

                rangeStart = startOfMonth(
                    new Date(start.getFullYear(), startQuarter * 3 - 1, 1)
                );

                const quarterEndMonths = [2, 5, 8, 11]; // March, June, September, December
                const extraMonths = quarterEndMonths.includes(endMonth) ? 3 : 0;

                rangeEnd = endOfMonth(
                    new Date(
                        end.getFullYear(),
                        (endQuarter + 1) * 3 + extraMonths,
                        0
                    )
                );
                break;
            }
            case 'year': {
                const startHalf = start.getMonth() < 6 ? 0 : 1;
                const endHalf = end.getMonth() < 6 ? 0 : 1;

                // Start: if first half, go back to prev July; if second half, go to Jan
                rangeStart = startOfMonth(
                    new Date(
                        startHalf === 0
                            ? start.getFullYear() - 1
                            : start.getFullYear(),
                        startHalf === 0 ? 6 : 0,
                        1
                    )
                );
                // End: if first half, go to Dec of same year; if second half, go to June next year
                rangeEnd = endOfMonth(
                    new Date(
                        endHalf === 0
                            ? end.getFullYear()
                            : end.getFullYear() + 1,
                        endHalf === 0 ? 11 : 5,
                        1
                    )
                );
                break;
            }
            default:
                throw new Error(`Unsupported view: ${view}`);
        }

        rangeStart = startOfDay(rangeStart);
        rangeEnd = endOfDay(rangeEnd);

        return {
            rangeStart,
            rangeEnd,
            minDate,
            maxDate,
            view
        };
    }

    getAutoViewType() {
        const { minDate, maxDate } = this.getRange();
        const days = (maxDate - minDate) / 86400000;
        if (days <= 3) return 'day';
        if (days <= 14) return 'week';
        if (days <= 90) return 'month';
        return 'year';
    }

    getAutoViewZoomType(containerWidth = 1200, slotConfig = {}) {
        const ZOOM_MIN = 0.25;
        const ZOOM_MAX = 2;

        let best = null;
        let bestDiff = Infinity;

        for (const [type, cfg] of Object.entries(slotConfig)) {
            if (!cfg || !cfg.unitCount || cfg.unitCount <= 0) continue;

            const { unitCount, minSize } = cfg;

            const idealSlotSize = containerWidth / unitCount;
            const idealZoom = idealSlotSize / minSize;

            let zoomLevel;
            let slotSize;

            if (idealZoom >= ZOOM_MIN && idealZoom <= ZOOM_MAX) {
                zoomLevel = +idealZoom.toFixed(2);
                slotSize = +idealSlotSize.toFixed(2);
            } else {
                const clampedZoom = Math.max(
                    ZOOM_MIN,
                    Math.min(ZOOM_MAX, idealZoom)
                );
                zoomLevel = +clampedZoom.toFixed(2);
                slotSize = +(minSize * clampedZoom).toFixed(2);
            }

            const totalWidth = slotSize * unitCount;
            const diff = Math.abs(containerWidth - totalWidth);

            if (diff < bestDiff) {
                bestDiff = diff;
                best = { viewType: type, zoomLevel, slotSize };
            }
        }

        if (!best) {
            const fallback = slotConfig.year || { unitCount: 1, minSize: 150 };
            return {
                viewType: 'year',
                zoomLevel: ZOOM_MIN,
                slotSize: +(fallback.minSize * ZOOM_MIN).toFixed(2)
            };
        }

        return best;
    }
}
