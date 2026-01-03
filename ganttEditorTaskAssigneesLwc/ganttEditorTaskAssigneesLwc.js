import { LightningElement, api } from 'lwc';

import Search from '@salesforce/label/c.Search';
import Delete from '@salesforce/label/c.Delete';

export default class GanttEditorTaskAssigneesLwc extends LightningElement {
    //labels
    labels = {
        Search,
        Delete
    };

    //@api properties
    @api options;

    @api
    get element() {
        return this.telement;
    }
    set element(value) {
        this.telement = value;
        this.lookupCmp?.setSearchResults([]);
        this.lookupCmp?.blur();
    }

    //@track properties
    telement;

    get assignees() {
        return this.element?.gm__resourceData || [];
    }

    get isSummary() {
        return this.element?.gm__type === 'summary';
    }

    get isDirectField() {
        const taskConfig = this.element?.gm__config;
        const resConfig = taskConfig?.resourceConfig;
        if (!resConfig) return false;

        return (
            resConfig.objectApiName === this.element?.gm__objectApiName &&
            resConfig.taskIdField === 'Id'
        );
    }

    get showDeleteButton() {
        return !this.isDirectField && !this.isSummary;
    }

    get lookupCmp() {
        return this.template.querySelector('c-reusable-lookup-l-w-c');
    }

    get lookupDisabled() {
        return (
            this.lookupOptions.length > 0 &&
            this.lookupOptions.every((opt) => opt.disabled === true)
        );
    }

    get lookupOptions() {
        function formatListToSoql(values, keyField = 'gm__resourceId') {
            if (!Array.isArray(values) || !values.length)
                return "('000000000000000AAA')";

            return "('" + values.map((v) => v[keyField]).join("','") + "')";
        }

        function arraysAreEqual(a, b, key = 'gm__resourceId') {
            if (a.length !== b.length) return false;
            const aIds = a.map((v) => v[key]).sort();
            const bIds = b.map((v) => v[key]).sort();
            return JSON.stringify(aIds) === JSON.stringify(bIds);
        }

        const available = this.options?.availableResources || [];
        const assignees = this.assignees || [];

        const taskConfig = this.element.gm__config;
        const taskResConfig = taskConfig.resourceConfig;

        const assignObjectApiName = taskResConfig.resourceField.objectApiName;
        if (!assignObjectApiName) {
            return [];
        }

        const projectResourceConfs = this.options.projectConfig?.resourceConfig;
        if (
            !Array.isArray(projectResourceConfs) ||
            !projectResourceConfs.length
        ) {
            return [];
        }

        const lookupOptions = [];

        for (const resourceConfig of projectResourceConfs) {
            const resObjectApiName = resourceConfig.objectApiName;

            if (resObjectApiName !== assignObjectApiName) {
                continue;
            }

            const availableOfType = available.filter(
                (res) => res.objectApiName === resObjectApiName
            );

            if (!availableOfType.length) {
                continue;
            }

            const assigneesOfType = assignees.filter(
                (res) => res.objectApiName === resObjectApiName
            );

            const filter = {
                and: [
                    {
                        Id: {
                            operator: 'in',
                            value: formatListToSoql(availableOfType)
                        }
                    },
                    {
                        Id: {
                            operator: 'not in',
                            value: formatListToSoql(assigneesOfType)
                        }
                    }
                ]
            };

            lookupOptions.push({
                name: resObjectApiName,
                label: resourceConfig.label || resObjectApiName,
                value: resObjectApiName,
                title: resourceConfig.titleField,
                subTitle: resourceConfig.subtitleField,
                extraFields: [resourceConfig.avatarUrlField].filter(Boolean),
                iconName: 'standard:user',
                lookupFilter: JSON.stringify(filter),
                disabled: arraysAreEqual(availableOfType, assigneesOfType)
            });
        }

        return lookupOptions;
    }

    handleLookupChange(event) {
        const value = event.detail || {};
        if (!value.Id) return;

        const projectResourceConfigs =
            this.options.projectConfig?.resourceConfig;
        if (
            !Array.isArray(projectResourceConfigs) ||
            !projectResourceConfigs.length
        ) {
            return;
        }

        const resourceConfig = projectResourceConfigs.find(
            (config) => config.objectApiName === value.apiName
        );

        const title = this.getNestedFieldValue(
            value.fields,
            resourceConfig.titleField
        );
        const subtitle = this.getNestedFieldValue(
            value.fields,
            resourceConfig.subtitleField
        );
        const src = this.getNestedFieldValue(
            value.fields,
            resourceConfig.avatarUrlField
        );

        const resource = {
            gm__resourceId: value.Id,
            title,
            subtitle,
            src,
            initials: (title || '')
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 3)
                .toUpperCase(),
            objectApiName: resourceConfig.objectApiName
        };

        let updated;
        if (this.isDirectField) {
            updated = [resource];
        } else {
            const existing = (this.element?.gm__resourceData || []).filter(
                (a) => a.gm__resourceId !== resource.gm__resourceId
            );
            updated = [...existing, resource];
        }

        this.lookupCmp?.handleClearSelection(false);
        this.lookupCmp?.blur();

        this.updateAssignees(updated);
    }

    handleDelete(event) {
        const { resourceid } = event.currentTarget.dataset;
        const updated = (this.element.gm__resourceData || []).filter(
            (a) => a.gm__resourceId !== resourceid
        );
        this.updateAssignees(updated);
    }

    getNestedFieldValue(record, fieldPath) {
        if (!fieldPath) return null;
        return fieldPath
            .split('.')
            .reduce((acc, key) => (acc ? acc[key] : null), record);
    }

    updateAssignees(updated) {
        this.dispatchEvent(
            new CustomEvent('editoraction', {
                detail: {
                    action: 'updateTask',
                    value: {
                        gm__elementUID: this.element.gm__elementUID,
                        gm__resourceData: updated
                    }
                }
            })
        );
    }
}
