/* eslint-disable @lwc/lwc/no-async-operation */
import { LightningElement, api, track } from 'lwc';

export default class GanttEditorTaskChecklistLwc extends LightningElement {
    @api
    get element() {
        return this._element;
    }
    set element(value) {
        this._element = value;
        this.loadChecklist(); // Reload local items when parent updates element
    }

    @track items = [];

    labels = { Title: 'Title', Details: 'Details' };

    // Internal state
    _originalValue = '';
    _saveTimeout; // Timer for batching saves
    _element;

    dateFormatter = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    });

    renderedCallback() {
        this.syncInputs();
    }

    // --- Getters ---
    get activeItems() {
        return (this.items || []).filter((i) => !i.completed);
    }
    get completedItems() {
        return (this.items || []).filter((i) => i.completed);
    }
    get hasCompletedItems() {
        return this.completedItems.length > 0;
    }
    get completedLabel() {
        return `Completed Tasks (${this.completedItems.length})`;
    }

    // --- Data Loading ---
    loadChecklist() {
        this.items = this.element?.gm__checkList || [];
    }

    // --- DOM Sync ---
    syncInputs() {
        const active = this.template.activeElement;
        this.items.forEach((item) => {
            const titleInput = this.template.querySelector(
                `.title-editable[data-id="${item.id}"]`
            );
            const descInput = this.template.querySelector(
                `.description-editable[data-id="${item.id}"]`
            );

            if (
                titleInput &&
                titleInput !== active &&
                titleInput.value !== item.text
            ) {
                titleInput.value = item.text || '';
                this.adjustTextareaHeight(titleInput); // Auto-size title on load
            }

            if (
                descInput &&
                descInput !== active &&
                descInput.value !== item.description
            ) {
                descInput.value = item.description || '';
                this.adjustTextareaHeight(descInput);
            }
        });
    }

    // --- Optimised Save Logic ---

    /**
     * Schedules a save.
     * - Rapid actions (checkboxes) use a delay to batch them.
     * - Explicit actions (blur) can save immediately.
     */
    scheduleSave(delay = 1500) {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }

        this._saveTimeout = setTimeout(() => {
            this.dispatchSave();
        }, delay);
    }

    dispatchSave() {
        // Clear timeout to prevent double firing if called directly
        if (this._saveTimeout) clearTimeout(this._saveTimeout);

        const detail = {
            action: 'saveChecklist', // Updated action name
            value: {
                gm__elementUID: this.element.gm__elementUID,
                checkList: { items: [...this.items] }
            }
        };

        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail,
                bubbles: true,
                composed: true
            })
        );
    }

    // --- Event Handlers ---
    handleFocus(event) {
        this._originalValue = event.target.value;
        this.adjustTextareaHeight(event.target);
    }

    handleTitleInput(event) {
        const id = event.target.dataset.id;
        this.items = this.items.map((item) => {
            if (item.id === id) {
                return { ...item, text: event.target.value };
            }
            return item;
        });
        this.adjustTextareaHeight(event.target);
    }

    handleDescriptionInput(event) {
        const id = event.target.dataset.id;
        this.items = this.items.map((item) => {
            if (item.id === id) {
                return { ...item, description: event.target.value };
            }
            return item;
        });
        this.adjustTextareaHeight(event.target);
    }

    handleBlur(event) {
        const id = event.target.dataset.id;
        const currentValue = event.target.value;
        const item = this.items.find((i) => i.id === id);

        if (!item) return;

        // Cleanup empty items
        const isTitleEmpty = !item.text || item.text.trim() === '';
        const isDescEmpty = !item.description || item.description.trim() === '';

        if (isTitleEmpty && isDescEmpty) {
            this.items = this.items.filter((i) => i.id !== id);
            this.scheduleSave(500); // Immediate save for cleanup
            return;
        }

        // Only save if value actually changed
        if (currentValue !== this._originalValue) {
            this.scheduleSave(500); // Immediate save for text edits
        }
    }

    // Toggles/Deletes: Save with delay (Batching)
    handleToggleComplete(event) {
        const id = event.target.dataset.id;
        this.items = this.items.map((item) => {
            if (item.id === id) {
                const isNowDone = !item.completed;
                return {
                    ...item,
                    completed: isNowDone,
                    completedDate: isNowDone
                        ? this.dateFormatter.format(new Date())
                        : null
                };
            }
            return item;
        });
        // Wait 1.5s. If user checks another box, this timer resets.
        this.scheduleSave(1500);
    }

    handleDeleteItem(event) {
        const id = event.target.dataset.id;
        this.items = this.items.filter((i) => i.id !== id);
        // Wait 1.5s to see if user deletes more items
        this.scheduleSave(1500);
    }

    // Add Item: Local only. Save happens when user types & blurs.
    handleAddItem(location = 'start', refId = null) {
        const newItem = {
            id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            text: '',
            description: '',
            completed: false,
            completedDate: null
        };

        if (location === 'start') {
            this.items = [newItem, ...this.items];
        } else {
            const idx = this.items.findIndex((i) => i.id === refId);
            this.items.splice(idx + 1, 0, newItem);
            this.items = [...this.items];
        }

        setTimeout(() => {
            const el = this.template.querySelector(
                `.title-editable[data-id="${newItem.id}"]`
            );
            if (el) el.focus();
        }, 50);
    }

    handleTitleKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.handleAddItem('after', event.target.dataset.id);
        }
    }

    handleAddButtonClick() {
        this.handleAddItem('start');
    }

    adjustTextareaHeight(el) {
        if (!el) return;

        if (!el.value) {
            el.style.height = '';
            el.style.overflowY = 'hidden';
            return;
        }

        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';

        if (el.classList.contains('description-editable')) {
            el.style.overflowY = 'auto';
        } else {
            el.style.overflowY = 'hidden';
        }
    }
}
