<template>
    <section v-if="player.song" class="playback-bar" aria-label="在线播放器">
        <div class="player-heading">
            <div class="track-info">
                <div class="track-title" :title="player.song.title">
                    {{ player.song.title }}
                </div>
                <div class="track-subtitle">
                    {{ player.song.artist
                    }}<span v-if="player.source">
                        · {{ player.source.quality }}</span
                    >
                </div>
            </div>
            <n-button
                size="small"
                :loading="player.status === 'loading'"
                @click="player.toggle()"
            >
                {{
                    player.status === 'playing'
                        ? '暂停'
                        : player.status === 'error'
                          ? '重试'
                          : '播放'
                }}
            </n-button>
            <n-button
                size="small"
                aria-label="关闭播放器"
                @click="player.stop()"
                >关闭</n-button
            >
        </div>
        <div class="player-controls">
            <span class="time-label">{{ formatTime(player.currentTime) }}</span>
            <input
                class="seek-slider"
                type="range"
                min="0"
                :max="player.duration || 1"
                step="0.1"
                :value="player.currentTime"
                :disabled="player.duration <= 0"
                aria-label="播放进度"
                :aria-valuetext="`${formatTime(player.currentTime)} / ${formatTime(player.duration)}`"
                @input="player.seek(inputValue($event))"
            />
            <span class="time-label">{{ formatTime(player.duration) }}</span>
            <label class="volume-control">
                <span>音量</span>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="player.volume"
                    aria-label="音量"
                    @input="player.setVolume(inputValue($event))"
                />
            </label>
        </div>
        <p v-if="player.error" class="player-error" role="alert">
            {{ player.error }}
        </p>
        <p
            v-else-if="player.status === 'loading' || player.buffering"
            class="player-status"
            role="status"
        >
            {{ player.source ? '正在缓冲…' : '正在获取试听链接…' }}
        </p>
    </section>
</template>

<script setup lang="ts">
import { NButton } from 'naive-ui'
import { usePlayerStore } from '../stores/playerStore'

const player = usePlayerStore()
function inputValue(event: Event): number {
    return Number((event.target as HTMLInputElement).value)
}
function formatTime(value: number): string {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<style scoped>
.playback-bar {
    flex-shrink: 0;
    padding: 10px calc(16px + var(--safe-area-right)) 10px
        calc(16px + var(--safe-area-left));
    border-top: 1px solid var(--border-color);
    background: var(--bg-sidebar);
}
.player-heading,
.player-controls,
.volume-control {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
.track-info {
    flex: 1;
    min-width: 0;
}
.track-title,
.track-subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.track-title {
    font-weight: 500;
}
.track-subtitle,
.time-label,
.volume-control,
.player-status {
    font-size: 12px;
    color: var(--color-text-secondary);
}
.player-controls {
    margin-top: 8px;
}
.seek-slider {
    flex: 1;
    min-width: 0;
}
.time-label {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}
input[type='range'] {
    accent-color: #18a058;
    cursor: pointer;
    margin: 0;
    height: 24px;
}
.volume-control input {
    width: 72px;
    min-width: 0;
}
.player-error,
.player-status {
    margin: 6px 0 0;
    overflow-wrap: anywhere;
}
.player-error {
    color: #d03050;
    font-size: 12px;
}
@media (max-width: 767px) {
    .player-heading {
        gap: 6px;
    }
    .player-heading :deep(.n-button) {
        min-height: 36px;
    }
    .player-controls {
        gap: 6px;
    }
    .volume-control {
        gap: 4px;
    }
    .volume-control input {
        width: 48px;
    }
}
</style>
