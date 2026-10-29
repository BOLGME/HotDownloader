import type { AlbumInfo } from '../types'
import { searchAlbums } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

export function useAlbumSearch() {
    const { items, ...state } = usePagedSearch<AlbumInfo>(
        async ({ platform, keyword, page, limit }) => {
            const result = await searchAlbums(platform, keyword, page, limit)
            return { items: result.albums, hasMore: result.has_more }
        },
        (album) => album.id,
    )
    return { ...state, albums: items }
}
