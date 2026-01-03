/* eslint-disable @lwc/lwc/no-async-operation */
import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

// labels
import Details from '@salesforce/label/c.GanttDetails';
import Dependency from '@salesforce/label/c.GanttDependency';
import Successors from '@salesforce/label/c.GanttSuccessors';
import Predecessors from '@salesforce/label/c.GanttPredecessors';
import Successor from '@salesforce/label/c.GanttSuccessor';
import Search from '@salesforce/label/c.Search';
import Delete from '@salesforce/label/c.Delete';
import Predecessor from '@salesforce/label/c.GanttPredecessor';
import Type from '@salesforce/label/c.GanttType';
import GanttTypeTask from '@salesforce/label/c.GanttTypeTask';
import GanttTypeMilestone from '@salesforce/label/c.GanttTypeMilestone';
import GanttTypeSummary from '@salesforce/label/c.GanttTypeSummary';
import NoRecordSelectedTitle from '@salesforce/label/c.NoRecordSelectedTitle';
import NoRecordSelectedSubtitle from '@salesforce/label/c.NoRecordSelectedSubtitle';
import Apply from '@salesforce/label/c.Apply';
import GanttDependencies from '@salesforce/label/c.GanttDependencies';
import GanttRules from '@salesforce/label/c.GanttRules';
import GanttAssignees from '@salesforce/label/c.GanttAssignees';
import GanttConstraintDeadline from '@salesforce/label/c.GanttConstraintDeadline';
import GanttConstraintType from '@salesforce/label/c.GanttConstraintType';
import GanttConstraintDate from '@salesforce/label/c.GanttConstraintDate';

const GanttChecklist = 'Checklist';

export default class GanttElementEditorLwc extends NavigationMixin(
    LightningElement
) {
    // Static labels
    labels = {
        Details,
        Dependency,
        Successor,
        Predecessor,
        Successors,
        Predecessors,
        Type,
        Search,
        Delete,
        GanttTypeTask,
        GanttTypeMilestone,
        GanttTypeSummary,
        NoRecordSelectedTitle,
        NoRecordSelectedSubtitle,
        Apply,
        Dependencies: GanttDependencies,
        Rules: GanttRules,
        Checklist: GanttChecklist,
        Assignees: GanttAssignees,
        ConstraintDeadline: GanttConstraintDeadline,
        ConstraintType: GanttConstraintType,
        ConstraintDate: GanttConstraintDate
    };
    // state properties
    @track tSelectedElement;
    recordPageUrl;
    isRendered = false;
    counterChecklist = 0;
    
    // public api
    @api options; // { defaultRightPanelOpen, rowHeight, displayedTasks, availableResources }
    @api taskManager;
    @api get fullscreen() {
        return this.tFullScreen;
    }
    set fullscreen(value) {
        this.tFullScreen = value;
        this.adjustHeight();
    }

    @api
    get selectedElement() {
        return this.tSelectedElement;
    }
    set selectedElement(value) {
        this.tSelectedElement = value;
        this.recordPageUrl = null;
        this.counterChecklist =
            this.tSelectedElement?.gm__checkListCounter || 0;

        this.adjustHeight();

        if (this.isTask) {
            setTimeout(() => {
                this[NavigationMixin.GenerateUrl]({
                    type: 'standard__recordPage',
                    attributes: {
                        recordId: this.tSelectedElement?.Id,
                        actionName: 'view'
                    }
                }).then((url) => {
                    this.recordPageUrl = url;
                });
            }, 0);
        }
    }

    get elementType() {
        return this.tSelectedElement?.type;
    }

    get isTask() {
        return this.elementType === 'task';
    }

    get isDependency() {
        return this.elementType === 'dependency';
    }

    get taskElement() {
        return this.tSelectedElement;
    }

    get dependencyElement() {
        if (this.isDependency) {
            let el = this.tSelectedElement;
            const predTask = this.taskManager.getTaskById(
                el.gm__predecessorUID
            );
            const succTask = this.taskManager.getTaskById(el.gm__successorUID);

            return {
                dependency: this.tSelectedElement,
                dependentTask: predTask,
                selectedTask: succTask
            };
        }
        return null;
    }

    get showDelete() {
        return this.tSelectedElement && this.tSelectedElement.gm__canDelete;
    }

    get iconName() {
        if (this.isDependency) {
            return 'standard:linked';
        }

        return this.tSelectedElement?.gm__iconName;
    }

    get title() {
        if (this.isDependency) {
            return this.labels.Dependency;
        }

        return this.tSelectedElement?.gm__title;
    }

    get predecessorTasks() {
        const list = [];
        if (
            !this.taskManager?.dependencies ||
            !this.tSelectedElement?.gm__elementUID
        ) {
            return list;
        }

        const taskUID = this.tSelectedElement.gm__elementUID;
        const predecessorDeps = this.taskManager.dependencies.filter(
            (d) => d.gm__successorUID === taskUID
        );

        return predecessorDeps;
    }

    get successorTasks() {
        const list = [];

        if (
            !this.taskManager?.dependencies ||
            !this.tSelectedElement?.gm__elementUID
        ) {
            return list;
        }

        const taskUID = this.tSelectedElement.gm__elementUID;
        const successorDeps = this.taskManager.dependencies.filter(
            (d) => d.gm__predecessorUID === taskUID
        );
        return successorDeps;
    }

    get showDependencies() {
        return this.predecessorTasks.length || this.successorTasks.length;
    }

    get dependenciesLabel() {
        return `${this.labels.Dependencies} (${
            this.predecessorTasks.length + this.successorTasks.length
        })`;
    }

    get showAssignees() {
        return this.isTask && this.tSelectedElement.gm__type !== 'summary';
    }

    get assigneesLabel() {
        return `${this.labels.Assignees} (${
            (this.tSelectedElement?.gm__resourceData || []).length
        })`;
    }

    get rulesLabel() {
        return `${this.labels.Rules} (${
            (this.tSelectedElement?.gm__rules || []).length
        })`;
    }

    get checkListLabel() {
        return `${this.labels.Checklist} (${this.counterChecklist})`;
    }

    renderedCallback() {
        if (this.isRendered === false) {
            this.isRendered = true;
            this.adjustHeight();
        }
    }

    handleDelete() {
        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: {
                    action: 'deleteTask',
                    value: {
                        gm__elementUID: this.tSelectedElement.gm__elementUID
                    }
                }
            })
        );
    }

    handleEditorAction(event) {
        const { action, value } = event.detail;

        // Handle checklist updates locally to update the label count
        if (action === 'saveChecklist' && value?.checkList) {
            this.updateChecklistCount(value.checkList.items);
        }

        // Bubble up the event to parent
        this.dispatchEvent(
            new CustomEvent('editoraction', { detail: event.detail })
        );
    }

    adjustHeight() {
        if (this.isRendered === false) return;

        const container = this.refs.editorContainer;
        if (!container) return;

        const { rowHeight, displayedTasks, minGanttHeight } = this.options;
        const FULLSCREEN_OFFSET = 240;
        const UNLIMITED_TASKS_THRESHOLD = 999;

        if (this.fullscreen) {
            container.style.setProperty(
                '--gm-grid-content-height',
                `calc(100vh - ${FULLSCREEN_OFFSET}px)`
            );
            return;
        }

        if (displayedTasks === UNLIMITED_TASKS_THRESHOLD) {
            this.template.host.style.setProperty(
                '--gm-grid-content-min-height',
                minGanttHeight
            );
            container.style.removeProperty('--gm-grid-content-height');
            return;
        }

        const calculatedHeight = rowHeight * displayedTasks;
        container.style.setProperty(
            '--gm-grid-content-height',
            `${calculatedHeight}px`
        );
    }

    handleKeydown(event) {
        event.stopPropagation();
    }

    updateChecklistCount(checkListItems) {
        if (this.tSelectedElement && this.isTask) {
            // Update only the gm__checkList property to trigger reactive getter
            this.counterChecklist = checkListItems.filter(
                (i) => !i.completed
            ).length;
        }
    }
}
