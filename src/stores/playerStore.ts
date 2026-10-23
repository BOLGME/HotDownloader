import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import { releasePlayback, resolvePlayback } from '../api/playbackApi'
import type { PlaybackSource, SongInfo } from '../types'

type PlaybackStatus =
    'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export const usePlayerStore = defineStore('player', () => {
    const song = ref<SongInfo | null>(null)
    const source = ref<PlaybackSource | null>(null)
    const status = ref<PlaybackStatus>('idle')
    const error = ref('')
    const buffering = ref(false)
    const currentTime = ref(0)
    const duration = ref(0)
    const volume = ref(0.8)
    let audio: HTMLAudioElement | null = null
    let generation = 0
    let detachListeners = () => {}

    function isCurrent(candidate: SongInfo): boolean {
        return (
            song.value?.platform === candidate.platform &&
            song.value.mid === candidate.mid
        )
    }

    function release(value: PlaybackSource | null) {
        if (value) void releasePlayback(value).catch(() => {})
    }

    function clearAudio() {
        const previous = audio
        audio = null
        detachListeners()
        detachListeners = () => {}
        if (previous) {
            previous.pause()
            previous.removeAttribute('src')
            previous.load()
        }
        release(source.value)
        source.value = null
        buffering.value = false
        currentTime.value = 0
        duration.value = 0
    }

    async function start(element: HTMLAudioElement) {
        try {
            await element.play()
        } catch (reason) {
            if (audio !== element) return
            buffering.value = false
            if (
                reason &&
                typeof reason === 'object' &&
                'name' in reason &&
                reason.name === 'NotAllowedError'
            ) {
                status.value = 'paused'
                error.value = '请点击播放继续试听'
            } else {
                status.value = 'error'
                error.value = '无法播放该音频，请重试或选择其他歌曲'
            }
        }
    }

    async function toggle() {
        if (status.value === 'error' && song.value) {
            await play(song.value)
        } else if (audio) {
            error.value = ''
            if (!audio.paused) audio.pause()
            else await start(audio)
        }
    }

    async function play(candidate: SongInfo) {
        if (isCurrent(candidate) && status.value !== 'error') {
            if (status.value !== 'loading') await toggle()
            return
        }
        const request = ++generation
        clearAudio()
        song.value = { ...candidate }
        status.value = 'loading'
        error.value = ''
        let resolved: PlaybackSource | null = null
        try {
            resolved = await resolvePlayback(candidate)
            // 快速切歌或关闭后，旧请求只能释放其会话，不能接管播放器。
            if (request !== generation) {
                release(resolved)
                return
            }
            source.value = resolved
            const element = new Audio(resolved.url)
            audio = element
            element.preload = 'auto'
            element.volume = volume.value
            const handlers: Record<string, () => void> = {
                playing: () => {
                    status.value = 'playing'
                    buffering.value = false
                    error.value = ''
                },
                pause: () => {
                    if (!element.ended) status.value = 'paused'
                    buffering.value = false
                },
                waiting: () => {
                    buffering.value = true
                },
                canplay: () => {
                    buffering.value = false
                },
                ended: () => {
                    status.value = 'ended'
                    buffering.value = false
                },
                durationchange: () => {
                    duration.value = Number.isFinite(element.duration)
                        ? element.duration
                        : 0
                },
                timeupdate: () => {
                    currentTime.value = element.currentTime
                },
                error: () => {
                    status.value = 'error'
                    buffering.value = false
                    error.value = '音频加载失败，链接可能已过期，请点击重试'
                },
            }
            for (const [event, handler] of Object.entries(handlers))
                element.addEventListener(event, handler)
            detachListeners = () => {
                for (const [event, handler] of Object.entries(handlers))
                    element.removeEventListener(event, handler)
            }
            await start(element)
        } catch (reason) {
            if (request !== generation) {
                release(resolved)
                return
            }
            clearAudio()
            status.value = 'error'
            error.value =
                reason instanceof Error ? reason.message : String(reason)
        }
    }

    function seek(value: number) {
        if (!audio || duration.value <= 0 || !Number.isFinite(value)) return
        audio.currentTime = Math.max(0, Math.min(value, duration.value))
        currentTime.value = audio.currentTime
    }

    function setVolume(value: number) {
        if (!Number.isFinite(value)) return
        volume.value = Math.max(0, Math.min(1, value))
        if (audio) audio.volume = volume.value
    }

    function stop() {
        generation++
        clearAudio()
        song.value = null
        status.value = 'idle'
        error.value = ''
    }

    onScopeDispose(stop)
    return {
        song,
        source,
        status,
        error,
        buffering,
        currentTime,
        duration,
        volume,
        isCurrent,
        play,
        toggle,
        seek,
        setVolume,
        stop,
    }
})
