import { onScopeDispose, ref, shallowRef } from 'vue'

interface SearchRequest {
    platform: string
    keyword: string
    page: number
    limit: number
}

interface SearchPage<T> {
    items: T[]
    hasMore: boolean
}

/** 搜索上下文在提交时固定；HTTP 与 IPC 的旧响应都由代次隔离。 */
export function usePagedSearch<T>(
    fetchPage: (request: SearchRequest) => Promise<SearchPage<T>>,
    key: (item: T) => string,
) {
    const items = shallowRef<T[]>([])
    const loading = ref(false)
    const loadingMore = ref(false)
    const hasSearched = ref(false)
    const hasMore = ref(false)
    const error = ref('')
    const currentPage = ref(0)
    let generation = 0
    let context: Pick<SearchRequest, 'platform' | 'keyword'> | null = null

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
        const input = { ...context, page: nextPage, limit: 20 }
        if (more) loadingMore.value = true
        else loading.value = true
        error.value = ''
        try {
            const result = await fetchPage(input)
            if (request !== generation) return false
            const previous = more ? items.value : []
            const ids = new Set(previous.map(key))
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
            if (request === generation)
                error.value = err instanceof Error ? err.message : String(err)
            return false
        } finally {
            if (request === generation)
                loading.value = loadingMore.value = false
        }
    }

    function search(platform: string, keyword: string) {
        reset()
        const term = keyword.trim()
        if (!term) return Promise.resolve(false)
        context = { platform, keyword: term }
        hasSearched.value = true
        return load(false)
    }

    function loadMore() {
        return hasMore.value ? load(true) : Promise.resolve(false)
    }

    function retry() {
        return load(currentPage.value > 0)
    }

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
