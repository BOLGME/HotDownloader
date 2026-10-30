import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import * as pinia from 'pinia'

const root = path.resolve(import.meta.dirname, '..')
const signedIn = { loggedIn: true, userId: '123', nickname: '测试账号' }
const signedOut = { loggedIn: false, userId: '', nickname: '' }
const expired = {
    ...signedOut,
    expired: true,
    message: '登录已失效，请重新登录',
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const plain = (value) => JSON.parse(JSON.stringify(value))
function deferred() {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}

function harness() {
    const modules = new Map(),
        calls = [],
        timers = new Map()
    const windowEvents = new Map(),
        documentEvents = new Map()
    const document = {
        visibilityState: 'visible',
        addEventListener: (name, fn) => documentEvents.set(name, fn),
        removeEventListener: (name) => documentEvents.delete(name),
    }
    const hooks = { mount: [], activate: [], deactivate: [], unmount: [] }
    const route = vue.reactive({ query: {} })
    let timerId = 0
    const adapters = Object.fromEntries(
        ['qqmusic', 'netease', 'kugou'].map((platform) => [
            platform,
            {
                status: async () => {
                    calls.push([platform, 'status'])
                    return { ...signedIn }
                },
                refresh:
                    platform === 'kugou'
                        ? undefined
                        : async () => {
                              calls.push([platform, 'refresh'])
                              return { ...signedIn }
                          },
                createQr: async () => ({ id: 'qr', image: 'qr-image' }),
                checkQr: async () => ({ status: 'waiting' }),
                manual: async () => ({ ...signedIn }),
                logout: async () => {},
            },
        ]),
    )
    const activePinia = pinia.createPinia()
    function load(file) {
        const absolute = path.resolve(root, file)
        if (modules.has(absolute)) return modules.get(absolute)
        const exports = {}
        modules.set(absolute, exports)
        const source = readFileSync(absolute, 'utf8')
        const text = absolute.endsWith('.vue')
            ? source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
            : source
        const { outputText } = ts.transpileModule(text, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
            },
        })
        vm.runInNewContext(outputText, {
            exports,
            Error,
            document,
            window: {
                addEventListener: (name, fn) => windowEvents.set(name, fn),
                removeEventListener: (name) => windowEvents.delete(name),
            },
            setTimeout(fn) {
                const id = ++timerId
                timers.set(id, fn)
                return id
            },
            clearTimeout(id) {
                timers.delete(id)
            },
            require(name) {
                if (name === 'pinia') return pinia
                if (name === 'vue')
                    return absolute.endsWith('.vue')
                        ? {
                              ...vue,
                              onMounted: (fn) => hooks.mount.push(fn),
                              onActivated: (fn) => hooks.activate.push(fn),
                              onDeactivated: (fn) => hooks.deactivate.push(fn),
                              onUnmounted: (fn) => hooks.unmount.push(fn),
                          }
                        : vue
                if (name === 'vue-router') return { useRoute: () => route }
                if (name.endsWith('/platformLoginApi'))
                    return {
                        getLoginAdapter: (platform) => adapters[platform],
                        isLoginPlatform: (platform) => platform in adapters,
                    }
                if (name.endsWith('.vue')) return {}
                assert.ok(name.startsWith('.'), name)
                return load(path.resolve(path.dirname(absolute), `${name}.ts`))
            },
        })
        return exports
    }
    const store = load('src/stores/accountStore.ts').useAccountStore(
        activePinia,
    )
    return {
        store,
        adapters,
        calls,
        timers,
        hooks,
        document,
        windowEvents,
        documentEvents,
        events: load('src/api/accountEvents.ts'),
        loadPage() {
            pinia.setActivePinia(activePinia)
            const scope = vue.effectScope()
            scope.run(() => load('src/components/settings/AccountSettings.vue'))
            return scope
        },
        dispose() {
            store.$dispose()
            pinia.disposePinia(activePinia)
        },
    }
}

test('startup switch controls renewal and each app session initializes once', async (t) => {
    const h = harness()
    t.after(h.dispose)
    const first = h.store.initialize(true)
    assert.equal(h.store.initialize(true), first)
    await first
    assert.deepEqual(h.calls.sort(), [
        ['kugou', 'status'],
        ['netease', 'refresh'],
        ['qqmusic', 'refresh'],
    ])
    h.store.reset()
    h.calls.length = 0
    await h.store.initialize(false)
    assert.equal(h.calls.length, 0)
    await h.store.checkAll()
    assert.equal(
        h.calls.length,
        3,
        'the account page can still verify status while startup renewal is disabled',
    )
})

test('startup failure distinguishes expired credentials from a network check error and queues one warning', async (t) => {
    const h = harness()
    t.after(h.dispose)
    h.adapters.qqmusic.refresh = async () => ({ ...expired })
    h.adapters.netease.refresh = async () => {
        throw new Error('网络暂不可用')
    }
    await h.store.initialize(true)
    assert.equal(h.store.sessions.qqmusic.statusKnown, true)
    assert.equal(h.store.sessions.qqmusic.loggedIn, false)
    assert.equal(h.store.sessions.qqmusic.account.expired, true)
    assert.equal(h.store.sessions.netease.statusKnown, false)
    assert.equal(h.store.sessions.netease.error, '网络暂不可用')
    assert.equal(h.store.startupWarnings.length, 1)
    assert.match(h.store.takeStartupWarnings()[0], /QQ 音乐登录已失效/)
    await h.store.initialize(true)
    assert.equal(h.store.startupWarnings.length, 0)
})

test('failure events invalidate the same shared state read by a cached page, without launching duplicate checks', async (t) => {
    const h = harness()
    t.after(h.dispose)
    await h.store.initialize(true)
    const session = h.store.sessions.qqmusic
    const cachedPageKnown = vue.toRef(session, 'statusKnown')
    const cachedPageAccount = vue.toRef(session, 'account')
    const pending = deferred()
    let checks = 0
    h.adapters.qqmusic.status = () => {
        checks++
        return pending.promise
    }
    h.events.reportAccountError('qqmusic', 'QQ 音乐登录已过期，请重新登录')
    assert.equal(cachedPageKnown.value, false)
    assert.equal(session.loggedIn, false)
    h.events.reportAccountError('qqmusic', '接口错误: code=104401')
    assert.equal(checks, 1)
    pending.resolve({ ...expired })
    await session.whenIdle()
    assert.equal(cachedPageKnown.value, true)
    assert.equal(cachedPageAccount.value.expired, true)
    assert.equal(session.loggedIn, false)
    const before = h.calls.length
    h.events.reportAccountError('netease', '网络请求失败')
    h.events.reportAccountError('kugou', '需要会员权限')
    assert.equal(h.calls.length, before)
})

test('leaving a page stops QR polling while an already submitted login can update the shared account', async (t) => {
    const h = harness()
    t.after(h.dispose)
    const session = h.store.sessions.qqmusic
    const pending = deferred()
    h.adapters.qqmusic.manual = () => pending.promise
    const login = session.login({ uin: '123', authst: 'example' })
    session.cancelQr()
    pending.resolve({ ...signedIn })
    await login
    assert.equal(session.loggedIn, true)
    await session.createQr()
    assert.equal(h.timers.size, 1)
    session.cancelQr()
    assert.equal(h.timers.size, 0)
    assert.equal(session.qrImage, '')
})

test('startup coordinates with a page check and does not interrupt an active QR login', async (t) => {
    const h = harness()
    t.after(h.dispose)
    const pending = deferred()
    h.adapters.qqmusic.status = () => pending.promise
    const status = h.store.sessions.qqmusic.checkStatus()
    const startup = h.store.initialize(true)
    pending.resolve({ ...signedIn })
    await Promise.all([status, startup])
    assert.ok(
        !h.calls.some(([platform]) => platform === 'qqmusic'),
        'a successful in-flight online check satisfies startup verification',
    )
    h.store.reset()
    h.calls.length = 0
    await h.store.sessions.qqmusic.createQr()
    await h.store.initialize(true)
    assert.equal(h.store.sessions.qqmusic.qrImage, 'qr-image')
    assert.equal(h.timers.size, 1)
})

test('auth-session reset rejects late checks and late startup warnings', async (t) => {
    const h = harness()
    t.after(h.dispose)
    const pending = deferred()
    h.adapters.qqmusic.refresh = () => pending.promise
    const startup = h.store.initialize(true)
    await settle()
    h.store.reset()
    pending.resolve({ ...expired })
    await startup
    assert.equal(h.store.sessions.qqmusic.statusKnown, false)
    assert.equal(h.store.startupWarnings.length, 0)
})

test('imported credentials need online verification before displaying as connected', async (t) => {
    const h = harness()
    t.after(h.dispose)
    h.adapters.qqmusic.status = async () => ({ ...expired })
    await h.store.sessions.qqmusic.login({ uin: '123', authst: 'example' })
    assert.equal(h.store.sessions.qqmusic.loggedIn, false)
    assert.equal(h.store.sessions.qqmusic.account.expired, true)
    h.adapters.qqmusic.status = async () => {
        throw new Error('无法联网确认')
    }
    await h.store.sessions.qqmusic.login({ uin: '123', authst: 'example' })
    assert.equal(h.store.sessions.qqmusic.statusKnown, false)
    assert.equal(h.store.sessions.qqmusic.error, '无法联网确认')
})

test('account-page checks stop in cached pages and hidden windows, and listeners are released', async (t) => {
    const h = harness()
    t.after(h.dispose)
    const scope = h.loadPage()
    t.after(() => scope.stop())
    h.hooks.mount.forEach((fn) => fn())
    h.hooks.activate.forEach((fn) => fn())
    await settle()
    assert.equal(h.calls.length, 3)
    assert.equal(h.timers.size, 1)
    h.document.visibilityState = 'hidden'
    h.documentEvents.get('visibilitychange')()
    assert.equal(h.calls.length, 3)
    h.hooks.deactivate.forEach((fn) => fn())
    assert.equal(h.timers.size, 0)
    h.windowEvents.get('focus')()
    assert.equal(h.calls.length, 3)
    h.document.visibilityState = 'visible'
    h.hooks.activate.forEach((fn) => fn())
    await settle()
    assert.equal(h.calls.length, 6)
    h.hooks.unmount.forEach((fn) => fn())
    assert.equal(h.timers.size, 0)
    assert.equal(h.windowEvents.size, 0)
    assert.equal(h.documentEvents.size, 0)
})

test('page scroll state has the same bounded LRU policy and excludes uncached routes', () => {
    const source = readFileSync(
        path.join(root, 'src/utils/viewCache.ts'),
        'utf8',
    )
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    })
    const exports = {}
    vm.runInNewContext(outputText, { exports })
    const cache = exports.createViewScrollCache(2)
    const route = (id, keepAlive = true) => ({
        path: '/artist',
        fullPath: `/artist?id=${id}`,
        meta: { keepAlive },
    })
    const a = route('a'),
        b = route('b'),
        c = route('c')
    cache.activate(a)
    cache.remember(a, 10)
    cache.activate(b)
    cache.remember(b, 20)
    assert.equal(cache.activate(a), 10)
    cache.activate(c)
    assert.equal(cache.activate(a), 10)
    assert.equal(cache.activate(b), 0)
    cache.remember(b, 30)
    const about = {
        path: '/settings/about',
        fullPath: '/settings/about',
        meta: { keepAlive: false },
    }
    cache.activate(about)
    cache.remember(about, 100)
    assert.equal(cache.activate(about), 0)
    assert.equal(cache.activate(b), 30)
    assert.equal(
        exports.viewCacheKey({
            path: '/playlist',
            fullPath: '/playlist?id=1',
            meta: {},
        }),
        '/playlist',
    )
})

for (const native of [false, true]) {
    test(`${native ? 'Tauri/Android IPC' : 'Docker/Web HTTP'}: online checks use the new credential-free contract without caching`, async () => {
        const source = readFileSync(
            path.join(root, 'src/api/accountStatusApi.ts'),
            'utf8',
        )
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS },
        })
        const exports = {},
            calls = []
        const request = async (target, args) => {
            calls.push([target, plain(args)])
            return { ...expired }
        }
        vm.runInNewContext(outputText, {
            exports,
            require(name) {
                if (name === '@tauri-apps/api/core')
                    return { isTauri: () => native, invoke: request }
                if (name === './webClient')
                    return {
                        webRequest: (url, options) =>
                            request(url, JSON.parse(options.body)),
                    }
                assert.fail(name)
            },
        })
        for (const platform of ['qqmusic', 'netease', 'kugou']) {
            const result = await exports.checkAccountStatus(platform, true)
            assert.equal(result.expired, true)
            assert.deepEqual(calls.at(-1), [
                native ? 'check_platform_login' : '/api/login/session',
                { platform, refresh: true },
            ])
        }
        await exports.checkAccountStatus('qqmusic')
        await exports.checkAccountStatus('qqmusic')
        assert.equal(calls.length, 5)
        assert.equal(calls.at(-1)[1].refresh, false)
    })
}
