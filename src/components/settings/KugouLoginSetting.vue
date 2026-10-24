<template>
    <div class="kugou-login">
        <n-alert v-if="error" type="error" class="login-error">{{
            error
        }}</n-alert>
        <template v-if="loggedIn">
            <p>当前酷狗账号：{{ userid }}</p>
            <n-button :loading="busy" @click="logout">退出酷狗登录</n-button>
        </template>
        <n-tabs
            v-else
            v-model:value="tab"
            type="line"
            size="small"
            @update:value="stopPolling"
        >
            <n-tab-pane name="qr" tab="扫码登录">
                <div class="qr-container">
                    <img
                        v-if="qrImage"
                        :src="qrImage"
                        alt="酷狗登录二维码"
                        class="qr-image"
                    />
                    <p>{{ qrMessage }}</p>
                    <n-button :loading="busy" @click="refreshQr">{{
                        qrImage ? '刷新二维码' : '获取二维码'
                    }}</n-button>
                </div>
            </n-tab-pane>
            <n-tab-pane name="manual" tab="导入登录凭据">
                <p>
                    使用酷狗标准版的 userid 和 token；如有同一登录设备的
                    MID、DFID，请一并填写。
                </p>
                <n-form-item label="userid"
                    ><n-input
                        v-model:value="manual.userid"
                        placeholder="酷狗用户 ID"
                /></n-form-item>
                <n-form-item label="token"
                    ><n-input
                        v-model:value="manual.token"
                        type="password"
                        show-password-on="click"
                        placeholder="酷狗登录 token"
                /></n-form-item>
                <n-form-item label="MID"
                    ><n-input
                        v-model:value="manual.mid"
                        placeholder="选填，登录设备 MID"
                /></n-form-item>
                <n-form-item label="DFID"
                    ><n-input
                        v-model:value="manual.dfid"
                        placeholder="选填，登录设备 DFID"
                /></n-form-item>
                <n-button
                    :loading="busy"
                    :disabled="!manual.userid.trim() || !manual.token.trim()"
                    @click="saveManual"
                    >保存凭据</n-button
                >
            </n-tab-pane>
        </n-tabs>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NTabPane, NTabs } from 'naive-ui'
import { kugouLogin } from '../../api/kugouLogin'

const loggedIn = ref(false)
const userid = ref('')
const busy = ref(false)
const error = ref('')
const tab = ref('qr')
const qrImage = ref('')
const qrMessage = ref('请使用酷狗音乐 App 扫码并确认登录')
const manual = reactive({ userid: '', token: '', mid: '', dfid: '' })
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let disposed = false

function stopPolling() {
    generation++
    clearTimeout(timer)
}

function message(err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
}

async function poll(id: string, current: number) {
    try {
        const result = await kugouLogin('check', id)
        if (disposed || current !== generation) return
        if (result.status === 'confirmed') {
            loggedIn.value = true
            userid.value = result.userid ?? ''
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
                : '请使用酷狗音乐 App 扫码'
        timer = setTimeout(() => void poll(id, current), 2000)
    } catch (err) {
        if (disposed || current !== generation) return
        message(err)
        stopPolling()
    }
}

async function refreshQr() {
    stopPolling()
    const current = generation
    busy.value = true
    error.value = ''
    try {
        const result = await kugouLogin('qr')
        if (disposed || current !== generation) return
        qrImage.value = result.qr_image ?? ''
        qrMessage.value = '请使用酷狗音乐 App 扫码'
        if (result.qrcode_id)
            timer = setTimeout(
                () => void poll(result.qrcode_id!, current),
                2000,
            )
    } catch (err) {
        if (!disposed && current === generation) message(err)
    } finally {
        busy.value = false
    }
}

async function saveManual() {
    stopPolling()
    busy.value = true
    error.value = ''
    try {
        const result = await kugouLogin('manual', undefined, { ...manual })
        if (disposed) return
        loggedIn.value = result.logged_in ?? false
        userid.value = result.userid ?? ''
        manual.token = ''
        qrImage.value = ''
    } catch (err) {
        if (!disposed) message(err)
    } finally {
        busy.value = false
    }
}

async function logout() {
    stopPolling()
    busy.value = true
    error.value = ''
    try {
        await kugouLogin('logout')
        if (disposed) return
        loggedIn.value = false
        userid.value = ''
        qrImage.value = ''
    } catch (err) {
        if (!disposed) message(err)
    } finally {
        busy.value = false
    }
}

onMounted(async () => {
    const current = generation
    try {
        const result = await kugouLogin('status')
        if (disposed || current !== generation) return
        loggedIn.value = result.logged_in ?? false
        userid.value = result.userid ?? ''
    } catch (err) {
        if (!disposed) message(err)
    }
})
onUnmounted(() => {
    disposed = true
    stopPolling()
    manual.token = ''
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
