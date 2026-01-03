import { LightningElement, api, track } from 'lwc';

export default class GanttDependencyLwc extends LightningElement {
    DEPENDENCY_LINE_PADDING = 15;
    GAP_OFFSET_ADJUSTMENT = 3;

    // api properties
    @api options;

    @api
    get dependency() {
        return this.tDependency;
    }
    set dependency(value) {
        this.tDependency = value;
        this.renderDependency();
    }

    // internal properties
    @track tDependency;
    @track tDependencyElements;
    @track hover;

    // getters
    get rowHeight() {
        return this.options.rowHeight;
    }

    get dependencyClass() {
        let classList = [];
        if (this.hover) {
            classList.push('hovered');
        }

        if (this.tDependency.selected) {
            classList.push('selected');
        }

        if (!this.tDependency.Id) {
            classList.push('new');
        }

        return classList;
    }

    // Hover & Click Handlers
    handleHover() {
        this.hover = true;
    }

    handleLeave() {
        this.hover = false;
    }

    handleClick() {
        this.dispatchEvent(
            CustomEvent('rowaction', {
                composed: true,
                bubbles: true,
                cancelable: true,
                detail: {
                    action: 'select',
                    value: [this.tDependency.gm__dependencyUID]
                }
            })
        );
    }

    handleKeyUp(event) {
        //Delete dependency
        //MacOS : Backspace
        //WINDOWS : Delete
        if (event.keyCode === 8 || event.keyCode === 46) {
            this.dispatchEvent(
                new CustomEvent('rowaction', {
                    composed: true,
                    bubbles: true,
                    cancelable: true,
                    detail: {
                        action: 'deleteDependency',
                        value: this.tDependency.gm__dependencyUID
                    }
                })
            );
        }
    }

    // Dependency Renderer Dispatcher
    renderDependency() {
        this.tDependencyElements = [];

        const {
            gm__dependencyUID: dependencyId,
            gmpkg__Type__c: dependencyType,
            predecessorTaskCoords,
            successorTaskCoords
        } = this.tDependency || {};

        const startCoords = predecessorTaskCoords;
        const endCoords = successorTaskCoords;

        if (!startCoords || !endCoords) return;

        let renderedElements = [];
        if (dependencyType === 'start-to-start') {
            renderedElements = this.renderStartToStart(startCoords, endCoords);
        } else if (dependencyType === 'end-to-end') {
            renderedElements = this.renderEndToEnd(startCoords, endCoords);
        } else if (dependencyType === 'end-to-start') {
            renderedElements = this.renderEndToStart(startCoords, endCoords);
        } else if (dependencyType === 'start-to-end') {
            renderedElements = this.renderStartToEnd(startCoords, endCoords);
        }

        for (let i = 0; i < renderedElements.length; i++) {
            const element = renderedElements[i];
            element.id = dependencyId;
            element.key = `${dependencyId}_${i}`;
        }

        this.tDependencyElements = renderedElements;
    }

    // Render methods for different dependency types
    renderEndToEnd(predecessor, successor) {
        const elements = this.createDependencySameSide(
            predecessor,
            successor,
            false
        );
        elements[elements.length - 1].arrow = this.createArrow(true);
        return elements;
    }

    renderStartToStart(predecessor, successor) {
        const elements = this.createDependencySameSide(
            successor,
            predecessor,
            true
        );
        elements[0].arrow = this.createArrow(false);
        return elements.reverse();
    }

    renderEndToStart(predecessor, successor) {
        const elements = this.createDependencyDifferentSide(
            predecessor,
            successor,
            false
        );
        elements[elements.length - 1].arrow = this.createArrow(false);
        return elements;
    }

    renderStartToEnd(predecessor, successor) {
        const elements = this.createDependencyDifferentSide(
            successor,
            predecessor,
            true
        );
        elements[0].arrow = this.createArrow(true);
        return elements.reverse();
    }

    // Methods to create lines and arrows
    createDependencySameSide(
        predecessorTask,
        successorTask,
        isStartToStartDependency
    ) {
        const dependencyLines = [];
        const defaultHorizontalOffset = 10;
        const taskRowHeight = this.rowHeight;

        // Calculate vertical positions for both tasks
        const predecessorVerticalCenter =
            predecessorTask.rowIndex * taskRowHeight +
            Math.floor(taskRowHeight / 2) -
            1;
        const successorVerticalCenter =
            successorTask.rowIndex * taskRowHeight +
            Math.floor(taskRowHeight / 2) -
            1;

        // Determine starting position and initial width for the first horizontal line
        let firstHorizontalLineStartX =
            predecessorTask[isStartToStartDependency ? 'start' : 'end'];
        let firstHorizontalLineStartY = predecessorVerticalCenter;
        let firstHorizontalLineWidth = defaultHorizontalOffset;

        // Calculate distance between the relevant points of both tasks
        const distanceBetweenTaskPoints =
            successorTask[isStartToStartDependency ? 'start' : 'end'] -
            predecessorTask[isStartToStartDependency ? 'start' : 'end'];

        // Adjust line width based on task positioning
        if (distanceBetweenTaskPoints > 0 !== isStartToStartDependency) {
            firstHorizontalLineWidth =
                Math.abs(distanceBetweenTaskPoints) + defaultHorizontalOffset;
        }

        // Create first horizontal line segment
        if (isStartToStartDependency) {
            firstHorizontalLineStartX -= firstHorizontalLineWidth;
            firstHorizontalLineWidth -= 1;
            this.createHorizontalLine(
                dependencyLines,
                firstHorizontalLineStartX,
                firstHorizontalLineStartY,
                firstHorizontalLineWidth
            );
        } else {
            this.createHorizontalLine(
                dependencyLines,
                firstHorizontalLineStartX,
                firstHorizontalLineStartY,
                firstHorizontalLineWidth
            );
            firstHorizontalLineStartX +=
                firstHorizontalLineWidth - this.GAP_OFFSET_ADJUSTMENT;
        }

        // Create vertical connecting line
        const verticalLineHeight =
            Math.abs(firstHorizontalLineStartY - successorVerticalCenter) +
            this.GAP_OFFSET_ADJUSTMENT;
        let verticalLineStartY = firstHorizontalLineStartY;
        if (firstHorizontalLineStartY > successorVerticalCenter) {
            verticalLineStartY = successorVerticalCenter;
        }
        this.createVerticalLine(
            dependencyLines,
            firstHorizontalLineStartX,
            verticalLineStartY,
            verticalLineHeight
        );

        // Create final horizontal line to successor task
        let finalHorizontalLineWidth = Math.abs(
            firstHorizontalLineStartX -
                successorTask[isStartToStartDependency ? 'start' : 'end']
        );
        let finalHorizontalLineStartX = firstHorizontalLineStartX;

        if (!isStartToStartDependency) {
            finalHorizontalLineWidth -= 1;
            finalHorizontalLineStartX -= finalHorizontalLineWidth;
        }
        this.createHorizontalLine(
            dependencyLines,
            finalHorizontalLineStartX,
            successorVerticalCenter,
            finalHorizontalLineWidth
        );

        return dependencyLines;
    }

    createDependencyDifferentSide(source, target, isConditional) {
        var dependencyLines = [],
            currentX = 0,
            currentY = 0,
            horizontalLineLength = 0,
            verticalLineLength = 0,
            taskRowHeight = this.rowHeight,
            halfTaskRowHeight = Math.floor(taskRowHeight / 2),
            minimumGapBetweenTasks = 2 * this.DEPENDENCY_LINE_PADDING,
            gapBetweenSourceAndTarget = target.start - source.end,
            endPositionOffset = 1,
            sourceVerticalPosition =
                source.rowIndex * taskRowHeight + halfTaskRowHeight - 1,
            targetVerticalPosition =
                target.rowIndex * taskRowHeight + halfTaskRowHeight - 1;

        // Initial horizontal line setup from source to target
        currentX = source.end;
        currentY = sourceVerticalPosition;
        horizontalLineLength = this.DEPENDENCY_LINE_PADDING;

        if (isConditional) {
            currentX += endPositionOffset;
            if (gapBetweenSourceAndTarget > minimumGapBetweenTasks) {
                horizontalLineLength =
                    gapBetweenSourceAndTarget -
                    (this.DEPENDENCY_LINE_PADDING - this.GAP_OFFSET_ADJUSTMENT);
            }
            horizontalLineLength -= endPositionOffset;
        }
        this.createHorizontalLine(
            dependencyLines,
            currentX,
            currentY,
            horizontalLineLength
        ); // Draw the line after adjusting width

        currentX += horizontalLineLength - this.GAP_OFFSET_ADJUSTMENT;

        // Handle vertical line and repositioning for closer elements
        if (minimumGapBetweenTasks >= gapBetweenSourceAndTarget) {
            verticalLineLength = isConditional
                ? Math.abs(targetVerticalPosition - sourceVerticalPosition) -
                  halfTaskRowHeight
                : halfTaskRowHeight;
            if (sourceVerticalPosition > targetVerticalPosition) {
                currentY -= verticalLineLength;
                verticalLineLength += this.GAP_OFFSET_ADJUSTMENT;
                this.createVerticalLine(
                    dependencyLines,
                    currentX,
                    currentY,
                    verticalLineLength
                ); // Draw the vertical line
            } else {
                this.createVerticalLine(
                    dependencyLines,
                    currentX,
                    currentY,
                    verticalLineLength
                ); // Draw the vertical line
                currentY += verticalLineLength;
            }
            horizontalLineLength =
                source.end - target.start + minimumGapBetweenTasks;
            if (this.DEPENDENCY_LINE_PADDING > horizontalLineLength) {
                horizontalLineLength = this.DEPENDENCY_LINE_PADDING;
            }
            currentX -= horizontalLineLength - this.GAP_OFFSET_ADJUSTMENT;
            this.createHorizontalLine(
                dependencyLines,
                currentX,
                currentY,
                horizontalLineLength
            ); // Draw the vertical line
        }

        // Draws the final vertical line based on relative positions
        if (sourceVerticalPosition > targetVerticalPosition) {
            verticalLineLength = currentY - targetVerticalPosition;
            currentY = targetVerticalPosition;
            verticalLineLength += this.GAP_OFFSET_ADJUSTMENT;
            this.createVerticalLine(
                dependencyLines,
                currentX,
                currentY,
                verticalLineLength
            ); // Draw the vertical line
        } else {
            verticalLineLength = targetVerticalPosition - currentY;
            this.createVerticalLine(
                dependencyLines,
                currentX,
                currentY,
                verticalLineLength
            ); // Draw the vertical line
            currentY += verticalLineLength;
        }

        // Draws the final horizontal line to connect to the target
        horizontalLineLength = target.start - currentX;
        if (!isConditional) {
            horizontalLineLength -= endPositionOffset;
        }
        this.createHorizontalLine(
            dependencyLines,
            currentX,
            currentY,
            horizontalLineLength
        ); // Draw the vertical line

        return dependencyLines;
    }

    createHorizontalLine(dependencyLines, left, top, width) {
        dependencyLines.push({
            attrs: {
                className: `gantt-line gantt-line-h `,
                style: `left: ${left}px; top: ${top}px; width: ${width}px;`
            }
        });
    }

    createVerticalLine(dependencyLines, left, top, height) {
        dependencyLines.push({
            attrs: {
                className: `gantt-line gantt-line-v `,
                style: `left: ${left}px; top: ${top}px; height: ${height}px;`
            }
        });
    }

    createArrow(isLeftArrow) {
        return {
            attrs: {
                className: isLeftArrow ? 'arrow-left' : 'arrow-right'
            }
        };
    }
}
