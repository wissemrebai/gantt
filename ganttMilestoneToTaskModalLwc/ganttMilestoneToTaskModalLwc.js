import { api } from 'lwc';
import LightningModal from 'lightning/modal';

import Edit from '@salesforce/label/c.Edit';
import Cancel from '@salesforce/label/c.Cancel';
import Submit from '@salesforce/label/c.Submit';
import GanttStartDate from '@salesforce/label/c.GanttStartDate';
import GanttEndDate from '@salesforce/label/c.GanttEndDate';

export default class GanttMilestoneToTaskModalLwc extends LightningModal {
    //labels
    labels = {
        Edit,
        Cancel,
        Submit,
        StartDate: GanttStartDate,
        EndDate: GanttEndDate
    };

    //@api properties
    @api task;

    get title() {
        return `${this.labels.Edit} ${this.task.gm__title}`;
    }

    get startDateFormat() {
        return this.task.gm__startDateType === 'datetime'
            ? 'datetime-local'
            : 'date';
    }

    get endDateFormat() {
        return this.task.gm__endDateType === 'datetime'
            ? 'datetime-local'
            : 'date';
    }

    get startDate() {
        return this.task.gm__start.toISOString();
    }

    get endDate() {
        return this.task.gm__end.toISOString();
    }

    handleSubmit() {
        let newTask = JSON.parse(JSON.stringify(this.task));
        newTask.gm__start = new Date(this.refs.startDate.value);
        newTask.gm__end = new Date(this.refs.endDate.value);

        this.close({
            result: 'success',
            task: newTask
        });
    }

    handleCancel() {
        this.close({
            action: 'cancel'
        });
    }
}
