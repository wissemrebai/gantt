import { LightningElement, api, track } from 'lwc';

import Edit from '@salesforce/label/c.Edit';
import Save from '@salesforce/label/c.Save';
import Cancel from '@salesforce/label/c.Cancel';
import GanttTypeTask from '@salesforce/label/c.GanttTypeTask';
import GanttTypeMilestone from '@salesforce/label/c.GanttTypeMilestone';
import GanttTypeSummary from '@salesforce/label/c.GanttTypeSummary';

import milestoneToTaskModal from 'c/ganttMilestoneToTaskModalLwc';

export default class GanttEditorDetailsLwc extends LightningElement {
    labels = {
        Edit,
        Save,
        Cancel,
        GanttTypeTask,
        GanttTypeMilestone,
        GanttTypeSummary
    };

    @api taskManager;

    @api
    get element() {
        return this.telement;
    }
    set element(value) {
        let el = { ...value };
        const conf = el.gm__config || {};

        el[conf.titleFieldName] = el.gm__title;
        el[conf.fromDateFieldName] = el.gm__start?.toISOString();
        el[conf.toDateFieldName] = el.gm__end?.toISOString();
        el[conf.progressFieldName] = el.gm__progress;
        el[conf.orderFieldName] = el.gm__orderId;

        // Get detailFields from taskManager by object API name
        const objectApiName = el.gm__objectApiName;
        let detailFields = [];
        if (this.taskManager && objectApiName) {
            detailFields = this.taskManager.getDetailFields(objectApiName);
        }
        const fields = JSON.parse(JSON.stringify(detailFields));

        const isSummary = el.gm__type === 'summary';
        if (isSummary && fields.length) {
            fields.forEach((f) => {
                if (
                    f.name === conf.fromDateFieldName ||
                    f.name === conf.toDateFieldName
                ) {
                    f.disabled = true;
                }
            });
        }
        this.telement = el;
        this.fields = fields;
    }

    @track telement;
    @track fields = [];
    @track fieldValues = {};

    editMode = false;

    get canEdit() {
        return this.element.gm__canEdit;
    }

    get type() {
        return this.element?.gm__type || 'task';
    }

    get isTaskDisabled() {
        return (this.element?.gm__children || []).length > 0;
    }

    get isMilestoneDisabled() {
        return (this.element?.gm__children || []).length > 0;
    }

    get isSummaryDisabled() {
        const a = this.element?.gm__acceptedChildren || [];
        if (a.length === 0) return true;
        return false;
    }

    get taskVariant() {
        return this.type === 'task' ? 'brand' : 'neutral';
    }

    get milestoneVariant() {
        return this.type === 'milestone' ? 'brand' : 'neutral';
    }

    get summaryVariant() {
        return this.type === 'summary' ? 'brand' : 'neutral';
    }

    async updateRequestType(event) {
        let newType = event.currentTarget.dataset.id;
        if (!newType || newType === this.type) return;

        let newTask = {
            gm__elementUID: this.element.gm__elementUID,
            gm__title: this.element.gm__title,
            gm__start: this.element.gm__start,
            gm__end: this.element.gm__end,
            gm__endDateType: this.element.gm__endDateType,
            gm__startDateType: this.element.gm__startDateType,
            gm__type: newType
        };

        if (this.type === 'milestone') {
            let res = await milestoneToTaskModal.open({
                task: newTask,
                label: 'Edit',
                size: 'small'
            });

            if (res && res.result === 'success') {
                this.changeTypeAndDate(res.task);
            }
            return;
        }

        if (newType === 'milestone') {
            newTask.gm__end = this.element.gm__start;
        }

        this.changeTypeAndDate(newTask);
    }

    changeTypeAndDate(newTask) {
        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: {
                    action: 'updateTask',
                    value: {
                        gm__elementUID: newTask.gm__elementUID,
                        gm__type: newTask.gm__type,
                        gm__end: newTask.gm__end
                    }
                }
            })
        );
    }

    handleEdit() {
        this.fieldValues = { ...this.element };
        this.editMode = true;
    }

    handleInputFieldChange(event) {
        const fieldName = event.detail.field.name;
        const fieldValue = event.detail.value;

        this.fieldValues = {
            ...this.fieldValues,
            [fieldName]: fieldValue
        };
    }

    handleSubmit() {
        if (!this.validateForm()) return;

        const isSummary = this.type === 'summary';
        const conf = this.element.gm__config || {};
        const usedFieldNames = new Set(this.fields.map((f) => f.name));

        const toDate = (v) => {
            if (!v) return null;
            const d = v instanceof Date ? v : new Date(v);
            return new Date(d.getTime());
        };

        const remap = {
            [conf.titleFieldName]: 'gm__title',
            [conf.fromDateFieldName]: 'gm__start',
            [conf.toDateFieldName]: 'gm__end',
            [conf.progressFieldName]: 'gm__progress',
            [conf.orderFieldName]: 'gm__orderId'
        };

        const record = {
            gm__elementUID: this.element.gm__elementUID
        };

        const source = { ...this.element, ...this.fieldValues };

        usedFieldNames.forEach((srcField) => {
            const oldVal = this.element[srcField];
            const newVal =
                srcField in this.fieldValues
                    ? this.fieldValues[srcField]
                    : source[srcField];

            if (newVal === undefined && oldVal === undefined) {
                return;
            }

            if (!this.isDifferent(oldVal, newVal)) {
                return;
            }

            const gmField = remap[srcField];

            if (
                isSummary &&
                (gmField === 'gm__start' || gmField === 'gm__end')
            ) {
                return;
            }

            record[srcField] = newVal;

            if (gmField) {
                let gmValue = newVal;

                if (gmField === 'gm__start' || gmField === 'gm__end') {
                    gmValue = toDate(newVal);
                } else if (gmField === 'gm__progress') {
                    gmValue = newVal != null ? Number(newVal) : null;
                }

                record[gmField] = gmValue;
            }
        });

        if (Object.keys(record).length === 1) {
            this.editMode = false;
            return;
        }

        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: {
                    action: 'updateTask',
                    value: record
                }
            })
        );

        this.editMode = false;
    }

    handleCancel() {
        this.editMode = false;
    }

    // helpers

    validateForm() {
        let isValid = true;

        this.template
            .querySelectorAll('[data-id="inputField"]')
            .forEach((field) => {
                if (!field.reportValidity()) {
                    isValid = false;
                }
            });

        return isValid;
    }

    isDifferent(oldVal, newVal) {
        if (oldVal === newVal) {
            return false;
        }

        if (oldVal == null || newVal == null) {
            return true;
        }

        const isDateLike = (v) =>
            v instanceof Date ||
            (typeof v === 'string' && !isNaN(new Date(v).getTime()));

        if (isDateLike(oldVal) || isDateLike(newVal)) {
            const d1 = oldVal instanceof Date ? oldVal : new Date(oldVal);
            const d2 = newVal instanceof Date ? newVal : new Date(newVal);
            return d1.getTime() !== d2.getTime();
        }

        if (typeof oldVal === 'number' || typeof newVal === 'number') {
            const n1 = Number(oldVal);
            const n2 = Number(newVal);
            if (Number.isNaN(n1) && Number.isNaN(n2)) return false;
            return n1 !== n2;
        }

        const isObj = (v) => v && (typeof v === 'object' || Array.isArray(v));

        if (isObj(oldVal) || isObj(newVal)) {
            try {
                return JSON.stringify(oldVal) !== JSON.stringify(newVal);
            } catch {
                return true;
            }
        }

        return String(oldVal) !== String(newVal);
    }
}