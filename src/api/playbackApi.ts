import { invoke } from '@tauri-apps/api/core'
import { isNativeRuntime } from './runtimeApi'
import { webRequest } from './webClient'
import type { PlaybackSource, SongInfo } from '../types'
import { reportAccountError } from './accountEvents'

export async function resolvePlayback(song: SongInfo): Promise<PlaybackSource> {
    const request = {
        platform: song.platform,
        songMid: song.mid,
        qualities: song.qualities,
    }
    try {
        return await (isNativeRuntime()
            ? invoke<PlaybackSource>('resolve_playback', { request })
            : webRequest<PlaybackSource>('/api/playback', {
                  method: 'POST',
                  body: JSON.stringify(request),
              }))
    } catch (error) {
        reportAccountError(song.platform, error)
        throw error
    }
}

export async function releasePlayback(source: PlaybackSource): Promise<void> {
    if (!isNativeRuntime()) {
        await webRequest(`/api/playback/${encodeURIComponent(source.id)}`, {
            method: 'DELETE',
        })
    }
}
