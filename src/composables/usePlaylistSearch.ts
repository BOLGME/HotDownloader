import type { PlaylistSearchItem } from '../types'
import { searchPlaylists } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

/** 歌单搜索的结果适配；以歌单 ID 和目录 ID 组合去重，保留个人歌单的目录区别。 */
export function usePlaylistSearch() {
    const { items, search, loadMore, ...state } =
        usePagedSearch<PlaylistSearchItem>(
            async ({ platform, keyword, page, limit }) => {
                const result = await searchPlaylists(
                    platform,
                    keyword,
                    page,
                    limit,
                )
                return { items: result.playlists, hasMore: result.has_more }
            },
            (playlist) => `${playlist.id}:${playlist.dirid ?? ''}`,
        )
    return {
        ...state,
        playlists: items,
        searchPlaylists: search,
        loadMorePlaylists: loadMore,
    }
}
