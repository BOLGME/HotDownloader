import { ref } from 'vue'
import type { SongInfo } from '../types'
import { searchSongs } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

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
    const selectedIds = ref<string[]>([])

    function reset() {
        selectedIds.value = []
        resetQuery()
    }

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
