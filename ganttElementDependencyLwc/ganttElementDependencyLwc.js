import { LightningElement, api, wire, track } from 'lwc';
import {
    getObjectInfo,
    getPicklistValuesByRecordType
} from 'lightning/uiObjectInfoApi';

import DEPENDENCY_OBJECT from '@salesforce/schema/GanttDependency__c';

const TYPE_FIELD = 'gmpkg__Type__c';
const DELAY_FIELD = 'gmpkg__Delay__c';
const SPAN_TYPE_FIELD = 'gmpkg__DelaySpanType__c';

import GanttDelay from '@salesforce/label/c.GanttDelay';
import GanttSelectType from '@salesforce/label/c.GanttSelectType';
import Type from '@salesforce/label/c.Type';

export default class GanttElementDependencyLwc extends LightningElement {
    //@labels
    labels = {
        Delay: GanttDelay,
        SelectType: GanttSelectType,
        Type
    };

    //@api properties
    @api isPredecessor;
    @api isSuccessor;

    @api
    get element() {
        return this.tElement;
    }
    set element(value) {
        this.tElement = value;
        if (this.tElement && this.tElement.dependency) {
            const {
                gmpkg__Type__c,
                gmpkg__Delay__c,
                gmpkg__DelaySpan__c,
                gmpkg__DelaySpanType__c
            } = this.tElement.dependency;

            this.tType = gmpkg__Type__c || 'end-to-start';
            this.tDelay = gmpkg__Delay__c || 'immediate';
            this.tSpan = gmpkg__DelaySpan__c || 0;
            this.tSpanType = gmpkg__DelaySpanType__c || 'days';
        }
    }

    //@track properties
    @track tElement;
    @track tType;
    @track tDelay;
    @track tSpan;
    @track tSpanType;

    @track typeOptions = [];
    @track delayOptions = [];
    @track spanTypeOptions = [];

    @wire(getObjectInfo, { objectApiName: DEPENDENCY_OBJECT })
    objectInfo;

    @wire(getPicklistValuesByRecordType, {
        objectApiName: DEPENDENCY_OBJECT,
        recordTypeId: '$objectInfo.data.defaultRecordTypeId'
    })
    wiredPicklists({ data }) {
        if (data && data.picklistFieldValues) {
            const picklists = data.picklistFieldValues;
            this.typeOptions = picklists[TYPE_FIELD].values;
            this.delayOptions = picklists[DELAY_FIELD].values;
            this.spanTypeOptions = picklists[SPAN_TYPE_FIELD].values;
        }
    }

    get dependency() {
        return this.tElement?.dependency;
    }

    get dependentTask() {
        return this.tElement?.dependentTask || {};
    }

    get dependentTaskName() {
        const key = this.dependentTask.gm__key || '';
        const taskTitle = this.dependentTask.gm__title || '(Unknown Task)';
        return key ? `${key} - ${taskTitle}` : taskTitle;
    }

    get isDelayImmediate() {
        return this.tDelay === 'immediate';
    }

    handleChange(event) {
        const field = event.target.name;
        const val = event.target.value;

        if (field === 'dependencyType') {
            this.tType = val;
        } else if (field === 'delayType') {
            this.tDelay = val;
            if (val === 'immediate') {
                this.tSpan = 0;
                this.tSpanType = 'days';
            }
        } else if (field === 'delaySpan') {
            this.tSpan = Number(val);
        } else if (field === 'spanType') {
            this.tSpanType = val;
        }

        this.dispatchEvent(
            new CustomEvent('editoraction', {
                bubble: true,
                composed: true,
                detail: {
                    action: 'updateDependency',
                    value: {
                        gm__dependencyUID: this.dependency.gm__dependencyUID,
                        gm__predecessorUID: this.dependency.gm__predecessorUID,
                        gm__successorUID: this.dependency.gm__successorUID,
                        gmpkg__Type__c: this.tType,
                        gmpkg__Delay__c: this.tDelay,
                        gmpkg__DelaySpan__c: this.tSpan,
                        gmpkg__DelaySpanType__c: this.tSpanType
                    }
                }
            })
        );
    }

    async handleDelete() {
        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: {
                    action: 'deleteDependency',
                    value: this.tElement.dependency.gm__dependencyUID
                }
            })
        );
    }
}
