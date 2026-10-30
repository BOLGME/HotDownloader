<template>
    <div
        :id="`login-panel-${platform.key}`"
        class="login-panel"
        :aria-label="`${platform.name}登录`"
    >
        <n-alert
            v-if="error"
            type="error"
            class="login-error"
            :bordered="false"
        >
            {{ error }}
            <div class="error-actions">
                <n-button
                    v-if="statusKnown && account.expired && adapter.refresh"
                    size="small"
                    :disabled="busy"
                    @click="refresh"
                    >尝试续期</n-button
                >
                <n-button size="small" :disabled="busy" @click="checkStatus"
                    >重新检查状态</n-button
                >
                <n-button
                    v-if="!statusKnown || !loggedIn"
                    size="small"
                    :disabled="busy"
                    @click="login.logout"
                >
                    清除登录信息
                </n-button>
            </div>
        </n-alert>

        <div v-if="checking" class="loading-state" role="status">
            <n-spin size="small" />正在读取账号状态…
        </div>
        <div v-else-if="statusKnown && loggedIn" class="account-summary">
            <span class="account-avatar" aria-hidden="true">{{
                platform.mark
            }}</span>
            <div class="account-identity">
                <h3>{{ account.nickname || platform.name + '账号' }}</h3>
                <p>账号 ID：{{ account.userId || '已连接' }}</p>
                <span class="connected-label">已登录，可用于播放与下载</span>
            </div>
            <div class="account-actions">
                <n-button
                    v-if="adapter.refresh"
                    :loading="busy"
                    @click="refresh"
                    >刷新登录</n-button
                >
                <n-button :loading="busy" @click="login.logout"
                    >退出登录</n-button
                >
            </div>
        </div>
        <template v-else-if="statusKnown">
            <div class="login-method" role="group" aria-label="登录方式">
                <button
                    type="button"
                    :aria-pressed="method === 'qr'"
                    :disabled="busy"
                    @click="method = 'qr'"
                >
                    扫码登录
                </button>
                <button
                    type="button"
                    :aria-pressed="method === 'manual'"
                    :disabled="busy"
                    @click="method = 'manual'"
                >
                    导入凭据
                </button>
            </div>

            <div
                v-if="method === 'qr'"
                class="qr-layout"
                :class="{ 'has-qr': qrImage, 'is-loading': busy }"
            >
                <div class="qr-frame" :aria-busy="busy">
                    <n-spin v-if="busy" size="medium" />
                    <template v-else-if="qrImage">
                        <img
                            :src="qrImage"
                            :alt="`${platform.name}登录二维码`"
                            class="qr-image"
                            @error="imageFailed = true"
                        />
                        <div
                            v-if="qrInactive || imageFailed"
                            class="qr-overlay"
                        >
                            <span>{{
                                imageFailed ? '二维码加载失败' : qrMessage
                            }}</span>
                            <n-button size="small" type="primary" @click="getQr"
                                >重新获取</n-button
                            >
                        </div>
                    </template>
                    <div v-else class="qr-placeholder">
                        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
                            <path
                                d="M5 18V5h13M30 5h13v13M43 30v13H30M18 43H5V30"
                                stroke="currentColor"
                                stroke-width="3"
                                stroke-linecap="round"
                            />
                            <path
                                d="M13 13h7v7h-7zM28 13h7v7h-7zM13 28h7v7h-7zM28 28h4v4h-4zM35 35h4v4h-4z"
                                fill="currentColor"
                            />
                        </svg>
                        <span>点击获取登录二维码</span>
                    </div>
                </div>
                <div class="qr-instructions">
                    <div class="qr-intro">
                        <span class="method-eyebrow">手机扫码 · 推荐</span>
                        <h3>登录 {{ platform.name }}</h3>
                        <p>{{ platform.description }}</p>
                    </div>
                    <div class="qr-controls">
                        <p class="qr-status" role="status" aria-live="polite">
                            {{ qrMessage }}
                        </p>
                        <n-button type="primary" :loading="busy" @click="getQr">
                            {{ qrImage ? '刷新二维码' : '获取二维码' }}
                        </n-button>
                    </div>
                </div>
            </div>

            <n-form
                v-else
                label-placement="top"
                class="manual-form"
                @submit.prevent="submit"
            >
                <p class="manual-hint">{{ platform.manualHint }}</p>
                <LoginCredentialFields
                    v-model="values"
                    :fields="requiredFields"
                    :disabled="busy"
                />
                <n-collapse
                    v-if="optionalFields.length"
                    class="optional-fields"
                >
                    <n-collapse-item title="补充可选凭据" name="optional">
                        <LoginCredentialFields
                            v-model="values"
                            :fields="optionalFields"
                            :disabled="busy"
                        />
                    </n-collapse-item>
                </n-collapse>
                <n-button
                    type="primary"
                    attr-type="submit"
                    :loading="busy"
                    :disabled="!canSubmit"
                    >保存并登录</n-button
                >
            </n-form>
        </template>
        <p class="credential-note">各平台账号独立管理。</p>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    onActivated,
    onDeactivated,
    onMounted,
    onUnmounted,
    ref,
    watch,
    toRefs,
} from 'vue'
import {
    NAlert,
    NButton,
    NCollapse,
    NCollapseItem,
    NForm,
    NSpin,
} from 'naive-ui'
import { getLoginAdapter, type LoginValues } from '../../api/platformLoginApi'
import type { LoginPlatformConfig } from '../../config/loginPlatforms'
import LoginCredentialFields from './LoginCredentialFields.vue'
import { useAccountStore } from '../../stores/accountStore'

const props = defineProps<{ platform: LoginPlatformConfig; active: boolean }>()
const emit = defineEmits<{
    status: [
        status:
            'checking' | 'connected' | 'disconnected' | 'unknown' | 'expired',
    ]
    busy: [busy: boolean]
}>()
const adapter = getLoginAdapter(props.platform.key)
const login = useAccountStore().sessions[props.platform.key]
const {
    account,
    checking,
    statusKnown,
    busy,
    error,
    qrImage,
    qrStatus,
    loggedIn,
} = toRefs(login)
const checkStatus = () => login.checkStatus()
const createQr = () => login.createQr()
const refresh = () => login.refresh()
const method = ref('qr')
const values = ref<LoginValues>({})
const imageFailed = ref(false)
const requiredFields = props.platform.fields.filter((field) => !field.optional)
const optionalFields = props.platform.fields.filter((field) => field.optional)
const canSubmit = computed(() =>
    requiredFields.every((field) => values.value[field.key]?.trim()),
)
const qrInactive = computed(() =>
    ['expired', 'canceled', 'error'].includes(qrStatus.value),
)
const qrMessage = computed(() => {
    switch (qrStatus.value) {
        case 'waiting':
            return '等待扫码，二维码请勿分享'
        case 'scanned':
            return '已扫码，请在手机上确认登录'
        case 'expired':
            return '二维码已过期'
        case 'canceled':
            return '已取消登录'
        case 'error':
            return '扫码登录失败，请重试'
        default:
            return '获取二维码后，在手机上完成授权'
    }
})

function getQr() {
    imageFailed.value = false
    void createQr()
}
async function submit() {
    if (!canSubmit.value) return
    await login.login(
        Object.fromEntries(
            Object.entries(values.value).map(([key, value]) => [
                key,
                value.trim(),
            ]),
        ),
    )
    if (loggedIn.value) values.value = {}
}
watch(method, () => login.stopQr())
watch(loggedIn, (value) => {
    if (value) values.value = {}
})
watch(
    () => props.active,
    (active) => {
        if (active) void checkStatus()
        else login.cancelQr()
    },
)
watch(
    [checking, statusKnown, loggedIn, error, () => account.value.expired],
    () => {
        emit(
            'status',
            checking.value
                ? 'checking'
                : !statusKnown.value
                  ? 'unknown'
                  : loggedIn.value
                    ? 'connected'
                    : account.value.expired
                      ? 'expired'
                      : 'disconnected',
        )
    },
    { immediate: true },
)
watch([busy, checking], ([working, loadingStatus]) =>
    emit('busy', working && !loadingStatus),
)
let suspended = false
onMounted(() => void checkStatus())
onActivated(() => {
    if (suspended) {
        suspended = false
        void checkStatus()
    }
})
onDeactivated(() => {
    suspended = true
    login.cancelQr()
})
onUnmounted(() => {
    login.cancelQr()
    values.value = {}
})
</script>

<style scoped>
.login-panel {
    min-width: 0;
}
.login-error {
    margin-bottom: 20px;
}
.error-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.loading-state {
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--color-text-secondary);
}
.login-method {
    display: flex;
    padding: 4px;
    gap: 4px;
    background: var(--bg-content);
    border: 1px solid var(--border-color);
    border-radius: 9px;
    max-width: 260px;
    margin-bottom: 20px;
}
.login-method button {
    flex: 1;
    min-height: 32px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.login-method button[aria-pressed='true'] {
    background: var(--bg-sidebar);
    color: var(--color-text);
    box-shadow: 0 1px 4px #0000000d;
}
.login-method button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
}
.login-method button:disabled {
    cursor: wait;
}
.qr-layout {
    display: flex;
    align-items: center;
    gap: 32px;
    padding: 8px 0 12px;
}
.qr-frame {
    width: 184px;
    height: 184px;
    flex-shrink: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-content);
}
.qr-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: white;
    padding: 10px;
}
.qr-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    color: var(--color-text-secondary);
    font-size: 12px;
}
.qr-placeholder svg {
    width: 48px;
    height: 48px;
    opacity: 0.65;
}
.qr-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 12px;
    background: var(--bg-sidebar);
    opacity: 0.97;
    font-size: 13px;
}
.qr-instructions {
    min-width: 0;
}
.method-eyebrow {
    color: var(--color-primary);
    font-size: 12px;
    font-weight: 600;
}
h3 {
    font-size: 17px;
    line-height: 1.5;
    margin: 6px 0;
}
.qr-instructions p,
.account-identity p {
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.7;
}
.qr-instructions .qr-status {
    margin: 12px 0;
    min-height: 22px;
}
.manual-form {
    max-width: 600px;
}
.manual-hint {
    margin-bottom: 20px;
    color: var(--color-text-secondary);
    line-height: 1.7;
    font-size: 13px;
}
.optional-fields {
    margin-bottom: 24px;
}
.credential-note {
    font-size: 12px;
    color: var(--color-text-secondary);
    border-top: 1px solid var(--border-color);
    padding-top: 16px;
    margin-top: 24px;
    line-height: 1.7;
}
.account-summary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
    flex-wrap: wrap;
}
.account-avatar {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: var(--bg-content);
    color: var(--color-primary);
    font-size: 26px;
    font-weight: 700;
}
.account-identity {
    flex: 1;
    min-width: 150px;
    overflow-wrap: anywhere;
}
.connected-label {
    color: var(--color-primary);
    font-size: 12px;
    display: inline-block;
    margin-top: 8px;
}
.account-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
@media (max-width: 600px) {
    .qr-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        padding: 0;
    }
    .qr-instructions {
        display: contents;
    }
    .qr-intro {
        order: 0;
    }
    .method-eyebrow {
        display: none;
    }
    .qr-intro h3 {
        font-size: 15px;
        margin: 0 0 4px;
    }
    .qr-frame {
        order: 1;
        justify-self: center;
        max-width: 100%;
    }
    .qr-layout:not(.has-qr):not(.is-loading) .qr-frame {
        display: none;
    }
    .qr-controls {
        order: 2;
        min-width: 0;
    }
    .qr-instructions .qr-status {
        margin: 0 0 12px;
    }
    .qr-controls :deep(.n-button),
    .manual-form > :deep(.n-button) {
        width: 100%;
    }
    .login-method {
        max-width: none;
        margin-bottom: 16px;
    }
    .login-method button {
        min-height: 36px;
    }
    .loading-state {
        min-height: 160px;
    }
    .credential-note {
        margin-top: 16px;
        padding-top: 12px;
    }
    .manual-hint {
        margin-bottom: 16px;
    }
    .account-summary {
        gap: 12px;
        padding: 8px 0;
    }
    .account-avatar {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        font-size: 20px;
    }
    .account-identity {
        min-width: 0;
    }
    .account-actions {
        width: 100%;
        padding-top: 8px;
    }
    .account-actions :deep(.n-button) {
        flex: 1;
    }
}
</style>
