import { computed, ref } from 'vue'
import type {
    AccountStatus,
    LoginAdapter,
    LoginValues,
    QrStatus,
} from '../api/platformLoginApi'

/** 每个平台一份状态；串行轮询并丢弃过期响应，生命周期由宿主组件控制。 */
export function usePlatformLogin(adapter: LoginAdapter) {
    const account = ref<AccountStatus>({
        loggedIn: false,
        userId: '',
        nickname: '',
    })
    const checking = ref(true)
    const statusKnown = ref(false)
    const busy = ref(false)
    const error = ref('')
    const qrImage = ref('')
    const qrStatus = ref<QrStatus | 'idle'>('idle')
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let disposed = false

    function stopQr() {
        generation++
        clearTimeout(timer)
        qrImage.value = ''
        qrStatus.value = 'idle'
    }

    function showError(err: unknown) {
        error.value = err instanceof Error ? err.message : String(err)
    }

    async function run(action: () => Promise<void>) {
        if (busy.value || disposed) return
        stopQr()
        const current = generation
        busy.value = true
        error.value = ''
        try {
            await action()
        } catch (err) {
            if (!disposed && current === generation) showError(err)
        } finally {
            if (!disposed && current === generation) busy.value = false
        }
    }

    async function checkStatus() {
        return run(async () => {
            const current = generation
            checking.value = true
            statusKnown.value = false
            try {
                const result = await adapter.status()
                if (disposed || current !== generation) return
                account.value = result
                statusKnown.value = true
            } finally {
                if (!disposed && current === generation) checking.value = false
            }
        })
    }

    async function poll(id: string, current: number) {
        try {
            const result = await adapter.checkQr(id)
            if (disposed || current !== generation) return
            qrStatus.value = result.status
            if (result.status === 'confirmed') {
                if (!result.account?.loggedIn)
                    throw new Error('未能确认账号状态，请重新检查登录')
                account.value = result.account
                statusKnown.value = true
                stopQr()
            } else if (
                result.status === 'waiting' ||
                result.status === 'scanned'
            ) {
                // 上一次请求结束后才安排下一次，慢网络下也不会叠加请求。
                timer = setTimeout(() => void poll(id, current), 2000)
            }
        } catch (err) {
            if (disposed || current !== generation) return
            qrStatus.value = 'error'
            showError(err)
        }
    }

    function createQr() {
        return run(async () => {
            const current = generation
            const result = await adapter.createQr()
            if (disposed || current !== generation) return
            if (!result.id || !result.image)
                throw new Error('未获取到有效二维码，请重试')
            qrImage.value = result.image
            qrStatus.value = 'waiting'
            timer = setTimeout(() => void poll(result.id, current), 2000)
        })
    }

    function login(values: LoginValues) {
        return run(async () => {
            const current = generation
            const result = await adapter.manual(values)
            if (disposed || current !== generation) return
            if (!result.loggedIn) throw new Error('凭据验证失败，请检查后重试')
            account.value = result
            statusKnown.value = true
        })
    }

    function logout() {
        return run(async () => {
            const current = generation
            await adapter.logout()
            if (disposed || current !== generation) return
            account.value = { loggedIn: false, userId: '', nickname: '' }
            statusKnown.value = true
        })
    }

    function refresh() {
        const action = adapter.refresh
        if (!action) return
        return run(async () => {
            const current = generation
            const result = await action()
            if (disposed || current !== generation) return
            account.value = result
            statusKnown.value = true
        })
    }

    function suspend() {
        stopQr()
        busy.value = false
        checking.value = false
    }

    function dispose() {
        disposed = true
        suspend()
    }

    return {
        account,
        checking,
        statusKnown,
        busy,
        error,
        qrImage,
        qrStatus,
        loggedIn: computed(() => account.value.loggedIn),
        checkStatus,
        createQr,
        login,
        logout,
        refresh,
        stopQr,
        suspend,
        dispose,
    }
}
