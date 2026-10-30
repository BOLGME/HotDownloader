/** 只读查询缓存策略；完成结果有容量上限，在途请求只在完成或显式清理前保留。 */
interface CachePolicy {
    ttlMs?: number
    maxEntries?: number
}

export interface QueryCacheOptions {
    /** 成功返回后的缓存时长；0 表示只合并在途请求。 */
    ttlMs?: number
    /** 组内自定义键；不同查询组的同名键互不影响。 */
    key?: string
}

interface PendingEntry {
    group: string
    promise: Promise<unknown>
}

interface CompletedEntry extends PendingEntry {
    expiresAt: number
}

/**
 * 与 HTTP/IPC 无关的只读请求缓存。
 * TTL 从成功完成时计算；失败不缓存。清理后的旧响应不能重新填充缓存。
 * @param policy 完成结果默认缓存 5 分钟，最多保留最近使用的 256 项。
 */
export function createQueryCache(policy: CachePolicy = {}) {
    const defaultTtl = policy.ttlMs ?? 5 * 60 * 1000
    const maxEntries = policy.maxEntries ?? 256
    if (!Number.isFinite(defaultTtl) || defaultTtl < 0)
        throw new RangeError('缓存时长必须是非负有限数值')
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
        throw new RangeError('缓存容量必须是正整数')

    // 在途请求独立管理，慢请求不会因 TTL 或结果缓存淘汰而被重复发起。
    const pending = new Map<string, PendingEntry>()
    const completed = new Map<string, CompletedEntry>()

    function pruneExpired(now: number) {
        for (const [key, entry] of completed) {
            if (entry.expiresAt <= now) completed.delete(key)
        }
    }

    function run<T>(
        group: string,
        key: string,
        load: () => Promise<T>,
        options: Pick<QueryCacheOptions, 'ttlMs'> = {},
    ): Promise<T> {
        const ttlMs = options.ttlMs ?? defaultTtl
        if (!Number.isFinite(ttlMs) || ttlMs < 0)
            throw new RangeError('缓存时长必须是非负有限数值')
        // 组合键不会因自定义键中包含分隔符而串到其他查询组。
        const cacheKey = JSON.stringify([group, key])
        const now = Date.now()
        pruneExpired(now)
        const active = pending.get(cacheKey)
        if (active) return active.promise as Promise<T>
        const cached = completed.get(cacheKey)
        if (ttlMs > 0 && cached) {
            // Map 的插入顺序作为 LRU 顺序；命中后移动到末尾。
            completed.delete(cacheKey)
            completed.set(cacheKey, cached)
            return cached.promise as Promise<T>
        }
        completed.delete(cacheKey)

        // 延迟到微任务执行，同时把 load 的同步异常转换成可重试的 Promise 拒绝。
        const entry: PendingEntry = {
            group,
            promise: Promise.resolve().then(load),
        }
        entry.promise = entry.promise.then(
            (value) => {
                // 比较条目本身：clear 后可能已有同键的新请求，旧请求不能覆盖它。
                if (pending.get(cacheKey) === entry) {
                    pending.delete(cacheKey)
                    const finishedAt = Date.now()
                    pruneExpired(finishedAt)
                    if (ttlMs > 0) {
                        completed.set(cacheKey, {
                            ...entry,
                            expiresAt: finishedAt + ttlMs,
                        })
                        while (completed.size > maxEntries) {
                            const oldest = completed.keys().next().value
                            if (oldest !== undefined) completed.delete(oldest)
                        }
                    }
                }
                return value
            },
            (error: unknown) => {
                if (pending.get(cacheKey) === entry) pending.delete(cacheKey)
                throw error
            },
        )
        pending.set(cacheKey, entry)
        return entry.promise as Promise<T>
    }

    /** 清理只影响后续读取及缓存回填，不中止调用方已经持有的请求。 */
    function clear(group?: string) {
        for (const entries of [pending, completed]) {
            if (group === undefined) entries.clear()
            else {
                for (const [key, entry] of entries) {
                    if (entry.group === group) entries.delete(key)
                }
            }
        }
    }

    return { run, clear }
}

const queryCache = createQueryCache()

/** 两端按相同业务组和参数缓存只读结果；登录、设置写入和任务操作直接走原 API。 */
export function cachedQuery<T>(
    group: string,
    args: Record<string, unknown> | undefined,
    load: () => Promise<T>,
    options: QueryCacheOptions = {},
): Promise<T> {
    return queryCache.run(
        group,
        options.key ?? JSON.stringify(args ?? {}),
        load,
        options,
    )
}

export function clearQueryCache(): void {
    queryCache.clear()
}

export function clearQueryCacheByGroup(group: string): void {
    queryCache.clear(group)
}
