import { LightningElement, api, track, wire } from 'lwc';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import LightningAlert from 'lightning/alert';

import RULE_OBJECT from '@salesforce/schema/GanttTaskRule__c';
import TYPE_FIELD from '@salesforce/schema/GanttTaskRule__c.Type__c';

import { getTimezoneDiff } from 'c/dateUtils';
import TIMEZONE from '@salesforce/i18n/timeZone';

import GanttConstraints from '@salesforce/label/c.GanttConstraints';
import GanttDeadlines from '@salesforce/label/c.GanttDeadlines';
import GanttSegments from '@salesforce/label/c.GanttSegments';
import GanttStartDate from '@salesforce/label/c.GanttStartDate';
import GanttEndDate from '@salesforce/label/c.GanttEndDate';
import Type from '@salesforce/label/c.Type';
import GanttConstraintDate from '@salesforce/label/c.GanttConstraintDate';
import GanttActive from '@salesforce/label/c.GanttActive';
import GanttAddRule from '@salesforce/label/c.GanttAddRule';

export default class GanttEditorTaskConstraintsLwc extends LightningElement {
    //static labels
    labels = {
        Constraints: GanttConstraints,
        Deadlines: GanttDeadlines,
        Segments: GanttSegments,
        StartDate: GanttStartDate,
        EndDate: GanttEndDate,
        Type,
        Date: GanttConstraintDate,
        Active: GanttActive,
        AddRule: GanttAddRule
    };

    //@api properties
    @api element;

    //atrack properties
    @track activeTab = 'Constraint';
    @track draftValues = [];

    @track inputType = '';
    @track inputDate = '';
    @track inputEndDate = '';

    @wire(getObjectInfo, { objectApiName: RULE_OBJECT })
    objectInfo;

    @wire(getPicklistValues, {
        recordTypeId: '$objectInfo.data.defaultRecordTypeId',
        fieldApiName: TYPE_FIELD
    })
    typePicklistInfo;

    get columns() {
        const cellClassAttr = { fieldName: 'rowClass' };
        const editable = { fieldName: 'editable' };

        const activeCol = {
            label: this.labels.Active,
            fieldName: 'gmpkg__IsActive__c',
            type: 'boolean',
            editable: editable,
            initialWidth: 70,
            cellAttributes: { class: cellClassAttr }
        };

        const dateTypeAttrs = {
            year: 'numeric',
            month: 'numeric',
            day: '2-digit'
        };

        const startDateCol = {
            label: this.isSegment ? this.labels.StartDate : this.labels.Date,
            fieldName: 'gmpkg__StartDate__c',
            type: 'date-local',
            editable: editable,
            typeAttributes: dateTypeAttrs,
            cellAttributes: { class: cellClassAttr }
        };

        const endDateCol = {
            label: this.labels.EndDate,
            fieldName: 'gmpkg__EndDate__c',
            type: 'date-local',
            editable: editable,
            typeAttributes: dateTypeAttrs,
            cellAttributes: { class: cellClassAttr }
        };

        const actionCol = {
            type: 'action',
            typeAttributes: {
                rowActions: this.getRowActions.bind(this)
            }
        };

        return [
            {
                label: '',
                fieldName: '',
                initialWidth: 30,
                type: 'button-icon',
                typeAttributes: {
                    iconName: { fieldName: 'iconName' },
                    variant: 'bare',
                    disabled: true
                }
            },
            activeCol,
            ...(!this.isSegment
                ? [
                      {
                          label: 'Type',
                          fieldName: 'gmpkg__Type__c',
                          type: 'text',
                          cellAttributes: { class: cellClassAttr }
                      }
                  ]
                : []),
            startDateCol,
            ...(this.isSegment ? [endDateCol] : []),
            actionCol
        ];
    }

    getRowActions(row, doneCallback) {
        const actions = [];
        actions.push({
            label: 'Delete',
            name: 'delete',
            iconName: 'utility:delete',
            disabled: row.gm__locked
        });
        doneCallback(actions);
    }

    get options() {
        return [
            {
                label: `${this.labels.Constraints} (${this.constraintCount})`,
                value: 'Constraint'
            },
            {
                label: `${this.labels.Deadlines} (${this.deadlineCount})`,
                value: 'Deadline'
            },
            {
                label: `${this.labels.Segments} (${this.segmentCount})`,
                value: 'Segment'
            }
        ];
    }

    get rules() {
        return this.element.gm__rules || [];
    }

    get constraintCount() {
        return this.rules.filter((r) => r.gmpkg__Category__c === 'Constraint')
            .length;
    }

    get deadlineCount() {
        return this.rules.filter((r) => r.gmpkg__Category__c === 'Deadline')
            .length;
    }

    get segmentCount() {
        return this.rules.filter((r) => r.gmpkg__Category__c === 'Segment')
            .length;
    }

    get isConstraint() {
        return this.activeTab === 'Constraint';
    }

    get isDeadline() {
        return this.activeTab === 'Deadline';
    }

    get isSegment() {
        return this.activeTab === 'Segment';
    }

    get typeOptions() {
        const data = this.typePicklistInfo.data;
        if (!data) return [];

        const controllerIndex = data.controllerValues[this.activeTab];
        const allOptions = data.values.filter((opt) =>
            opt.validFor.includes(controllerIndex)
        );

        if (this.isSegment) {
            return allOptions;
        }

        const usedTypes = new Set(
            this.rules
                .filter((r) => r.gmpkg__Category__c === this.activeTab)
                .map((r) => r.gmpkg__Type__c)
        );

        return allOptions.filter((opt) => !usedTypes.has(opt.value));
    }

    get isTypeDropdownDisabled() {
        return this.typeOptions.length === 0;
    }

    get showTypeDropdown() {
        return !this.isSegment;
    }

    get filteredRules() {
        if (!this.rules) return [];

        return this.rules
            .filter((r) => r.gmpkg__Category__c === this.activeTab)
            .map((r) => {
                const isLocked = r.gm__locked === true;
                const start = this.toDate(r.gmpkg__StartDate__c);
                const end = this.toDate(r.gmpkg__EndDate__c);

                return {
                    ...r,
                    gmpkg__StartDate__c: start.toISOString(),
                    gmpkg__EndDate__c: end?.toISOString(),
                    iconName: isLocked ? 'utility:lock' : '',
                    rowClass: isLocked ? 'locked-cell' : '',
                    editable: !isLocked
                };
            });
    }

    get hasRules() {
        return this.filteredRules.length > 0;
    }

    get isApplyDisabled() {
        if (!this.isSegment && !this.inputType) return true;
        if (!this.isSegment && this.isTypeDropdownDisabled) return true;
        if (!this.inputDate) return true;
        if (this.isSegment && !this.inputEndDate) return true;
        return false;
    }

    handleRadioChange(e) {
        this.activeTab = e.detail.value;
        this.draftValues = [];
        this.resetForm();
    }

    handleInputChange(e) {
        const name = e.target.name;
        if (name === 'type') this.inputType = e.detail.value;
        if (name === 'date') this.inputDate = e.detail.value;
        if (name === 'endDate') this.inputEndDate = e.detail.value;
    }

    resetForm() {
        this.inputDate = '';
        this.inputEndDate = '';
        this.inputType = '';

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const options = this.typeOptions;
            if (options && options.length > 0) {
                this.inputType = options[0].value;
            } else {
                this.inputType = '';
            }
        }, 50);
    }

    toDate(v) {
        if (!v) return null;

        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            const [y, m, d] = v.split('-').map(Number);
            return new Date(Date.UTC(y, m - 1, d));
        }

        const d = v instanceof Date ? v : new Date(v);
        return new Date(d.getTime() - getTimezoneDiff(d, TIMEZONE));
    }

    toStorageDate(v) {
        if (!v) return null;
        const d = v instanceof Date ? v : new Date(v);
        return new Date(d.getTime() + getTimezoneDiff(d, TIMEZONE));
    }

    async applyRule() {
        const startObj = this.toStorageDate(this.inputDate);
        const endObj = this.isSegment
            ? this.toStorageDate(this.inputEndDate)
            : null;

        const cleanStart = startObj ? startObj.toISOString() : null;
        const cleanEnd = endObj ? endObj.toISOString() : null;

        const payload = {
            gmpkg__TaskId__c: this.element.gm__recordId,
            gmpkg__Category__c: this.activeTab,
            gmpkg__Type__c: this.isSegment ? 'Work' : this.inputType,
            gmpkg__StartDate__c: cleanStart,
            gmpkg__EndDate__c: cleanEnd,
            gmpkg__IsActive__c: true,
            gm__elementUID: this.element.gm__elementUID,
            gm__ruleUID: 'row_' + Date.now()
        };

        const error = this.validateRules(payload);
        if (error) {
            await LightningAlert.open({
                message: error,
                theme: 'error',
                label: 'Logic Error'
            });
            return;
        }

        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: { action: 'createRule', value: payload }
            })
        );
        this.resetForm();
    }

    handleRowAction(event) {
        const action = event.detail.action;
        const row = event.detail.row;

        if (action.name === 'delete') {
            this.dispatchEvent(
                new CustomEvent('editoraction', {
                    detail: {
                        action: 'deleteRule',
                        value: {
                            gm__elementUID: this.element.gm__elementUID,
                            gm__ruleUID: row.gm__ruleUID
                        }
                    }
                })
            );
        }
    }

    async handleSave(event) {
        const updatedFields = event.detail.draftValues;

        for (let update of updatedFields) {
            if (update.gmpkg__StartDate__c) {
                const sObj = this.toStorageDate(update.gmpkg__StartDate__c);
                update.gmpkg__StartDate__c = sObj ? sObj.toISOString() : null;
            }
            if (update.gmpkg__EndDate__c) {
                const eObj = this.toStorageDate(update.gmpkg__EndDate__c);
                update.gmpkg__EndDate__c = eObj ? eObj.toISOString() : null;
            }

            const original = this.rules.find(
                (r) => r.gm__ruleUID === update.gm__ruleUID
            );
            const merged = {
                ...original,
                ...update,
                gm__elementUID: this.element.gm__elementUID
            };

            if (this.isSegment) {
                const sObj = this.toDate(merged.gmpkg__StartDate__c);
                const eObj = this.toDate(merged.gmpkg__EndDate__c);

                if (sObj && eObj && eObj.getTime() <= sObj.getTime()) {
                    // eslint-disable-next-line no-await-in-loop
                    await LightningAlert.open({
                        message: 'End Date must be after Start Date',
                        theme: 'error',
                        label: 'Validation'
                    });
                    return;
                }
            }

            this.dispatchEvent(
                new CustomEvent('editoraction', {
                    detail: { action: 'updateRule', value: merged }
                })
            );
        }
        this.draftValues = [];
    }

    validateRules(candidateRule) {
        const newStart = this.toDate(candidateRule.gmpkg__StartDate__c);
        const newEnd = candidateRule.gmpkg__EndDate__c
            ? this.toDate(candidateRule.gmpkg__EndDate__c)
            : null;

        if (this.isSegment) {
            return this.validateSegment(newStart, newEnd);
        }
        if (this.isConstraint) {
            return this.validateConstraint(
                newStart,
                candidateRule.gmpkg__Type__c
            );
        }
        if (this.isDeadline) {
            return this.validateDeadline(
                newStart,
                candidateRule.gmpkg__Type__c
            );
        }
        return null;
    }

    validateSegment(newStart, newEnd) {
        if (!newStart || !newEnd) return null;
        if (newEnd <= newStart) return 'End Date must be after Start Date.';

        const segments = this.rules.filter(
            (r) => r.gmpkg__Category__c === 'Segment'
        );

        for (let seg of segments) {
            const exStart = this.toDate(seg.gmpkg__StartDate__c);
            const exEnd = this.toDate(seg.gmpkg__EndDate__c);

            // Overlap Logic
            if (newStart < exEnd && newEnd > exStart) {
                return `Overlaps with existing segment.`;
            }
        }
        return null;
    }

    validateConstraint(newDate, type) {
        if (!newDate) return null;
        const constraints = this.rules.filter(
            (r) => r.gmpkg__Category__c === 'Constraint'
        );

        const findDate = (t) => {
            const rule = constraints.find((r) => r.gmpkg__Type__c === t);
            return rule ? this.toDate(rule.gmpkg__StartDate__c) : null;
        };

        if (type === 'SNET') {
            const snlt = findDate('SNLT');
            if (snlt && newDate > snlt) {
                return 'SNET cannot be after SNLT.';
            }
        }
        if (type === 'SNLT') {
            const snet = findDate('SNET');
            if (snet && newDate < snet) {
                return 'SNLT cannot be before SNET.';
            }
        }

        if (type === 'FNET') {
            const fnlt = findDate('FNLT');
            if (fnlt && newDate > fnlt) {
                return 'FNET cannot be after FNLT.';
            }
        }
        if (type === 'FNLT') {
            const fnet = findDate('FNET');
            if (fnet && newDate < fnet) {
                return 'FNLT cannot be before FNET.';
            }
        }

        if (type === 'MSO') {
            const mfo = findDate('MFO');
            if (mfo && newDate > mfo) {
                return 'MSO cannot be after MFO.';
            }
        }
        if (type === 'MFO') {
            const mso = findDate('MSO');
            if (mso && newDate < mso) {
                return 'MFO cannot be before MSO.';
            }
        }

        return null;
    }

    validateDeadline(newDate, type) {
        if (!newDate) return null;
        const deadlines = this.rules.filter(
            (r) => r.gmpkg__Category__c === 'Deadline'
        );

        if (type === 'Target Start') {
            const finishRule = deadlines.find(
                (r) => r.gmpkg__Type__c === 'Target End'
            );
            if (finishRule) {
                const finishDate = this.toDate(finishRule.gmpkg__StartDate__c);
                if (newDate > finishDate) {
                    return 'Target Start cannot be after Target End.';
                }
            }
        }
        if (type === 'Target End') {
            const startRule = deadlines.find(
                (r) => r.gmpkg__Type__c === 'Target Start'
            );
            if (startRule) {
                const startDate = this.toDate(startRule.gmpkg__StartDate__c);
                if (newDate < startDate) {
                    return 'Target End cannot be before Target Start.';
                }
            }
        }
        return null;
    }
}
