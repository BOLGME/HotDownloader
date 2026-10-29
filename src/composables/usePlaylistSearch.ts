import type { PlaylistSearchItem } from '../types'
import { searchPlaylists } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

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
