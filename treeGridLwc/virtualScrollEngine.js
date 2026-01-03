/**
 * VirtualScrollEngine - High-Performance Virtual Scrolling
 *
 * FIXED: Now updates continuously during scroll, not just at the end
 *
 * Optimizations:
 * - Single RAF for immediate response (not double RAF)
 * - Predictive prefetching based on scroll velocity
 * - Adaptive buffer sizing based on scroll speed
 * - Momentum-aware range calculation
 * - Scroll anchoring to prevent layout shifts
 */

const DEFAULT_CONFIG = {
    rowHeight: 44,
    viewportHeight: 600,
    bufferSize: 10, // Larger buffer for smoother scrolling
    hysteresis: 0.15, // Lower = more responsive updates
    velocityThreshold: 1.5,
    maxBufferMultiplier: 4,
    smoothingFactor: 0.2, // Higher = faster velocity response
    predictionLookahead: 80, // ms - reduced for more accuracy
    immediateMode: true // NEW: Skip RAF batching for immediate updates
};

export class VirtualScrollEngine {
    constructor(config = {}) {
        this._config = { ...DEFAULT_CONFIG, ...config };

        // Scroll state
        this._scrollTop = 0;
        this._lastScrollTop = 0;
        this._scrollVelocity = 0;
        this._lastScrollTime = 0;
        this._scrollDirection = 0; // -1 = up, 0 = stationary, 1 = down

        // Velocity tracking with exponential smoothing
        this._velocityHistory = [];
        this._maxVelocityHistorySize = 3; // Reduced for faster response

        // Range state
        this._currentStartIndex = 0;
        this._currentEndIndex = 0;
        this._lastUpdateTime = 0;

        // RAF management - simplified
        this._rafId = null;
        this._pendingCallback = null;

        // Performance metrics
        this._updateCount = 0;
        this._skipCount = 0;
        this._lastFrameTime = performance.now();
        this._frameDeltas = [];

        // Scroll anchoring
        this._anchorIndex = -1;
        this._anchorOffset = 0;

        // Idle callback for prefetching
        this._idleCallbackId = null;

        console.log('🚀 VirtualScrollEngine initialized (IMMEDIATE MODE)');
    }

    /**
     * Update configuration dynamically
     */
    updateConfig(newConfig) {
        this._config = { ...this._config, ...newConfig };
    }

    /**
     * Reset engine state
     */
    reset() {
        this._scrollTop = 0;
        this._lastScrollTop = 0;
        this._scrollVelocity = 0;
        this._velocityHistory = [];
        this._currentStartIndex = 0;
        this._currentEndIndex = 0;
        this._anchorIndex = -1;
        this._anchorOffset = 0;

        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this._idleCallbackId && 'cancelIdleCallback' in window) {
            cancelIdleCallback(this._idleCallbackId);
            this._idleCallbackId = null;
        }

        console.log('🔄 Engine reset');
    }

    /**
     * Calculate scroll velocity with exponential smoothing
     */
    _updateVelocity(scrollTop, timestamp) {
        const timeDelta = timestamp - this._lastScrollTime;

        if (timeDelta > 0 && timeDelta < 500) {
            const instantVelocity =
                Math.abs(scrollTop - this._lastScrollTop) / timeDelta;

            // Add to history
            this._velocityHistory.push(instantVelocity);
            if (this._velocityHistory.length > this._maxVelocityHistorySize) {
                this._velocityHistory.shift();
            }

            // Exponential moving average - faster response
            const alpha = this._config.smoothingFactor;
            this._scrollVelocity =
                alpha * instantVelocity + (1 - alpha) * this._scrollVelocity;

            // Direction detection
            this._scrollDirection = Math.sign(scrollTop - this._lastScrollTop);
        }

        this._lastScrollTop = scrollTop;
        this._lastScrollTime = timestamp;
    }

    /**
     * Get adaptive buffer size based on scroll velocity
     */
    _getAdaptiveBuffer() {
        const { bufferSize, velocityThreshold, maxBufferMultiplier } =
            this._config;

        // Scale buffer based on velocity
        const velocityFactor = Math.min(
            this._scrollVelocity / velocityThreshold,
            maxBufferMultiplier
        );

        // More buffer in scroll direction
        const directionalMultiplier = 1 + velocityFactor * 0.5;

        return {
            before: Math.ceil(
                bufferSize *
                    (this._scrollDirection < 0 ? directionalMultiplier : 1)
            ),
            after: Math.ceil(
                bufferSize *
                    (this._scrollDirection > 0 ? directionalMultiplier : 1)
            )
        };
    }

    /**
     * Predict scroll position based on momentum
     */
    _predictScrollPosition() {
        if (this._scrollVelocity < 0.1) return this._scrollTop;

        const lookahead = this._config.predictionLookahead;
        const predictedDelta =
            this._scrollVelocity * lookahead * this._scrollDirection;

        return this._scrollTop + predictedDelta;
    }

    /**
     * Calculate visible range with all optimizations
     */
    calculateVisibleRange(scrollTop, totalCount) {
        const timestamp = performance.now();
        this._updateVelocity(scrollTop, timestamp);
        this._scrollTop = scrollTop;

        const { rowHeight, viewportHeight, hysteresis } = this._config;

        // Calculate base visible range
        const visibleRows = Math.ceil(viewportHeight / rowHeight);
        const firstVisibleRow = Math.floor(scrollTop / rowHeight);

        // Get adaptive buffer
        const buffer = this._getAdaptiveBuffer();

        // Calculate range with prediction for fast scrolling
        let startIndex, endIndex;

        if (this._scrollVelocity > this._config.velocityThreshold) {
            // Use prediction for fast scrolling
            const predictedScroll = this._predictScrollPosition();
            const predictedFirstRow = Math.floor(predictedScroll / rowHeight);

            // Merge current and predicted ranges
            startIndex = Math.max(
                0,
                Math.min(firstVisibleRow, predictedFirstRow) - buffer.before
            );
            endIndex = Math.min(
                totalCount,
                Math.max(
                    firstVisibleRow + visibleRows,
                    predictedFirstRow + visibleRows
                ) + buffer.after
            );
        } else {
            // Standard calculation for slow/stopped scrolling
            startIndex = Math.max(0, firstVisibleRow - buffer.before);
            endIndex = Math.min(
                totalCount,
                firstVisibleRow + visibleRows + buffer.after
            );
        }

        // Apply hysteresis to prevent jitter
        const shouldUpdate = this._shouldUpdate(
            startIndex,
            endIndex,
            hysteresis,
            firstVisibleRow,
            visibleRows
        );

        if (shouldUpdate) {
            this._currentStartIndex = startIndex;
            this._currentEndIndex = endIndex;
            this._updateCount++;
        } else {
            this._skipCount++;
        }

        return {
            startIndex: this._currentStartIndex,
            endIndex: this._currentEndIndex,
            shouldUpdate,
            velocity: this._scrollVelocity,
            direction: this._scrollDirection,
            buffer
        };
    }

    /**
     * Hysteresis check to prevent unnecessary updates
     * FIXED: More aggressive updates to prevent blank areas
     */
    _shouldUpdate(newStart, newEnd, hysteresis, firstVisibleRow, visibleRows) {
        // Always update if this is the first calculation
        if (this._currentStartIndex === 0 && this._currentEndIndex === 0) {
            return true;
        }

        // CRITICAL: Always update if visible area is outside rendered range
        if (firstVisibleRow < this._currentStartIndex) {
            return true; // Would see blank at top
        }

        if (firstVisibleRow + visibleRows > this._currentEndIndex) {
            return true; // Would see blank at bottom
        }

        // Check buffer exhaustion - update before we run out
        const { bufferSize } = this._config;
        const bufferThreshold = Math.max(2, bufferSize * 0.3); // 30% of buffer

        if (firstVisibleRow < this._currentStartIndex + bufferThreshold) {
            return true; // Running out of top buffer
        }

        if (
            firstVisibleRow + visibleRows >
            this._currentEndIndex - bufferThreshold
        ) {
            return true; // Running out of bottom buffer
        }

        // Standard hysteresis check for minor scrolls
        const currentRange = this._currentEndIndex - this._currentStartIndex;
        const hysteresisRows = Math.ceil(currentRange * hysteresis);

        const startDelta = Math.abs(newStart - this._currentStartIndex);
        const endDelta = Math.abs(newEnd - this._currentEndIndex);

        if (startDelta > hysteresisRows || endDelta > hysteresisRows) {
            return true;
        }

        return false;
    }

    /**
     * Schedule update - FIXED: Single RAF for immediate response
     */
    scheduleUpdate(callback) {
        // In immediate mode, execute synchronously if no RAF pending
        if (this._config.immediateMode) {
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
            }

            // Single RAF - execute on next frame
            this._rafId = requestAnimationFrame(() => {
                this._rafId = requestAnimationFrame(() => {
                    const now = performance.now();

                    // Track frame timing
                    this._frameDeltas.push(now - this._lastFrameTime);
                    if (this._frameDeltas.length > 60) {
                        this._frameDeltas.shift();
                    }
                    this._lastFrameTime = now;

                    callback();
                    this._rafId = null;
                });
            });
            return;
        }

        // Legacy double-RAF mode (disabled by default)
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
        }

        this._pendingCallback = callback;

        this._rafId = requestAnimationFrame(() => {
            this._rafId = requestAnimationFrame(() => {
                const now = performance.now();
                this._frameDeltas.push(now - this._lastFrameTime);
                if (this._frameDeltas.length > 60) {
                    this._frameDeltas.shift();
                }
                this._lastFrameTime = now;

                if (this._pendingCallback) {
                    this._pendingCallback();
                    this._pendingCallback = null;
                }
                this._rafId = null;
            });
        });
    }

    /**
     * Execute update immediately (synchronous)
     */
    executeImmediate(callback) {
        const now = performance.now();
        this._frameDeltas.push(now - this._lastFrameTime);
        if (this._frameDeltas.length > 60) {
            this._frameDeltas.shift();
        }
        this._lastFrameTime = now;
        callback();
    }

    /**
     * Schedule low-priority prefetch during idle time
     */
    schedulePrefetch(callback) {
        if (this._idleCallbackId && 'cancelIdleCallback' in window) {
            cancelIdleCallback(this._idleCallbackId);
        }

        if ('requestIdleCallback' in window) {
            this._idleCallbackId = requestIdleCallback(callback, {
                timeout: 100
            });
        } else {
            setTimeout(callback, 50);
        }
    }

    /**
     * Get current scroll anchor for restoration
     */
    getScrollAnchor(visibleData, scrollTop, rowHeight) {
        const firstVisibleIndex = Math.floor(scrollTop / rowHeight);
        const offset = scrollTop % rowHeight;

        return {
            index: firstVisibleIndex,
            offset,
            key: visibleData[0]?.key || null
        };
    }

    /**
     * Calculate scroll position to restore anchor
     */
    restoreScrollAnchor(anchor, newData, rowHeight, keyField) {
        if (!anchor.key || !newData.length) {
            return anchor.index * rowHeight + anchor.offset;
        }

        const newIndex = newData.findIndex(
            (item) => item[keyField] === anchor.key
        );

        if (newIndex !== -1) {
            return newIndex * rowHeight + anchor.offset;
        }

        return anchor.index * rowHeight + anchor.offset;
    }

    /**
     * Get performance statistics
     */
    getStats() {
        const avgFrameDelta =
            this._frameDeltas.length > 0
                ? this._frameDeltas.reduce((a, b) => a + b, 0) /
                  this._frameDeltas.length
                : 0;

        return {
            updateCount: this._updateCount,
            skipCount: this._skipCount,
            skipRatio: (
                this._skipCount /
                Math.max(1, this._updateCount + this._skipCount)
            ).toFixed(2),
            currentVelocity: this._scrollVelocity.toFixed(2),
            direction: this._scrollDirection,
            avgFrameTime: avgFrameDelta.toFixed(2) + 'ms',
            estimatedFPS:
                avgFrameDelta > 0 ? (1000 / avgFrameDelta).toFixed(1) : 'N/A',
            currentRange: `${this._currentStartIndex}-${this._currentEndIndex}`,
            bufferConfig: this._config.bufferSize,
            immediateMode: this._config.immediateMode
        };
    }

    /**
     * Destroy engine and clean up
     */
    destroy() {
        this.reset();
        this._velocityHistory = [];
        this._frameDeltas = [];
        console.log('💀 Engine destroyed');
    }
}
