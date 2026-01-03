import { LightningElement, api } from 'lwc';

export default class GanttEditorDependencyLwc extends LightningElement {
    @api element; // dependency element

    handleEditorAction(event) {
        this.dispatchEvent(
            new CustomEvent('editoraction', { detail: event.detail })
        );
    }
}
