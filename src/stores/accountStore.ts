import { onScopeDispose, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { getLoginAdapter, isLoginPlatform } from '../api/platformLoginApi'
import type { LoginPlatform } from '../api/platformLoginApi'
import { usePlatformLogin } from '../composables/usePlatformLogin'
import { onAccountError } from '../api/accountEvents'

export const useAccountStore = defineStore('accounts', () => {
    // 生命周期属于应用会话；页面缓存淘汰不会丢失或复制账号的在线状态。
    const sessions = reactive({
        qqmusic: usePlatformLogin(getLoginAdapter('qqmusic'), {
            verifyAfterLogin: true,
        }),
        kugou: usePlatformLogin(getLoginAdapter('kugou'), {
            verifyAfterLogin: true,
        }),
        netease: usePlatformLogin(getLoginAdapter('netease'), {
            verifyAfterLogin: true,
        }),
    })
    const platforms = Object.keys(sessions) as LoginPlatform[]
    let startup: Promise<void> | null = null
    let generation = 0
    const startupWarnings = ref<string[]>([])

    async function checkAll(renew = false) {
        await Promise.all(
            platforms.map(async (platform) => {
                const session = sessions[platform]
                if (session.busy || session.qrImage) return
                await session.checkStatus(renew)
            }),
        )
    }

    /** 每次应用授权会话只执行一次；与已经开始的页面查询协调，避免打断扫码。 */
    function initialize(enabled: boolean) {
        if (startup) return startup
        const current = generation
        startup = enabled
            ? Promise.all(
                  platforms.map(async (platform) => {
                      const session = sessions[platform]
                      const wasBusy = session.busy
                      await session.whenIdle()
                      if (
                          current !== generation ||
                          session.busy ||
                          session.qrImage
                      )
                          return
                      if (wasBusy && session.statusKnown && session.loggedIn)
                          return
                      await session.checkStatus(true)
                      if (
                          current === generation &&
                          session.statusKnown &&
                          session.account.expired
                      ) {
                          const name = {
                              qqmusic: 'QQ 音乐',
                              netease: '网易云音乐',
                              kugou: '酷狗音乐',
                          }[platform]
                          startupWarnings.value.push(
                              `${name}登录已失效，请前往设置重新登录`,
                          )
                      }
                  }),
              ).then(() => {})
            : Promise.resolve()
        return startup
    }

    /** 失效提示先撤掉“已登录”可信标记，再在线核验；网络错误只能显示未知状态。 */
    function recheck(platform: string) {
        if (!isLoginPlatform(platform)) return
        const session = sessions[platform]
        if (session.qrImage || session.busy) return
        session.invalidateStatus()
        void session.checkStatus()
    }

    function observeFailure(platform: string, reason: unknown) {
        const text = reason instanceof Error ? reason.message : String(reason)
        if (
            /登录.{0,8}(失效|过期)|请.{0,3}(重新|先)?登录|凭据.{0,5}(失效|过期)|接口错误: code=(1000|104400|104401)\b|网易云请求失败 \((301|302)\)/.test(
                text,
            ) ||
            (platform === 'kugou' &&
                /^酷狗请求失败.*token.*(失效|错误|过期|无效|验证失败|校验失败|invalid|expired)/i.test(
                    text,
                ))
        )
            recheck(platform)
    }

    function reset() {
        generation++
        startup = null
        startupWarnings.value = []
        platforms.forEach((platform) => sessions[platform].reset())
    }

    const stopErrors = onAccountError(observeFailure)
    onScopeDispose(() => {
        stopErrors()
        platforms.forEach((platform) => sessions[platform].dispose())
    })
    function takeStartupWarnings() {
        return startupWarnings.value.splice(0)
    }
    return {
        sessions,
        initialize,
        checkAll,
        recheck,
        observeFailure,
        reset,
        startupWarnings,
        takeStartupWarnings,
    }
})
