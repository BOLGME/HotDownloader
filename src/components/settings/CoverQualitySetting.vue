<template>
    <n-form-item label="内嵌封面清晰度">
        <div class="cover-quality-setting">
            <n-select
                v-model:value="settingsStore.settings.coverQuality"
                :options="options"
                :disabled="!settingsStore.settings.writeMetadata"
            />
            <p class="setting-hint">
                开启写入歌曲标签后生效。超清优先获取音源原图，实际尺寸取决于音源；获取失败时自动回退。
            </p>
        </div>
    </n-form-item>
</template>

<script setup lang="ts">
import { NFormItem, NSelect } from 'naive-ui'
import { useSettingsStore } from '../../stores/settingsStore'

const settingsStore = useSettingsStore()
const options = [
    { label: '音源默认', value: 'source' },
    { label: '高清（500×500）', value: '500' },
    { label: '超清 / 原图（优先）', value: 'original' },
]
</script>

<style scoped>
.cover-quality-setting {
    width: 100%;
    min-width: 0;
}

.setting-hint {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--color-text-secondary);
}
</style>
