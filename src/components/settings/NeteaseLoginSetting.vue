<template>
    <div>
        <n-alert v-if="error" type="error" class="login-error">{{
            error
        }}</n-alert>
        <template v-if="loggedIn">
            <p>当前网易云账号：{{ nickname || userid }}（{{ userid }}）</p>
            <n-space>
                <n-button :loading="busy" @click="refreshLogin"
                    >刷新登录</n-button
                >
                <n-button :loading="busy" @click="logout"
                    >退出网易云登录</n-button
                >
            </n-space>
        </template>
        <n-tabs
            v-else
            v-model:value="tab"
            type="line"
            size="small"
            @update:value="stopPolling"
        >
            <n-tab-pane name="qr" tab="扫码登录" :disabled="busy">
                <div class="qr-container">
                    <img
                        v-if="qrImage"
                        :src="qrImage"
                        alt="网易云登录二维码"
                        class="qr-image"
                    />
                    <p>{{ qrMessage }}</p>
                    <n-button :loading="busy" @click="refreshQr">{{
                        qrImage ? '刷新二维码' : '获取二维码'
                    }}</n-button>
                </div>
            </n-tab-pane>
            <n-tab-pane name="manual" tab="导入 Cookie" :disabled="busy">
                <p>
                    填写网易云音乐网页版登录后的 Cookie，需包含
                    MUSIC_U；凭据由后端独立保存。
                </p>
                <n-form-item label="Cookie">
                    <n-input
                        v-model:value="cookie"
                        type="password"
                        show-password-on="click"
                        placeholder="MUSIC_U=…; __csrf=…"
                    />
                </n-form-item>
                <n-button
                    :loading="busy"
                    :disabled="!cookie.trim()"
                    @click="saveManual"
                    >保存并验证</n-button
                >
            </n-tab-pane>
        </n-tabs>
        <n-button v-if="error" :disabled="busy" text @click="logout"
            >清除网易云登录信息</n-button
        >
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
    NAlert,
    NButton,
    NFormItem,
    NInput,
    NSpace,
    NTabPane,
    NTabs,
} from 'naive-ui'
import { neteaseLogin, type NeteaseLoginResult } from '../../api/neteaseLogin'

const loggedIn = ref(false)
const userid = ref('')
const nickname = ref('')
const busy = ref(false)
const error = ref('')
const tab = ref('qr')
const cookie = ref('')
const qrImage = ref('')
const qrMessage = ref('请使用网易云音乐 App 扫码并确认登录')
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let disposed = false

function stopPolling() {
    generation++
    clearTimeout(timer)
}
function applyStatus(result: NeteaseLoginResult) {
    loggedIn.value = result.logged_in ?? false
    userid.value = result.userid ?? ''
    nickname.value = result.nickname ?? ''
}
function showError(err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
}

async function poll(id: string, current: number) {
    try {
        const result = await neteaseLogin('check', id)
        if (disposed || current !== generation) return
        if (result.status === 'confirmed') {
            applyStatus(result)
            qrImage.value = ''
            stopPolling()
            return
        }
        if (result.status === 'expired') {
            qrMessage.value = '二维码已过期，请刷新'
            stopPolling()
            return
        }
        qrMessage.value =
            result.status === 'scanned'
                ? '已扫码，请在手机上确认'
                : '请使用网易云音乐 App 扫码'
        timer = setTimeout(() => void poll(id, current), 2000)
    } catch (err) {
        if (disposed || current !== generation) return
        showError(err)
        stopPolling()
    }
}

async function run(action: 'status' | 'qr' | 'manual' | 'refresh' | 'logout') {
    stopPolling()
    const current = generation
    busy.value = true
    error.value = ''
    try {
        const result = await neteaseLogin(
            action,
            undefined,
            action === 'manual' ? { cookie: cookie.value } : undefined,
        )
        if (disposed || current !== generation) return
        if (action === 'qr') {
            qrImage.value = result.qr_image ?? ''
            qrMessage.value = '请使用网易云音乐 App 扫码并确认登录'
            if (result.qrcode_id)
                timer = setTimeout(
                    () => void poll(result.qrcode_id!, current),
                    2000,
                )
        } else {
            applyStatus(result)
            cookie.value = ''
            qrImage.value = ''
        }
    } catch (err) {
        if (!disposed && current === generation) showError(err)
    } finally {
        if (!disposed && current === generation) busy.value = false
    }
}
const refreshQr = () => run('qr')
const saveManual = () => run('manual')
const refreshLogin = () => run('refresh')
const logout = () => run('logout')
onMounted(() => void run('status'))
onUnmounted(() => {
    disposed = true
    stopPolling()
    cookie.value = ''
})
</script>

<style scoped>
.login-error {
    margin-bottom: 12px;
}
.qr-container {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 8px;
}
.qr-image {
    width: 180px;
    height: 180px;
}
</style>
