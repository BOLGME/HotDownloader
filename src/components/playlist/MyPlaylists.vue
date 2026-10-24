<template>
    <section class="my-playlists">
        <h2>我的{{ name }}歌单</h2>
        <div v-if="loading" class="placeholder"><n-spin size="medium" /></div>
        <n-alert v-else-if="error" type="error" title="获取我的歌单失败">
            {{ error }} <n-button @click="refresh">重试</n-button>
        </n-alert>
        <div v-else-if="!loggedIn" class="placeholder">
            <n-empty :description="`登录${name}后即可查看自己创建的歌单`">
                <template #extra
                    ><n-button
                        @click="
                            router.push({
                                path: '/settings',
                                query: { platform },
                            })
                        "
                        >前往登录</n-button
                    ></template
                >
            </n-empty>
        </div>
        <PlaylistSearchResult
            v-else
            :playlists="playlists"
            :has-more="false"
            :loading-more="false"
            empty-description="暂无自己创建的歌单"
            @click-playlist="(item) => emit('open', item)"
        />
    </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui'
import PlaylistSearchResult from '../search/PlaylistSearchResult.vue'
import * as musicApi from '../../api/musicApi'
import { getLoginAdapter, isLoginPlatform } from '../../api/platformLoginApi'
import type { PlaylistSearchItem } from '../../types'

const props = defineProps<{ platform: string; name: string }>()
const emit = defineEmits<{ (e: 'open', item: PlaylistSearchItem): void }>()
const router = useRouter()
const route = useRoute()
const loggedIn = ref(false)
const playlists = ref<PlaylistSearchItem[]>([])
const loading = ref(false)
const error = ref('')
let requestId = 0

async function refresh() {
    const current = ++requestId
    loading.value = true
    error.value = ''
    try {
        if (!isLoginPlatform(props.platform)) {
            loggedIn.value = false
            playlists.value = []
            return
        }
        const status = await getLoginAdapter(props.platform).status()
        if (current !== requestId) return
        loggedIn.value = status.loggedIn
        if (!loggedIn.value) {
            playlists.value = []
            return
        }
        const result = await musicApi.fetchCreatedPlaylists(props.platform)
        if (current === requestId) playlists.value = result.playlists
    } catch (err) {
        if (current === requestId)
            error.value = err instanceof Error ? err.message : String(err)
    } finally {
        if (current === requestId) loading.value = false
    }
}
onMounted(() => void refresh())
watch(
    () => route.path,
    (path, previous) => {
        if (path === '/playlist' && path !== previous) void refresh()
    },
)
onUnmounted(() => requestId++)
</script>

<style scoped>
.my-playlists {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}
h2 {
    margin: 0;
    font-size: 18px;
}
.placeholder {
    display: flex;
    justify-content: center;
    padding: 40px 0;
}
</style>
