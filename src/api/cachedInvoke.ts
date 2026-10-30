import { invoke } from '@tauri-apps/api/core'
import {
    cachedQuery,
    clearQueryCache,
    clearQueryCacheByGroup,
    type QueryCacheOptions,
} from './queryCache'

/**
 * API 层的幂等命令调用缓存，提供：
 * 1. 内存缓存（同一 key 在 TTL 内的请求直接返回缓存）
 * 2. 请求去重（同一 key 的并发请求共享同一个 Promise）
 *
 * 适用于"幂等、读多写少"的命令（如封面、配置查询等）。
 * 不要用于有副作用的命令（如添加任务、修改设置）。
 */

/**
 * 调用 Tauri 命令并自动缓存结果。
 *
 * @param command Tauri 命令名
 * @param args 命令参数
 * @param options.ttlMs 成功返回后的缓存有效期（毫秒），默认 5 分钟；0 仅合并在途请求。
 * @param options.key 命令组内的自定义缓存键（默认用 JSON 序列化的 args）。
 * @returns 命令返回结果
 */
export function cachedInvoke<T>(
    command: string,
    args?: Record<string, unknown>,
    options: QueryCacheOptions = {},
): Promise<T> {
    return cachedQuery(command, args, () => invoke<T>(command, args), options)
}

/** 清除 Web 与 Tauri 的全部只读缓存；保留原有调用入口。 */
export function clearInvokeCache(): void {
    clearQueryCache()
}

/** 清除指定业务命令组的缓存，包括使用自定义键的条目。 */
export function clearInvokeCacheByCommand(command: string): void {
    clearQueryCacheByGroup(command)
}
