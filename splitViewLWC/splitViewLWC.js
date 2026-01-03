/* eslint-disable no-unused-vars */
import { LightningElement, api, track } from 'lwc';

export default class SplitViewLWC extends LightningElement {
    //@api properties
    @api defaultWithSplit;
    @api defaultWidth = 50;
    @api direction = 'right';
    @api hideToggle = false;

    //@track properties
    @track intialized = false;
    @track withSplit = false;
    @track width = 50;

    get rightDirection() {
        return this.direction === 'right';
    }

    get splitResizeCls() {
        return [
            'resize-button',
            'slds-button',
            'slds-button_neutral',
            { [`${this.direction}`]: !this.hideToggle }
        ];
    }

    get splitCloseCls() {
        return [
            'split-button',
            'slds-button',
            'slds-button_neutral',
            `${this.direction}`
        ];
    }

    get splitCloseIcon() {
        return `utility:${this.direction}`;
    }

    get splitOpenCls() {
        return [
            'split-button',
            'slds-button',
            'slds-button_neutral',
            { [`${this.direction}`]: this.direction === 'left' }
        ];
    }

    get splitOpenIcon() {
        return `utility:${this.direction === 'right' ? 'left' : 'right'}`;
    }

    get resizer() {
        return this.template.querySelector('[data-id="resizer"]');
    }

    get showToggle() {
        return !this.hideToggle;
    }

    handleMouseDown(event) {
        event.preventDefault();

        const resizer = this.resizer;
        const resizeArea = resizer.parentNode;
        const leftSide = resizer.previousElementSibling;
        const rightSide = resizer.nextElementSibling;
        
        // 1. CACHE DIMENSIONS ONCE
        const resizeAreaWidth = resizeArea.getBoundingClientRect().width;
        const leftStartWidth = leftSide.getBoundingClientRect().width;
        const refClientX = event.clientX;

        // 2. PREPARE UI FOR HIGH PERFORMANCE
        // Disable transition for instant tracking
        this.template.host.style.setProperty('--gm-transition', 'none');
        
        // "Freeze" interactions inside the panels (Crucial for Datatable performance)
        // This prevents hover effects/event listeners inside the datatable from firing while resizing
        leftSide.style.pointerEvents = 'none';
        rightSide.style.pointerEvents = 'none';
        
        // ✅ ADDED: Disable transitions on the panels themselves during drag
        leftSide.style.transition = 'none';
        rightSide.style.transition = 'none';
        
        resizer.style.cursor = 'col-resize';
        document.body.style.cursor = 'col-resize';

        // 3. THROTTLE SETUP
        let lastUpdate = 0;
        const THROTTLE_DELAY = 16; // 60fps for smoother resize (was 32)
        let currentNewWidthPct = 0;

        const mouseMoveHandler = (e) => {
            const now = Date.now();

            // TIME THROTTLE:
            // If less than 16ms has passed since last update, ignore this frame.
            if (now - lastUpdate < THROTTLE_DELAY) {
                return;
            }

            lastUpdate = now;

            requestAnimationFrame(() => {
                const dx = e.clientX - refClientX;
                
                // Calculate
                currentNewWidthPct = ((leftStartWidth + dx) * 100) / resizeAreaWidth;

                // Clamp between 10% and 90% to prevent collapsing
                currentNewWidthPct = Math.max(10, Math.min(90, currentNewWidthPct));

                // Apply as flex-basis directly (prevents datatable re-render)
                const leftPx = (currentNewWidthPct * resizeAreaWidth) / 100;
                const rightPx = resizeAreaWidth - leftPx - 24; // 24px = 1.5rem resizer
                
                leftSide.style.flexBasis = `${leftPx}px`;
                leftSide.style.maxWidth = `${leftPx}px`;
                
                rightSide.style.flexBasis = `${rightPx}px`;
                rightSide.style.maxWidth = `${rightPx}px`;
                
                // Store for later
                this.width = currentNewWidthPct;
            });
        };

        const mouseUpHandler = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);

            // Restore interactions
            leftSide.style.pointerEvents = '';
            rightSide.style.pointerEvents = '';
            resizer.style.removeProperty('cursor');
            document.body.style.removeProperty('cursor');

            // ✅ ADDED: Clean up inline styles
            leftSide.style.removeProperty('flex-basis');
            leftSide.style.removeProperty('max-width');
            leftSide.style.removeProperty('transition');
            
            rightSide.style.removeProperty('flex-basis');
            rightSide.style.removeProperty('max-width');
            rightSide.style.removeProperty('transition');

            // Save final state and update CSS vars
            if (currentNewWidthPct > 0) {
                this.width = currentNewWidthPct; 
                
                // ✅ ADDED: Update CSS variables to match final position
                this.template.host.style.setProperty(
                    '--gm-left-side-width',
                    `${currentNewWidthPct}%`
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-width',
                    `calc(${100 - currentNewWidthPct}% - 1.5rem)`
                );
            }

            // Restore smooth transitions
            // Small timeout prevents "snapping" effect if user lets go quickly
            setTimeout(() => {
                this.template.host.style.setProperty(
                    '--gm-transition', 
                    'flex-basis 0.2s cubic-bezier(0.4, 0.0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)' // ✅ MODIFIED: transition flex-basis instead of width
                );
            }, 50);
        };

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    }

    @api
    toggleSplitView(event) {
        this.withSplit = !this.withSplit;
        this.applySplitView();

        this.dispatchEvent(
            new CustomEvent('toggle', {
                detail: { open: this.withSplit }
            })
        );
    }

    @api
    setSplitView(value) {
        this.withSplit = value;
        this.applySplitView();
    }

    connectedCallback() {
        this.width = this.defaultWidth;

        this.withSplit =
            typeof this.defaultWithSplit === 'string'
                ? this.defaultWithSplit === 'true'
                : this.defaultWithSplit;

        this.applySplitView();
    }

    applySplitView(event) {
        this.template.host.style.setProperty(
            '--gm-transition',
            'flex-basis 0.1s cubic-bezier(0.4, 0.0, 0.2, 1), max-width 0.1s cubic-bezier(0.4, 0.0, 0.2, 1)' // ✅ MODIFIED: transition flex-basis instead of width
        );

        if (this.direction === 'right') {
            if (this.withSplit) {
                this.template.host.style.setProperty(
                    '--gm-left-side-width',
                    `${this.width}%`
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-width',
                    `calc(${100 - this.width}% -  1.5rem)`
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-visibility',
                    'visible'
                );
            } else {
                this.template.host.style.setProperty(
                    '--gm-right-side-width',
                    '0%'
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-visibility',
                    'hidden'
                );

                this.template.host.style.setProperty(
                    '--gm-left-side-width',
                    `calc(100% -  ${this.hideToggle ? '0rem' : '1rem'})`
                );
            }
        } else {
            if (this.withSplit) {
                this.template.host.style.setProperty(
                    '--gm-left-side-width',
                    `calc(${this.width}% - 1.5rem)`
                );
                this.template.host.style.setProperty(
                    '--gm-left-side-visibility',
                    'visible'
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-width',
                    `calc(${100 - this.width}%`
                );
            } else {
                this.template.host.style.setProperty(
                    '--gm-left-side-width',
                    `0%`
                );
                this.template.host.style.setProperty(
                    '--gm-left-side-visibility',
                    'hidden'
                );

                this.template.host.style.setProperty(
                    '--gm-right-side-width',
                    `calc(100% - ${this.hideToggle ? '0rem' : '1rem'})`
                );
            }
        }
    }
}