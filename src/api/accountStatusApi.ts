import { invoke, isTauri } from '@tauri-apps/api/core'
import { webRequest } from './webClient'
import type { AccountStatus, LoginPlatform } from './platformLoginApi'

/** 在线校验由运行时完成，公开状态接口不传递账号凭据。 */
export function checkAccountStatus(
    platform: LoginPlatform,
    refresh = false,
): Promise<AccountStatus> {
    const args = { platform, refresh }
    return isTauri()
        ? invoke<AccountStatus>('check_platform_login', args)
        : webRequest<AccountStatus>('/api/login/session', {
              method: 'POST',
              body: JSON.stringify(args),
          })
}
