import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

function load(file, modules, globals = {}) {
    const { outputText } = ts.transpileModule(
        readFileSync(new URL(file, import.meta.url), 'utf8'),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
            },
        },
    )
    const exports = {}
    vm.runInNewContext(outputText, {
        exports,
        Error,
        require(name) {
            assert.ok(name in modules, `unexpected import: ${name}`)
            return modules[name]
        },
        ...globals,
    })
    return exports
}
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
const signedOut = { loggedIn: false, userId: '', nickname: '' }
const signedIn = { loggedIn: true, userId: '12345', nickname: '测试账号' }
const plain = (value) => JSON.parse(JSON.stringify(value))

function harness(overrides = {}) {
    let nextTimer = 0
    const timers = new Map()
    const adapter = {
        status: async () => signedOut,
        createQr: async () => ({
            id: 'qr-1',
            image: 'data:image/png;base64,example',
        }),
        checkQr: async () => ({ status: 'waiting' }),
        manual: async () => signedIn,
        logout: async () => {},
        ...overrides,
    }
    const { usePlatformLogin } = load(
        '../src/composables/usePlatformLogin.ts',
        { vue },
        {
            setTimeout(fn) {
                const id = ++nextTimer
                timers.set(id, fn)
                return id
            },
            clearTimeout(id) {
                timers.delete(id)
            },
        },
    )
    return {
        login: usePlatformLogin(adapter),
        timers,
        tick() {
            assert.equal(timers.size, 1)
            const [id, fn] = timers.entries().next().value
            timers.delete(id)
            return fn()
        },
    }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('status errors remain retryable and are not presented as a confirmed signed-out state', async () => {
    let calls = 0
    const h = harness({
        status: async () => {
            if (++calls === 1) throw new Error('服务不可用')
            return signedIn
        },
    })
    await h.login.checkStatus()
    assert.equal(h.login.statusKnown.value, false)
    assert.equal(h.login.checking.value, false)
    assert.equal(h.login.busy.value, false)
    assert.equal(h.login.error.value, '服务不可用')
    await h.login.checkStatus()
    assert.equal(h.login.error.value, '')
    assert.equal(h.login.loggedIn.value, true)
    assert.deepEqual(plain(h.login.account.value), signedIn)
})

test('QR polling waits for each response and refreshing discards a late confirmation', async () => {
    const pending = deferred()
    let calls = 0
    const h = harness({
        checkQr: () => {
            calls++
            return pending.promise
        },
    })
    await h.login.createQr()
    h.tick()
    assert.equal(calls, 1)
    assert.equal(
        h.timers.size,
        0,
        'no next poll while a network request is pending',
    )
    await h.login.createQr()
    pending.resolve({ status: 'confirmed', account: signedIn })
    await settle()
    assert.equal(h.login.loggedIn.value, false)
    assert.equal(h.login.qrStatus.value, 'waiting')
    assert.equal(h.timers.size, 1, 'the new session keeps its own timer')
    h.login.dispose()
    assert.equal(h.timers.size, 0)
})

test('a failed recheck marks a previously connected account as unverified', async () => {
    let calls = 0
    const h = harness({
        status: async () => {
            if (++calls === 1) return signedIn
            throw new Error('状态读取失败')
        },
    })
    await h.login.checkStatus()
    assert.equal(h.login.statusKnown.value, true)
    await h.login.checkStatus()
    assert.equal(h.login.statusKnown.value, false)
    assert.equal(h.login.error.value, '状态读取失败')
    await h.login.logout()
    assert.equal(h.login.statusKnown.value, true)
    assert.equal(h.login.loggedIn.value, false)
})

test('scanning updates the message and a valid confirmation ends the session', async () => {
    const results = [
        { status: 'scanned' },
        { status: 'confirmed', account: signedIn },
    ]
    const h = harness({ checkQr: async () => results.shift() })
    await h.login.createQr()
    h.tick()
    await settle()
    assert.equal(h.login.qrStatus.value, 'scanned')
    h.tick()
    await settle()
    assert.equal(h.login.loggedIn.value, true)
    assert.equal(h.login.qrImage.value, '')
    assert.equal(h.timers.size, 0)
})

for (const status of ['expired', 'canceled', 'error']) {
    test(`QR ${status} stops polling and can be refreshed`, async () => {
        const h = harness({ checkQr: async () => ({ status }) })
        await h.login.createQr()
        h.tick()
        await settle()
        assert.equal(h.login.qrStatus.value, status)
        assert.equal(h.login.loggedIn.value, false)
        assert.equal(h.timers.size, 0)
        await h.login.createQr()
        assert.equal(h.login.qrStatus.value, 'waiting')
        assert.equal(h.timers.size, 1)
        h.login.dispose()
    })
}

test('network failures and malformed QR responses stop cleanly without a false login', async () => {
    const h = harness({
        checkQr: async () => {
            throw new Error('网络断开')
        },
    })
    await h.login.createQr()
    h.tick()
    await settle()
    assert.equal(h.login.error.value, '网络断开')
    assert.equal(h.login.qrStatus.value, 'error')
    assert.equal(h.timers.size, 0)
    const invalid = harness({ createQr: async () => ({ id: '', image: '' }) })
    await invalid.login.createQr()
    assert.match(invalid.login.error.value, /有效二维码/)
    assert.equal(invalid.timers.size, 0)
    const unconfirmed = harness({
        checkQr: async () => ({ status: 'confirmed', account: signedOut }),
    })
    await unconfirmed.login.createQr()
    unconfirmed.tick()
    await settle()
    assert.equal(unconfirmed.login.loggedIn.value, false)
    assert.equal(unconfirmed.login.qrStatus.value, 'error')
})

test('manual login excludes duplicate mutations and a failed logout retains the account', async () => {
    const pending = deferred()
    let manualCalls = 0,
        logoutCalls = 0
    const h = harness({
        manual: () => {
            manualCalls++
            return pending.promise
        },
        logout: async () => {
            logoutCalls++
            throw new Error('退出失败')
        },
    })
    const first = h.login.login({ token: 'example' })
    await h.login.login({ token: 'example' })
    await h.login.logout()
    assert.equal(manualCalls, 1)
    assert.equal(logoutCalls, 0)
    pending.resolve(signedIn)
    await first
    await h.login.logout()
    assert.equal(h.login.loggedIn.value, true)
    assert.equal(h.login.error.value, '退出失败')
    assert.equal(h.login.busy.value, false)
})

test('suspension invalidates in-flight status and QR requests, then permits status recovery', async () => {
    for (const action of ['status', 'createQr']) {
        const pending = deferred()
        let calls = 0
        const h = harness({
            [action]: () =>
                ++calls === 1 ? pending.promise : Promise.resolve(signedIn),
        })
        const request =
            action === 'status' ? h.login.checkStatus() : h.login.createQr()
        h.login.suspend()
        pending.resolve(
            action === 'status' ? signedIn : { id: 'stale', image: 'stale' },
        )
        await request
        assert.equal(h.login.loggedIn.value, false)
        assert.equal(h.login.qrImage.value, '')
        assert.equal(h.login.busy.value, false)
        assert.equal(h.timers.size, 0)
        if (action === 'status') {
            await h.login.checkStatus()
            assert.equal(h.login.loggedIn.value, true)
        }
    }
})

test('leaving the panel during a poll prevents late errors and confirms from changing state', async () => {
    for (const fail of [false, true]) {
        const pending = deferred()
        const h = harness({ checkQr: () => pending.promise })
        await h.login.createQr()
        h.tick()
        h.login.dispose()
        if (fail) pending.reject(new Error('late error'))
        else pending.resolve({ status: 'confirmed', account: signedIn })
        await settle()
        assert.equal(h.login.loggedIn.value, false)
        assert.equal(h.login.error.value, '')
        assert.equal(h.timers.size, 0)
        await h.login.createQr()
        assert.equal(h.timers.size, 0)
    }
})

test('successful logout clears identity; manual rejection remains signed out; refresh can expire an account', async () => {
    const h = harness({ refresh: async () => signedOut })
    await h.login.login({})
    await h.login.refresh()
    assert.equal(h.login.loggedIn.value, false)
    await h.login.login({})
    await h.login.logout()
    assert.deepEqual(plain(h.login.account.value), signedOut)
    const invalid = harness({ manual: async () => signedOut })
    await invalid.login.login({})
    assert.equal(invalid.login.loggedIn.value, false)
    assert.match(invalid.login.error.value, /凭据验证失败/)
})

test('adapters normalize QQ credentials and both other platforms without leaking secrets to account state', async () => {
    const calls = []
    const qq = {
        getLoginStatus: async () => ({ logged_in: true, uin: 'qq-user' }),
        createQrLogin: async () => ({ qrcode_id: 'qq-qr', qr_base64: 'png' }),
        checkQrLogin: async () => ({ status: 'confirmed' }),
        loginWithUinAuthst: async (...args) => {
            calls.push(args)
            return { uin: 'qq-user', authst: 'secret' }
        },
        logout: async (platform) => calls.push(platform),
    }
    const other = (platform) => async (action, id, credentials) => {
        calls.push({ platform, action, id, credentials })
        if (action === 'qr')
            return { qrcode_id: `${platform}-qr`, qr_image: 'image' }
        if (action === 'check')
            return { status: 'confirmed', userid: `${platform}-user` }
        return {
            logged_in: action !== 'logout',
            userid: `${platform}-user`,
            nickname: '账号名',
        }
    }
    const { getLoginAdapter, isLoginPlatform } = load(
        '../src/api/platformLoginApi.ts',
        {
            './musicApi': qq,
            './kugouLogin': { kugouLogin: other('kugou') },
            './neteaseLogin': { neteaseLogin: other('netease') },
        },
    )
    assert.equal(isLoginPlatform('kuwo'), false)
    assert.equal(isLoginPlatform(['netease']), false)
    for (const platform of ['qqmusic', 'kugou', 'netease']) {
        assert.equal(isLoginPlatform(platform), true)
        const adapter = getLoginAdapter(platform)
        const qr = await adapter.createQr()
        assert.ok(qr.id && qr.image)
        assert.equal((await adapter.status()).loggedIn, true)
        const checked = await adapter.checkQr(qr.id)
        assert.equal(
            checked.account.loggedIn,
            true,
            'Kugou confirmation does not include logged_in',
        )
        const result = await adapter.manual({
            uin: 'qq-user',
            authst: 'secret',
            cookie: 'MUSIC_U=example',
            userid: 'kg-user',
            token: 'example',
        })
        assert.equal(result.loggedIn, true)
        assert.deepEqual(Object.keys(result).sort(), [
            'loggedIn',
            'nickname',
            'userId',
        ])
        if (platform === 'netease')
            assert.equal((await adapter.refresh()).loggedIn, true)
        else assert.equal(adapter.refresh, undefined)
        await adapter.logout()
    }
    assert.ok(
        calls.some(
            (call) =>
                call.platform === 'kugou' &&
                call.credentials?.userid === 'kg-user' &&
                call.credentials.mid === '',
        ),
    )
    assert.ok(
        calls.some(
            (call) =>
                call.platform === 'netease' &&
                call.credentials?.cookie === 'MUSIC_U=example',
        ),
    )
})
