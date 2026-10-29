import * as musicApi from './musicApi'
import { kugouLogin, type KugouLoginResult } from './kugouLogin'
import { neteaseLogin, type NeteaseLoginResult } from './neteaseLogin'
import { checkAccountStatus } from './accountStatusApi'

export type LoginPlatform = 'qqmusic' | 'kugou' | 'netease'
export type QrStatus = musicApi.LoginCheckResult['status']
export type LoginValues = Record<string, string>

export function isLoginPlatform(value: unknown): value is LoginPlatform {
    return value === 'qqmusic' || value === 'kugou' || value === 'netease'
}

export interface AccountStatus {
    loggedIn: boolean
    userId: string
    nickname: string
    expired?: boolean
    message?: string
}

export interface LoginAdapter {
    status(): Promise<AccountStatus>
    createQr(): Promise<{ id: string; image: string }>
    checkQr(id: string): Promise<{ status: QrStatus; account?: AccountStatus }>
    manual(values: LoginValues): Promise<AccountStatus>
    logout(): Promise<void>
    refresh?: () => Promise<AccountStatus>
}

function account(result: KugouLoginResult | NeteaseLoginResult): AccountStatus {
    return {
        loggedIn: result.logged_in ?? result.status === 'confirmed',
        userId: result.userid ?? '',
        nickname: 'nickname' in result ? (result.nickname ?? '') : '',
    }
}

/** 在这里消化各平台的协议差异，页面只处理统一的账号和二维码状态。 */
export function getLoginAdapter(platform: LoginPlatform): LoginAdapter {
    if (platform === 'qqmusic') {
        const fromQq = (uin: string): AccountStatus => ({
            loggedIn: true,
            userId: uin,
            nickname: '',
        })
        return {
            async status() {
                return checkAccountStatus(platform)
            },
            refresh: () => checkAccountStatus(platform, true),
            async createQr() {
                const result = await musicApi.createQrLogin(platform)
                return {
                    id: result.qrcode_id,
                    image: `data:image/png;base64,${result.qr_base64}`,
                }
            },
            async checkQr(id) {
                const result = await musicApi.checkQrLogin(platform, id)
                return {
                    status: result.status,
                    account:
                        result.status === 'confirmed'
                            ? result.credentials
                                ? fromQq(result.credentials.uin)
                                : await this.status()
                            : undefined,
                }
            },
            async manual(values) {
                const result = await musicApi.loginWithUinAuthst(
                    platform,
                    values.uin ?? '',
                    values.authst ?? '',
                    values.refreshToken,
                    values.refreshKey,
                    values.accessToken,
                    values.openid,
                )
                return fromQq(result.uin)
            },
            logout: () => musicApi.logout(platform),
        }
    }

    // 两个平台的原生 IPC 和 Web 路由由已有 API 分别处理。
    const api = platform === 'netease' ? neteaseLogin : kugouLogin
    return {
        status: () => checkAccountStatus(platform),
        async createQr() {
            const result = await api('qr')
            return { id: result.qrcode_id ?? '', image: result.qr_image ?? '' }
        },
        async checkQr(id) {
            const result = await api('check', id)
            return {
                status: result.status ?? 'error',
                account:
                    result.status === 'confirmed' ? account(result) : undefined,
            }
        },
        async manual(values) {
            const result =
                platform === 'netease'
                    ? await neteaseLogin('manual', undefined, {
                          cookie: values.cookie ?? '',
                      })
                    : await kugouLogin('manual', undefined, {
                          userid: values.userid ?? '',
                          token: values.token ?? '',
                          mid: values.mid ?? '',
                          dfid: values.dfid ?? '',
                      })
            return account(result)
        },
        async logout() {
            await api('logout')
        },
        refresh:
            platform === 'netease'
                ? () => checkAccountStatus(platform, true)
                : undefined,
    }
}
