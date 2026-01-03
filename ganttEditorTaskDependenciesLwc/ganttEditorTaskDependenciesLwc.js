import { LightningElement, api } from 'lwc';

import Successors from '@salesforce/label/c.GanttSuccessors';
import Predecessors from '@salesforce/label/c.GanttPredecessors';

export default class GanttEditorTaskDependenciesLwc extends LightningElement {
    // Static labels
    labels = {
        Predecessors,
        Successors
    };

    //@api properties
    @api element;
    @api taskManager;

    get predecessorTasks() {
        const list = [];

        if (!this.taskManager?.dependencies || !this.element?.gm__elementUID) {
            return list;
        }

        const taskUID = this.element.gm__elementUID;
        const predecessorDeps = this.taskManager.dependencies.filter(
            (d) => d.gm__successorUID === taskUID
        );

        predecessorDeps.forEach((d) => {
            const t = this.taskManager.getTaskById(d.gm__predecessorUID);
            if (t) {
                list.push({
                    dependency: d,
                    dependentTask: t,
                    selectedTask: this.element
                });
            }
        });

        return list;
    }

    get successorTasks() {
        const list = [];

        if (!this.taskManager?.dependencies || !this.element?.gm__elementUID) {
            return list;
        }

        const taskUID = this.element.gm__elementUID;
        const successorDeps = this.taskManager.dependencies.filter(
            (d) => d.gm__predecessorUID === taskUID
        );

        successorDeps.forEach((d) => {
            const t = this.taskManager.getTaskById(d.gm__successorUID);
            if (t) {
                list.push({
                    dependency: d,
                    dependentTask: t,
                    selectedTask: this.element
                });
            }
        });

        return list;
    }

    get hasPredecessors() {
        return this.predecessorTasks.length > 0;
    }

    get hasSuccessors() {
        return this.successorTasks.length > 0;
    }

    handleEditorAction(event) {
        this.dispatchEvent(
            new CustomEvent('editoraction', { detail: event.detail })
        );
    }
}
