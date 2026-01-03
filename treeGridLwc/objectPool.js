/**
 * Object Pool
 * Reusable object pool to reduce memory allocations and GC pressure
 */

export class ObjectPool {
    constructor(factory, reset, initialSize = 50) {
        this.factory = factory; // Function to create new objects
        this.reset = reset; // Function to reset object state
        this.pool = [];
        this.inUse = new Set();
        
        // Pre-allocate initial objects
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
        }
    }

    /**
     * Acquire an object from the pool
     */
    acquire() {
        let obj;
        
        if (this.pool.length > 0) {
            obj = this.pool.pop();
        } else {
            // Pool exhausted, create new object
            obj = this.factory();
        }
        
        this.inUse.add(obj);
        return obj;
    }

    /**
     * Release an object back to the pool
     */
    release(obj) {
        if (!this.inUse.has(obj)) {
            return; // Object not from this pool
        }
        
        this.inUse.delete(obj);
        this.reset(obj); // Reset state
        this.pool.push(obj);
    }

    /**
     * Release multiple objects
     */
    releaseAll(objects) {
        objects.forEach(obj => this.release(obj));
    }

    /**
     * Clear the pool
     */
    clear() {
        this.pool = [];
        this.inUse.clear();
    }

    /**
     * Get pool stats
     */
    getStats() {
        return {
            available: this.pool.length,
            inUse: this.inUse.size,
            total: this.pool.length + this.inUse.size
        };
    }
}

/**
 * Record Object Pool
 * Specialized pool for tree grid records
 */
export class RecordObjectPool {
    constructor(fieldNames, initialSize = 100) {
        this.fieldNames = fieldNames;
        
        this.pool = new ObjectPool(
            () => this._createRecord(),
            (obj) => this._resetRecord(obj),
            initialSize
        );
    }

    /**
     * Create a new record object
     */
    _createRecord() {
        const record = {};
        
        if (this.fieldNames) {
            for (const field of this.fieldNames) {
                record[field] = null;
            }
        }
        
        // Tree metadata fields
        record.level = 1;
        record.posInSet = 1;
        record.setSize = 1;
        record.hasChildren = false;
        record.childrenSetSize = 0;
        record.isExpanded = false;
        record._virtualIndex = 0;
        record._parentId = null;
        
        return record;
    }

    /**
     * Reset record to default state
     */
    _resetRecord(record) {
        // Reset all fields to null
        if (this.fieldNames) {
            for (const field of this.fieldNames) {
                record[field] = null;
            }
        }
        
        // Reset metadata
        record.level = 1;
        record.posInSet = 1;
        record.setSize = 1;
        record.hasChildren = false;
        record.childrenSetSize = 0;
        record.isExpanded = false;
        record._virtualIndex = 0;
        record._parentId = null;
    }

    /**
     * Acquire a record and populate it
     */
    acquireAndPopulate(sourceRecord, metadata) {
        const record = this.pool.acquire();
        
        // Copy fields from source
        if (this.fieldNames) {
            for (const field of this.fieldNames) {
                if (sourceRecord[field] !== undefined) {
                    record[field] = sourceRecord[field];
                }
            }
        } else {
            // Copy all fields if no field list
            Object.assign(record, sourceRecord);
        }
        
        // Apply metadata
        if (metadata) {
            Object.assign(record, metadata);
        }
        
        return record;
    }

    /**
     * Update field names
     */
    updateFieldNames(fieldNames) {
        this.fieldNames = fieldNames;
        this.pool.clear(); // Clear pool to recreate with new fields
    }

    /**
     * Release record back to pool
     */
    release(record) {
        this.pool.release(record);
    }

    /**
     * Release multiple records
     */
    releaseAll(records) {
        this.pool.releaseAll(records);
    }

    /**
     * Get pool stats
     */
    getStats() {
        return this.pool.getStats();
    }
}
