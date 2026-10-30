<template>
    <div class="playlist-home">
        <n-button
            v-if="!isNativeRuntime()"
            @click="router.push('/playlist/monitors')"
            >歌单监控与自动补齐</n-button
        >
        <section class="playlist-section">
            <h2>导入歌单</h2>
            <SearchBar
                v-model:keyword="importInput"
                v-model:platform="currentPlatform"
                :platform-options="PLATFORMS"
                placeholder="请输入歌单链接或 ID"
                button-text="导入歌单"
                @search="handleImport"
            />
        </section>

        <MyPlaylists
            platform="qqmusic"
            name="QQ 音乐"
            @open="(item) => emit('open-my', item)"
        />
        <MyPlaylists
            platform="kugou"
            name="酷狗音乐"
            @open="(item) => emit('open-my', item)"
        />
        <MyPlaylists
            platform="netease"
            name="网易云音乐"
            @open="(item) => emit('open-my', item)"
        />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton } from 'naive-ui'
import SearchBar from '../search/SearchBar.vue'
import MyPlaylists from './MyPlaylists.vue'
import { DEFAULT_PLATFORM, PLATFORMS } from '../../config/platforms'
import type { PlaylistSearchItem } from '../../types'
import { isNativeRuntime } from '../../api/runtimeApi'

const emit = defineEmits<{
    (e: 'import', platform: string, input: string): void
    (e: 'open-my', item: PlaylistSearchItem): void
}>()
const router = useRouter()
const currentPlatform = ref(DEFAULT_PLATFORM)
const importInput = ref('')
function handleImport() {
    const input = importInput.value.trim()
    if (input) emit('import', currentPlatform.value, input)
}
</script>

<style scoped>
.playlist-home {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
}

.playlist-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.playlist-section h2 {
    margin: 0;
    font-size: 18px;
}

/* SearchBar 自带下边距；入口页使用父容器的 gap 控制间距。 */
.playlist-home :deep(.search-bar) {
    margin-bottom: 0;
}
</style>
