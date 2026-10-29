import type { RouteLocationNormalizedLoaded } from 'vue-router'

export const MAX_CACHED_VIEWS = 12
type ViewRoute = Pick<
    RouteLocationNormalizedLoaded,
    'path' | 'fullPath' | 'meta'
>

/** 详情按完整地址缓存；列表页保留现有的页内查询状态。 */
export function viewCacheKey(route: ViewRoute): string {
    return ['/artist', '/album'].includes(route.path)
        ? route.fullPath
        : route.path
}

/** 与 KeepAlive 使用相同的访问顺序及上限，避免详情滚动记录无限累积。 */
export function createViewScrollCache(max = MAX_CACHED_VIEWS) {
    if (!Number.isInteger(max) || max < 1)
        throw new RangeError('页面缓存上限必须是正整数')
    const positions = new Map<string, number>()
    return {
        activate(route: ViewRoute): number {
            if (route.meta.keepAlive !== true) return 0
            const key = viewCacheKey(route)
            const position = positions.get(key) ?? 0
            positions.delete(key)
            positions.set(key, position)
            while (positions.size > max) {
                const oldest = positions.keys().next().value
                if (oldest !== undefined) positions.delete(oldest)
            }
            return position
        },
        remember(route: ViewRoute, position: number) {
            const key = viewCacheKey(route)
            if (route.meta.keepAlive === true && positions.has(key))
                positions.set(key, position)
        },
    }
}
