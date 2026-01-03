/**
 * Render Optimizer
 * Utilities for batching DOM operations and reducing layout thrashing
 */

export class RenderOptimizer {
    constructor() {
        this.pendingUpdates = new Map();
        this.rafId = null;
        this.elementCache = new Map();
    }

    /**
     * Schedule a batched update
     */
    scheduleUpdate(key, updateFn) {
        this.pendingUpdates.set(key, updateFn);

        if (!this.rafId) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this.rafId = requestAnimationFrame(() => {
                this.flush();
            });
        }
    }

    /**
     * Flush all pending updates
     */
    flush() {
        if (this.pendingUpdates.size === 0) {
            this.rafId = null;
            return;
        }

        // Execute all updates in a single frame
        for (const [, updateFn] of this.pendingUpdates) {
            try {
                updateFn();
            } catch (error) {
                console.error('RenderOptimizer: Update failed', error);
            }
        }

        this.pendingUpdates.clear();
        this.rafId = null;
    }

    /**
     * Cancel pending updates
     */
    cancel() {
        if (this.rafId) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdates.clear();
    }

    /**
     * Cache a DOM element
     */
    cacheElement(key, element) {
        this.elementCache.set(key, element);
    }

    /**
     * Get cached element
     */
    getCachedElement(key) {
        return this.elementCache.get(key);
    }

    /**
     * Invalidate element cache
     */
    invalidateCache(key) {
        if (key) {
            this.elementCache.delete(key);
        } else {
            this.elementCache.clear();
        }
    }

    /**
     * Batch style updates to minimize reflows
     */
    batchStyleUpdates(elements, styles) {
        // Write phase - apply all styles at once
        elements.forEach((element) => {
            if (element) {
                Object.assign(element.style, styles);
            }
        });
    }

    /**
     * Apply CSS class changes in batch
     */
    batchClassUpdates(updates) {
        // updates is array of { element, add: [], remove: [] }
        updates.forEach(({ element, add = [], remove = [] }) => {
            if (!element) return;
            
            if (remove.length > 0) {
                element.classList.remove(...remove);
            }
            if (add.length > 0) {
                element.classList.add(...add);
            }
        });
    }
}

/**
 * DOM Query Cache
 * Caches querySelector results to avoid repeated DOM traversal
 */
export class DOMQueryCache {
    constructor(template) {
        this.template = template;
        this.cache = new Map();
        this.isDirty = false;
    }

    /**
     * Query with caching
     */
    querySelector(selector, useCache = true) {
        if (!useCache || this.isDirty) {
            const element = this.template.querySelector(selector);
            this.cache.set(selector, element);
            return element;
        }

        if (this.cache.has(selector)) {
            return this.cache.get(selector);
        }

        const element = this.template.querySelector(selector);
        this.cache.set(selector, element);
        return element;
    }

    /**
     * Query all with caching
     */
    querySelectorAll(selector, useCache = true) {
        if (!useCache || this.isDirty) {
            const elements = this.template.querySelectorAll(selector);
            this.cache.set(selector, elements);
            return elements;
        }

        if (this.cache.has(selector)) {
            return this.cache.get(selector);
        }

        const elements = this.template.querySelectorAll(selector);
        this.cache.set(selector, elements);
        return elements;
    }

    /**
     * Mark cache as dirty (needs refresh)
     */
    markDirty() {
        this.isDirty = true;
    }

    /**
     * Clear dirty flag
     */
    clearDirty() {
        this.isDirty = false;
    }

    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
        this.isDirty = false;
    }

    /**
     * Remove specific cached query
     */
    invalidate(selector) {
        this.cache.delete(selector);
    }
}

/**
 * Row State Tracker
 * Tracks row state changes to minimize DOM updates
 */
export class RowStateTracker {
    constructor() {
        this.rowStates = new Map();
    }

    /**
     * Set row state
     */
    setState(rowKey, state) {
        this.rowStates.set(rowKey, { ...state, timestamp: Date.now() });
    }

    /**
     * Get row state
     */
    getState(rowKey) {
        return this.rowStates.get(rowKey);
    }

    /**
     * Check if state changed
     */
    hasChanged(rowKey, newState) {
        const currentState = this.rowStates.get(rowKey);
        if (!currentState) return true;

        // Compare relevant properties
        return Object.keys(newState).some(
            key => currentState[key] !== newState[key]
        );
    }

    /**
     * Clear state for row
     */
    clearState(rowKey) {
        this.rowStates.delete(rowKey);
    }

    /**
     * Clear all states
     */
    clearAll() {
        this.rowStates.clear();
    }

    /**
     * Get all row keys
     */
    getRowKeys() {
        return Array.from(this.rowStates.keys());
    }
}
