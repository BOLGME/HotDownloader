<template>
    <section class="account-settings" aria-labelledby="account-settings-title">
        <header class="account-header">
            <div>
                <h2 id="account-settings-title">音乐账号</h2>
                <p>连接音乐平台，让播放与下载使用你的账号。</p>
            </div>
            <span class="account-count"
                >{{ connectedCount }} /
                {{ LOGIN_PLATFORMS.length }} 已登录</span
            >
        </header>

        <div class="platform-grid" role="group" aria-label="选择音乐平台">
            <button
                v-for="platform in LOGIN_PLATFORMS"
                :key="platform.key"
                type="button"
                class="platform-card"
                :class="{ selected: selected === platform.key }"
                :aria-pressed="selected === platform.key"
                :aria-controls="`login-panel-${platform.key}`"
                :disabled="anyBusy"
                @click="selected = platform.key"
            >
                <span
                    class="platform-mark"
                    :style="{ background: platform.color }"
                    aria-hidden="true"
                    >{{ platform.mark }}</span
                >
                <span class="platform-info">
                    <span class="platform-name">{{ platform.name }}</span>
                    <span
                        class="platform-status"
                        :class="{
                            connected: statuses[platform.key] === 'connected',
                        }"
                    >
                        <span class="status-dot" aria-hidden="true" />{{
                            statusLabels[statuses[platform.key]]
                        }}
                    </span>
                </span>
            </button>
        </div>

        <PlatformLoginPanel
            v-for="platform in LOGIN_PLATFORMS"
            v-show="selected === platform.key"
            :key="platform.key"
            :platform="platform"
            :active="selected === platform.key"
            @status="statuses[platform.key] = $event"
            @busy="busy[platform.key] = $event"
        />
    </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LOGIN_PLATFORMS } from '../../config/loginPlatforms'
import { isLoginPlatform, type LoginPlatform } from '../../api/platformLoginApi'
import PlatformLoginPanel from './PlatformLoginPanel.vue'

const route = useRoute()
const selected = ref<LoginPlatform>('qqmusic')
const statuses = reactive<
    Record<LoginPlatform, 'checking' | 'connected' | 'disconnected' | 'unknown'>
>({ qqmusic: 'checking', kugou: 'checking', netease: 'checking' })
const busy = reactive<Record<LoginPlatform, boolean>>({
    qqmusic: false,
    kugou: false,
    netease: false,
})
const statusLabels = {
    checking: '检查中',
    connected: '已登录',
    disconnected: '未登录',
    unknown: '状态未知',
}
const connectedCount = computed(
    () =>
        Object.values(statuses).filter((status) => status === 'connected')
            .length,
)
const anyBusy = computed(() => Object.values(busy).some(Boolean))
watch(
    () => route.query.platform,
    (platform) => {
        if (isLoginPlatform(platform)) selected.value = platform
    },
    { immediate: true },
)
</script>

<style scoped>
.account-settings {
    padding: 24px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    margin-bottom: 20px;
    min-width: 0;
}
.account-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
}
.account-header h2 {
    font-size: 18px;
    font-weight: 650;
    margin-bottom: 6px;
}
.account-header p {
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.7;
}
.account-count {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--color-text-secondary);
    background: var(--bg-content);
    padding: 4px 10px;
    border-radius: 20px;
    margin-top: 2px;
}
.platform-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 24px;
}
.platform-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 12px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-sidebar);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
}
.platform-card:hover,
.platform-card.selected {
    border-color: var(--color-primary);
    background: var(--bg-content);
}
.platform-card.selected {
    box-shadow: inset 0 0 0 1px var(--color-primary);
}
.platform-card:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
}
.platform-card:disabled {
    cursor: wait;
}
.platform-mark {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: white;
    font-size: 20px;
    font-weight: 700;
    flex-shrink: 0;
}
.platform-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}
.platform-name {
    font-weight: 600;
    font-size: 14px;
}
.platform-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--color-text-secondary);
}
.platform-status.connected {
    color: var(--color-primary);
}
.status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
}
@media (max-width: 600px) {
    .account-settings {
        padding: 20px 16px;
    }
    .account-header {
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
    }
    .platform-grid {
        gap: 8px;
    }
    .platform-card {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 10px;
    }
    .platform-name {
        font-size: 12px;
    }
}
</style>
