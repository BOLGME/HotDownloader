import { ref } from 'vue'
import type { SongInfo } from '../types'
import { searchSongs } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

/** 歌曲搜索的 API 适配与勾选状态；分页和请求竞态由 usePagedSearch 管理。 */
export function useSongSearch() {
    const {
        items,
        search,
        reset: resetQuery,
        loadMore,
        ...state
    } = usePagedSearch<SongInfo>(
        async ({ platform, keyword, page, limit }) => {
            const result = await searchSongs(platform, keyword, page, limit)
            return { items: result.songs, hasMore: result.has_more }
        },
        (song) => `${song.platform ?? ''}:${song.mid}`,
    )
    // 勾选属于当前歌曲结果集，追加分页时保留，新搜索或重置时清空。
    const selectedIds = ref<string[]>([])

    /** 同时清除结果与勾选，使批量下载始终对应当前搜索。 */
    function reset() {
        selectedIds.value = []
        resetQuery()
    }

    /** 提交平台与关键词，建立新的歌曲结果集。 */
    function searchSongsQuery(platform: string, keyword: string) {
        selectedIds.value = []
        return search(platform, keyword)
    }

    return {
        ...state,
        searchResults: items,
        selectedIds,
        searchSongs: searchSongsQuery,
        loadMoreSongs: loadMore,
        reset,
    }
}
