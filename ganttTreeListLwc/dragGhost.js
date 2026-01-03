/* eslint-disable @lwc/lwc/no-async-operation */
/* eslint-disable @lwc/lwc/no-inner-html */

export class DragGhost {
    constructor() {
        this.element = null;
        this.isVisible = false;
        this.handleMouseMove = this.handleMouseMove.bind(this);
    }

    create(text, initialX = 0, initialY = 0) {
        if (this.element) {
            this.destroy();
        }

        this.element = document.createElement('div');
        this.element.innerHTML = `
            <div class="drag-ghost-content">
                <svg class="drag-ghost-icon slds-icon slds-icon_xx-small" aria-hidden="true" style="width: 16px; height: 16px; flex-shrink: 0; fill: currentColor; color: white;">
                    <use xlink:href="/_slds/icons/utility-sprite/svg/symbols.svg#record"></use>
                </svg>
                <span class="drag-ghost-text">${text}</span>
            </div>
        `;

        // Apply simple styles
        this.element.style.cssText = `
            position: fixed; z-index: 9999; pointer-events: none;
            background: var(--slds-g-color-brand-base-60, #0176d3);
            border-radius: var(--slds-g-border-radius-4, 0.25rem);
            padding: var(--slds-g-spacing-3, 0.5rem) var(--slds-g-spacing-4, 0.75rem);
            font-size: var(--slds-g-font-size-2, 0.75rem);
            font-family: var(--slds-g-font-family, 'Salesforce Sans', Arial, sans-serif);
            color: white;
            opacity: 0.9;
            transform: translate(-50%, -100%);
            box-shadow: var(--slds-g-shadow-4, 0 2px 4px 0 rgba(0, 0, 0, 0.1));
            min-width: 150px;
            max-width: 250px;
        `;

        // Style the content
        const content = this.element.querySelector('.drag-ghost-content');
        content.style.cssText = `
            display: flex;
            align-items: center;
            gap: var(--slds-g-spacing-2, 0.25rem);
        `;

        // Style the text
        const ghostText = this.element.querySelector('.drag-ghost-text');
        ghostText.style.cssText = `
            font-weight: var(--slds-g-font-weight-bold, 700);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        `;

        document.body.appendChild(this.element);
        this.updatePosition(initialX, initialY);
        this.startFollowing();
        this.isVisible = true;
    }

    updateStyle(isValid, position = null) {
        if (!this.element) return;

        const iconUse = this.element.querySelector('.drag-ghost-icon use');

        if (isValid) {
            // Valid drop - brand color background
            this.element.style.backgroundColor =
                'var(--slds-g-color-brand-base-60, #0176d3)';

            // Set position-specific icon for valid drops
            if (iconUse && position) {
                switch (position) {
                    case 'top':
                        iconUse.setAttribute(
                            'xlink:href',
                            '/_slds/icons/utility-sprite/svg/symbols.svg#up'
                        );
                        break;
                    case 'middle':
                        iconUse.setAttribute(
                            'xlink:href',
                            '/_slds/icons/utility-sprite/svg/symbols.svg#right'
                        );
                        break;
                    case 'bottom':
                        iconUse.setAttribute(
                            'xlink:href',
                            '/_slds/icons/utility-sprite/svg/symbols.svg#down'
                        );
                        break;
                    default:
                        iconUse.setAttribute(
                            'xlink:href',
                            '/_slds/icons/utility-sprite/svg/symbols.svg#success'
                        );
                }
            } else if (iconUse) {
                iconUse.setAttribute(
                    'xlink:href',
                    '/_slds/icons/utility-sprite/svg/symbols.svg#success'
                );
            }
        } else {
            // Invalid drop - error color background
            this.element.style.backgroundColor =
                'var(--slds-g-color-error-base-50, #c23934)';

            // Show error icon for invalid drops
            if (iconUse) {
                iconUse.setAttribute(
                    'xlink:href',
                    '/_slds/icons/utility-sprite/svg/symbols.svg#error'
                );
            }
        }
    }

    updatePosition(x, y) {
        if (this.element) {
            this.element.style.left = x + 15 + 'px';
            this.element.style.top = y - 15 + 'px';
        }
    }

    startFollowing() {
        document.addEventListener('mousemove', this.handleMouseMove);
    }

    handleMouseMove(event) {
        this.updatePosition(event.clientX, event.clientY);
    }

    destroy() {
        document.removeEventListener('mousemove', this.handleMouseMove);

        if (this.element && this.element.parentNode) {
            // Add fade out animation
            this.element.style.transition = 'opacity 0.2s ease-out';
            this.element.style.opacity = '0';

            // Remove after animation
            setTimeout(() => {
                if (this.element && this.element.parentNode) {
                    this.element.parentNode.removeChild(this.element);
                }
                this.element = null;
                this.isVisible = false;
            }, 200);
        } else {
            this.element = null;
            this.isVisible = false;
        }
    }
}
