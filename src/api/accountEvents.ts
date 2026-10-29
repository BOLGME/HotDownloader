/** 查询、播放和任务只报告失败线索；是否真正失效由账号 store 在线核验。 */
type Listener = (platform: string, error: unknown) => void
const listeners = new Set<Listener>()
export function reportAccountError(platform: string, error: unknown): void {
    listeners.forEach((listener) => listener(platform, error))
}
export function onAccountError(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
