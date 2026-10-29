import { onScopeDispose, ref, shallowRef } from 'vue'

interface SearchRequest {
    platform: string
    keyword: string
    page: number
    limit: number
}

/** 各平台 API 在查询边界统一为这一结果结构。 */
interface SearchPage<T> {
    items: T[]
    hasMore: boolean
}

/**
 * 管理搜索结果、分页、去重和错误重试，供歌曲、歌单、专辑和歌手搜索共用。
 * 搜索上下文在提交时固定；HTTP 与 IPC 的旧响应都由代次隔离。
 * @param fetchPage 使用固定的平台、关键词和页码请求一页结果。
 * @param key 结果的业务标识，同时用于跨页去重和同页去重。
 */
export function usePagedSearch<T>(
    fetchPage: (request: SearchRequest) => Promise<SearchPage<T>>,
    key: (item: T) => string,
) {
    // 分页时替换整个数组，避免为只读查询结果建立不必要的深层响应式代理。
    const items = shallowRef<T[]>([])
    /** 首次查询与追加分页分别显示加载状态，已有列表可在加载下一页时保留。 */
    const loading = ref(false)
    const loadingMore = ref(false)
    const hasSearched = ref(false)
    const hasMore = ref(false)
    const error = ref('')
    /** 最后成功取得的页码；0 表示第一页尚未成功，重试时仍应请求第一页。 */
    const currentPage = ref(0)
    let generation = 0
    let context: Pick<SearchRequest, 'platform' | 'keyword'> | null = null

    /** 先使所有在途请求失效，再清空列表，避免旧响应恢复已经重置的页面。 */
    function reset() {
        generation++
        context = null
        items.value = []
        loading.value =
            loadingMore.value =
            hasSearched.value =
            hasMore.value =
                false
        currentPage.value = 0
        error.value = ''
    }

    async function load(more: boolean): Promise<boolean> {
        if (!context || loading.value || loadingMore.value) return false
        const request = generation
        const nextPage = more ? currentPage.value + 1 : 1
        // 分页沿用提交搜索时的上下文，不读取用户随后编辑的输入框或平台选择。
        const input = { ...context, page: nextPage, limit: 20 }
        if (more) loadingMore.value = true
        else loading.value = true
        error.value = ''
        try {
            const result = await fetchPage(input)
            // IPC 无法中止传输；即使旧请求成功返回，也不能覆盖新一轮搜索。
            if (request !== generation) return false
            const previous = more ? items.value : []
            const ids = new Set(previous.map(key))
            // 每接收一条就更新集合，使接口单页内重复和跨页重复采用相同规则。
            items.value = [
                ...previous,
                ...result.items.filter((item) => {
                    const id = key(item)
                    if (ids.has(id)) return false
                    ids.add(id)
                    return true
                }),
            ]
            currentPage.value = nextPage
            hasMore.value = result.hasMore
            return true
        } catch (err) {
            // 失败不推进页码，也不清空已加载结果，便于原页重试。
            if (request === generation)
                error.value = err instanceof Error ? err.message : String(err)
            return false
        } finally {
            // 旧请求的 finally 同样不能提前关闭新请求的加载提示。
            if (request === generation)
                loading.value = loadingMore.value = false
        }
    }

    /** 开始一轮搜索；空白关键词按重置处理，不发起网络请求。 */
    function search(platform: string, keyword: string) {
        reset()
        const term = keyword.trim()
        if (!term) return Promise.resolve(false)
        context = { platform, keyword: term }
        hasSearched.value = true
        return load(false)
    }

    /** 追加下一页；重复点击由 load 内的加载状态阻止重复请求。 */
    function loadMore() {
        return hasMore.value ? load(true) : Promise.resolve(false)
    }

    /** 首次失败重试第一页，追加失败重试下一页，均使用原搜索上下文。 */
    function retry() {
        return load(currentPage.value > 0)
    }

    // 组件销毁时清理状态并使在途响应失效；页面缓存期间保留查询结果。
    onScopeDispose(reset, true)

    return {
        items,
        loading,
        loadingMore,
        hasSearched,
        hasMore,
        error,
        currentPage,
        search,
        loadMore,
        retry,
        reset,
    }
}
