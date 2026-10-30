import { computed, ref } from 'vue'
import type {
    AccountStatus,
    LoginAdapter,
    LoginValues,
    QrStatus,
} from '../api/platformLoginApi'

/** 每个平台一份状态；串行轮询并丢弃过期响应，生命周期由宿主组件控制。 */
export function usePlatformLogin(
    adapter: LoginAdapter,
    options: { verifyAfterLogin?: boolean } = {},
) {
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
    let activeRun: Promise<void> = Promise.resolve()
    let actionKind = ''

    function stopQr() {
        generation++
        clearTimeout(timer)
        qrImage.value = ''
        qrStatus.value = 'idle'
    }

    function showError(err: unknown) {
        error.value = err instanceof Error ? err.message : String(err)
    }

    function run(action: () => Promise<void>, kind = 'action'): Promise<void> {
        if (busy.value || disposed) return Promise.resolve()
        stopQr()
        const current = generation
        busy.value = true
        actionKind = kind
        error.value = ''
        activeRun = (async () => {
            try {
                await action()
            } catch (err) {
                if (!disposed && current === generation) showError(err)
            } finally {
                if (!disposed && current === generation) {
                    busy.value = false
                    actionKind = ''
                }
            }
        })()
        return activeRun
    }

    async function checkStatus(renew = false) {
        return run(async () => {
            const current = generation
            checking.value = true
            statusKnown.value = false
            try {
                const result = await (renew && adapter.refresh
                    ? adapter.refresh()
                    : adapter.status())
                if (disposed || current !== generation) return
                account.value = result
                statusKnown.value = true
                error.value = result.expired
                    ? result.message || '登录已失效，请重新登录'
                    : ''
            } finally {
                if (!disposed && current === generation) checking.value = false
            }
        }, 'status')
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
        }, 'qr')
    }

    function login(values: LoginValues) {
        return run(async () => {
            const current = generation
            const result = await adapter.manual(values)
            if (disposed || current !== generation) return
            if (!result.loggedIn) throw new Error('凭据验证失败，请检查后重试')
            if (options.verifyAfterLogin) {
                // 导入凭据可能只完成格式校验；在线确认前不能展示为已登录。
                statusKnown.value = false
                checking.value = true
                try {
                    const verified = await adapter.status()
                    if (disposed || current !== generation) return
                    account.value = verified
                    statusKnown.value = true
                    error.value = verified.expired
                        ? verified.message || '登录已失效，请重新登录'
                        : ''
                } finally {
                    if (!disposed && current === generation)
                        checking.value = false
                }
            } else {
                account.value = result
                statusKnown.value = true
            }
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
        return checkStatus(true)
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

    /** 页面离开只取消扫码流程，后台校验和已提交的登录操作仍可更新共享状态。 */
    function cancelQr() {
        if (qrImage.value || actionKind === 'qr') suspend()
    }

    function invalidateStatus() {
        suspend()
        statusKnown.value = false
    }

    function reset() {
        suspend()
        account.value = { loggedIn: false, userId: '', nickname: '' }
        statusKnown.value = false
        error.value = ''
    }

    return {
        account,
        checking,
        statusKnown,
        busy,
        error,
        qrImage,
        qrStatus,
        loggedIn: computed(
            () =>
                statusKnown.value &&
                account.value.loggedIn &&
                !account.value.expired,
        ),
        checkStatus,
        createQr,
        login,
        logout,
        refresh,
        stopQr,
        suspend,
        dispose,
        cancelQr,
        invalidateStatus,
        reset,
        whenIdle: () => activeRun,
    }
}
