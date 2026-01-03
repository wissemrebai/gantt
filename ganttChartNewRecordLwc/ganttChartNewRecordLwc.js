/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
import { api, track, wire } from 'lwc';
import LightningModal from 'lightning/modal';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfos } from 'lightning/uiObjectInfoApi';

import NoFieldSelected from '@salesforce/label/c.NoFieldSelected';
import TaostError from '@salesforce/label/c.TaostError';
import Save from '@salesforce/label/c.Save';
import Cancel from '@salesforce/label/c.Cancel';
import Previous from '@salesforce/label/c.Previous';
import NewGanttRecord from '@salesforce/label/c.GanttNewRecord';

export default class GanttChartNewRecordLwc extends LightningModal {
    //@labels
    labels = {
        Save,
        Cancel,
        Previous,
        TaostError,
        NoFieldSelected,
        NewGanttRecord
    };

    //@api properties
    @api objectConfigs;
    @api parentTask;
    @api actionTitle;
    @api occurences;
    @api ganttId;
    @api order;

    //@track properties
    @track isReady = false;
    @track isWorking = false;
    @track tObjectConfigs = [];
    @track selectedObjectConfig;

    @track errors = [];

    get objectApiNames() {
        return this.objectConfigs?.map((o) => {
            return o.name;
        });
    }

    get objectApiName() {
        return this.selectedObjectConfig?.name;
    }

    get defaultValues() {
        return this.selectedObjectConfig?.defaultValues;
    }

    get modalHeaderLabel() {
        if (this.selectedObjectConfig) {
            return `New ${this.selectedObjectConfig.label}`;
        }
        return this.labels.NewGanttRecord;
    }

    @wire(getObjectInfos, { objectApiNames: '$objectApiNames' })
    handleObjectInfos({ data, err }) {
        if (data && data.results) {
            this.processObjectInfos(data.results);
        } else if (err) {
            console.error(err);
        }
    }

    processObjectInfos(results) {
        this.tObjectConfigs = this.objectConfigs.map((o) => {
            let objectInfo = results.find(
                (r) => r.result.apiName === o.name
            )?.result;

            return {
                ...o,
                label: objectInfo.label,
                requiredFields: Object.keys(objectInfo.fields)
                    .filter(
                        (fieldName) =>
                            objectInfo.fields[fieldName].required &&
                            objectInfo.fields[fieldName].updateable &&
                            objectInfo.fields[fieldName].apiName !== 'OwnerId'
                    )
                    .map((fieldName) => ({
                        apiName: fieldName,
                        label: objectInfo.fields[fieldName].label
                    }))
            };
        });

        if (this.tObjectConfigs.length === 1) {
            this.selectedObjectConfig = this.tObjectConfigs[0];
        }

        this.isReady = true;
    }

    async handleSubmit(event) {
        event.preventDefault();

        let fields = event.detail.fields;
        let records = [];
        for (let i = 0; i < this.occurences; i++) {
            records.push({
                sobjectType: this.objectApiName,
                ...fields
            });
        }

        try {
            this.isWorking = false;

            let elements = [];
            for (let i = 0; i < records.length; i++) {
                let element = {
                    sobjectType: 'gmpkg__GanttElement__c',
                    gmpkg__SObjectType__c: this.objectApiName,
                    gmpkg__GanttId__c: this.ganttId,
                    gmpkg__Order__c: this.order + i,
                    gmpkg__Type__c: 'task',
                    gmpkg__Parent__c: this.parentTask?.gm__elementId,
                    gm__parentUID: this.parentTask?.gm__elementUID
                };

                elements.push(element);
            }

            this.close({
                status: 'success',
                elements,
                records,
                objectApiName: this.objectApiName
            });
        } catch (err) {
            this.errors = this.handleServerError(err);
            this.showToast('error', this.labels.TaostError, this.errors);
            console.error(this.errors);
        } finally {
            this.isWorking = false;
        }
    }

    handleSave(event) {
        this.template.querySelector('c-dynamic-record-edit-form-lwc')?.submit();
    }

    handleSuccess(event) {
        this.isWorking = false;
        this.close('success');
    }

    handleError(event) {
        this.isWorking = false;
        this.errors = this.handleServerError(event.detail);
        this.showToast('error', this.labels.TaostError, this.errors);
    }

    handleCancel() {
        this.close('cancel');
    }

    handlePrevious() {
        this.selectedObjectConfig = null;
    }

    handleSelect(event) {
        let objectApiName = event.currentTarget.dataset.object;

        this.selectedObjectConfig = this.tObjectConfigs.find(
            (r) => r.name === objectApiName
        );
    }

    handleServerError(err) {
        let errList = [];
        let firstErr = err;

        if (err && Array.isArray(err)) {
            firstErr = err[0];
        }

        if (firstErr && firstErr.body.message) {
            try {
                errList = JSON.parse(firstErr.body.message).map((e) => {
                    return { message: `${e.UID} : ${e.message}` };
                });
            } catch (e) {
                errList = [{ message: firstErr.body.message }];
            }
        }

        if (firstErr && firstErr.pageErrors) {
            errList = [{ message: firstErr.pageErrors[0].message }];
        }

        return errList;
    }

    showToast(variant, title, message) {
        this.dispatchEvent(
            new ShowToastEvent({
                variant,
                title,
                message
            })
        );
    }
}
