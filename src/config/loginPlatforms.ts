import type { LoginPlatform } from '../api/platformLoginApi'

export interface LoginField {
    key: string
    label: string
    placeholder: string
    secret?: boolean
    optional?: boolean
}

export interface LoginPlatformConfig {
    key: LoginPlatform
    name: string
    mark: string
    color: string
    description: string
    manualHint: string
    fields: LoginField[]
}

export const LOGIN_PLATFORMS: LoginPlatformConfig[] = [
    {
        key: 'qqmusic',
        name: 'QQ 音乐',
        mark: 'Q',
        color: '#178366',
        description: '使用 QQ 音乐 App 扫码并确认登录',
        manualHint: '填写账号 UIN 和 Authst；刷新凭据可按需补充。',
        fields: [
            { key: 'uin', label: 'UIN', placeholder: 'QQ 音乐账号 UIN' },
            {
                key: 'authst',
                label: 'Authst',
                placeholder: '账号登录凭据',
                secret: true,
            },
            ...['refreshToken', 'refreshKey', 'accessToken', 'openid'].map(
                (key) => ({
                    key,
                    label: key === 'openid' ? 'OpenID' : key,
                    placeholder: '选填，用于刷新登录',
                    secret: true,
                    optional: true,
                }),
            ),
        ],
    },
    {
        key: 'kugou',
        name: '酷狗音乐',
        mark: 'K',
        color: '#2878d0',
        description: '使用酷狗音乐 App 扫码并确认登录',
        manualHint:
            '填写酷狗标准版的 userid 和 token，设备信息需来自同一次登录。',
        fields: [
            { key: 'userid', label: 'userid', placeholder: '酷狗用户 ID' },
            {
                key: 'token',
                label: 'token',
                placeholder: '酷狗登录 token',
                secret: true,
            },
            {
                key: 'mid',
                label: 'MID',
                placeholder: '登录设备 MID',
                optional: true,
            },
            {
                key: 'dfid',
                label: 'DFID',
                placeholder: '登录设备 DFID',
                optional: true,
            },
        ],
    },
    {
        key: 'netease',
        name: '网易云音乐',
        mark: 'N',
        color: '#c84c4c',
        description: '使用网易云音乐 App 扫码并确认登录',
        manualHint: '粘贴网易云音乐网页版登录后的 Cookie，需包含 MUSIC_U。',
        fields: [
            {
                key: 'cookie',
                label: 'Cookie',
                placeholder: 'MUSIC_U=…; __csrf=…',
                secret: true,
            },
        ],
    },
]
