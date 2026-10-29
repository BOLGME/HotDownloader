import type { ArtistInfo } from '../types'
import { searchArtists } from '../api/musicApi'
import { usePagedSearch } from './usePagedSearch'

export function useArtistSearch() {
    const { items, ...state } = usePagedSearch<ArtistInfo>(
        async ({ platform, keyword, page, limit }) => {
            const result = await searchArtists(platform, keyword, page, limit)
            return { items: result.artists, hasMore: result.has_more }
        },
        (artist) => artist.id,
    )
    return { ...state, artists: items }
}
