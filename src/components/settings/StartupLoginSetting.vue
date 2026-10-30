<template>
    <div class="startup-login-setting">
        <div class="startup-login-row">
            <span>启动时检查并尝试续期登录</span>
            <n-switch
                v-model:value="settings.settings.autoRefreshLoginOnStartup"
                aria-label="启动时检查并尝试续期登录"
            />
        </div>
        <p>
            打开应用后检查已保存的账号，支持续期的平台会尝试自动续期。关闭后仍可在账号页手动检查。
        </p>
    </div>
</template>
<script setup lang="ts">
import { NSwitch } from 'naive-ui'
import { useSettingsStore } from '../../stores/settingsStore'
const settings = useSettingsStore()
</script>
<style scoped>
.startup-login-setting {
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 20px;
    padding-bottom: 16px;
}
.startup-login-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
}
.startup-login-row :deep(.n-switch) {
    flex-shrink: 0;
}
p {
    margin-top: 6px;
    color: var(--color-text-secondary);
    font-size: 12px;
    line-height: 1.7;
}
</style>
