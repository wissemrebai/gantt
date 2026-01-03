/**
 * Tree Data Cache
 * Optimized tree flattening with incremental updates and caching
 */

export class TreeDataCache {
    constructor(keyField) {
        this.keyField = keyField;
        
        // Cache structures
        this.flattenedData = [];
        this.nodeMap = new Map(); // Fast O(1) lookups
        this.subtreeCache = new Map(); // Cache flattened subtrees
        this.parentMap = new Map(); // Track parent relationships
        
        // Metadata
        this.totalCount = 0;
        this.isDirty = false;
    }

    /**
     * Build initial cache from tree data
     */
    buildCache(records, expandedRowKeys) {
        console.time('⚡ TreeDataCache:buildCache');
        
        this.clear();
        this.flattenedData = this._flattenTree(
            records,
            expandedRowKeys,
            1,
            null
        );
        this.totalCount = this.flattenedData.length;
        this.isDirty = false;
        
        console.timeEnd('⚡ TreeDataCache:buildCache');
        
        return this.flattenedData;
    }

    /**
     * Incremental update when a node is expanded/collapsed
     */
    updateNodeExpansion(nodeId, isExpanded, expandedRowKeys) {
        console.time('⚡ TreeDataCache:updateNodeExpansion');
        
        const node = this.nodeMap.get(nodeId);
        if (!node) {
            console.warn('Node not found in cache:', nodeId);
            console.timeEnd('⚡ TreeDataCache:updateNodeExpansion');
            return this.flattenedData;
        }

        // Find node position in flattened array
        const nodeIndex = this.flattenedData.findIndex(
            item => item[this.keyField] === nodeId
        );
        
        if (nodeIndex === -1) {
            console.timeEnd('⚡ TreeDataCache:updateNodeExpansion');
            return this.flattenedData;
        }

        // Update node's expanded state
        this.flattenedData[nodeIndex] = {
            ...this.flattenedData[nodeIndex],
            isExpanded
        };

        if (isExpanded) {
            // Insert children after the node
            const children = this._getOrBuildSubtree(
                node.gm__children || [],
                expandedRowKeys,
                node.level + 1,
                nodeId
            );
            
            this.flattenedData.splice(nodeIndex + 1, 0, ...children);
        } else {
            // Remove all descendants
            const descendantCount = this._countDescendants(nodeIndex);
            this.flattenedData.splice(nodeIndex + 1, descendantCount);
        }

        this.totalCount = this.flattenedData.length;
        this.isDirty = false;
        
        console.timeEnd('⚡ TreeDataCache:updateNodeExpansion');
        
        return this.flattenedData;
    }

    /**
     * Get or build subtree from cache
     */
    _getOrBuildSubtree(children, expandedRowKeys, level, parentId) {
        if (!children || children.length === 0) {
            return [];
        }

        // Check cache first
        const cacheKey = this._getSubtreeCacheKey(children, expandedRowKeys);
        if (this.subtreeCache.has(cacheKey)) {
            return this.subtreeCache.get(cacheKey);
        }

        // Build and cache
        const subtree = this._flattenTree(
            children,
            expandedRowKeys,
            level,
            parentId
        );
        
        this.subtreeCache.set(cacheKey, subtree);
        
        return subtree;
    }

    /**
     * Flatten tree recursively
     */
    _flattenTree(records, expandedRowKeys, level, parentId) {
        if (!Array.isArray(records)) {
            return [];
        }

        const result = [];

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const nodeId = record[this.keyField];
            const children = record.gm__children || [];
            const hasChildren = children.length > 0 || record.gm__type === 'summary';
            const isExpanded = expandedRowKeys.includes(nodeId);

            const flatNode = {
                ...record,
                level,
                posInSet: i + 1,
                setSize: records.length,
                hasChildren,
                childrenSetSize: children.length,
                isExpanded: hasChildren ? isExpanded : false,
                _virtualIndex: result.length,
                _parentId: parentId
            };

            // Store in maps for fast lookup
            this.nodeMap.set(nodeId, record);
            if (parentId) {
                this.parentMap.set(nodeId, parentId);
            }

            result.push(flatNode);

            // Recursively flatten children if expanded
            if (flatNode.isExpanded && hasChildren) {
                const childNodes = this._flattenTree(
                    children,
                    expandedRowKeys,
                    level + 1,
                    nodeId
                );
                result.push(...childNodes);
            }
        }

        return result;
    }

    /**
     * Count descendants of a node in flattened array
     */
    _countDescendants(nodeIndex) {
        const nodeLevel = this.flattenedData[nodeIndex].level;
        let count = 0;

        for (let i = nodeIndex + 1; i < this.flattenedData.length; i++) {
            if (this.flattenedData[i].level <= nodeLevel) {
                break;
            }
            count++;
        }

        return count;
    }

    /**
     * Generate cache key for subtree
     */
    _getSubtreeCacheKey(children, expandedRowKeys) {
        const childIds = children.map(c => c[this.keyField]).join(',');
        const expandedIds = expandedRowKeys.sort().join(',');
        return `${childIds}:${expandedIds}`;
    }

    /**
     * Get node by ID
     */
    getNode(nodeId) {
        return this.nodeMap.get(nodeId);
    }

    /**
     * Get parent ID of a node
     */
    getParentId(nodeId) {
        return this.parentMap.get(nodeId);
    }

    /**
     * Get slice of flattened data
     */
    getSlice(startIndex, endIndex) {
        return this.flattenedData.slice(startIndex, endIndex);
    }

    /**
     * Get all flattened data
     */
    getAll() {
        return this.flattenedData;
    }

    /**
     * Get total count
     */
    getCount() {
        return this.totalCount;
    }

    /**
     * Check if cache is dirty
     */
    isDirtyCached() {
        return this.isDirty;
    }

    /**
     * Mark cache as dirty
     */
    markDirty() {
        this.isDirty = true;
    }

    /**
     * Clear cache
     */
    clear() {
        this.flattenedData = [];
        this.nodeMap.clear();
        this.subtreeCache.clear();
        this.parentMap.clear();
        this.totalCount = 0;
        this.isDirty = false;
    }

    /**
     * Get cache stats
     */
    getStats() {
        return {
            totalCount: this.totalCount,
            nodeMapSize: this.nodeMap.size,
            subtreeCacheSize: this.subtreeCache.size,
            parentMapSize: this.parentMap.size,
            isDirty: this.isDirty
        };
    }
}
