import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
const flush = () => Promise.resolve()
const plain = (value) => JSON.parse(JSON.stringify(value))

function harness(native = true) {
    const modules = new Map()
    const calls = []
    let now = 0
    function request(target, args) {
        const pending = deferred()
        calls.push({ target, args: plain(args ?? {}), ...pending })
        return pending.promise
    }
    function load(file) {
        const absolute = path.resolve(root, file)
        if (modules.has(absolute)) return modules.get(absolute)
        const exports = {}
        modules.set(absolute, exports)
        const { outputText } = ts.transpileModule(
            readFileSync(absolute, 'utf8'),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2022,
                },
            },
        )
        vm.runInNewContext(outputText, {
            exports,
            Date: { now: () => now },
            require(name) {
                if (name === '@tauri-apps/api/core')
                    return {
                        isTauri: () => native,
                        invoke(command, args) {
                            const result = request(command, args)
                            return command === 'search_songs'
                                ? result.then(JSON.stringify)
                                : result
                        },
                    }
                if (name === './webClient')
                    return {
                        webRequest: (url, options) =>
                            request(
                                url,
                                options?.body ? JSON.parse(options.body) : {},
                            ),
                    }
                assert.ok(name.startsWith('.'), `unexpected import: ${name}`)
                return load(path.resolve(path.dirname(absolute), `${name}.ts`))
            },
        })
        return exports
    }
    return {
        query: load('src/api/queryCache.ts'),
        invoke: load('src/api/cachedInvoke.ts'),
        api: load('src/api/musicApi.ts'),
        calls,
        setNow(value) {
            now = value
        },
    }
}

test('slow requests are shared beyond TTL, and TTL starts when the response succeeds', async () => {
    const h = harness()
    const cache = h.query.createQueryCache({ ttlMs: 10 })
    const slow = deferred()
    let calls = 0
    const load = () => {
        calls++
        return slow.promise
    }
    const first = cache.run('covers', 'a', load)
    await flush()
    assert.equal(calls, 1)
    h.setNow(100)
    assert.equal(cache.run('covers', 'a', load), first)
    slow.resolve('first')
    await first
    h.setNow(109)
    assert.equal(cache.run('covers', 'a', load), first)
    h.setNow(110)
    assert.equal(
        await cache.run('covers', 'a', () => {
            calls++
            return Promise.resolve('fresh')
        }),
        'fresh',
    )
    assert.equal(calls, 2)
})

test('rejected and synchronously throwing loaders are removed and remain retryable', async () => {
    const cache = harness().query.createQueryCache()
    await assert.rejects(
        cache.run('g', 'a', () => Promise.reject(new Error('network failure'))),
        /network failure/,
    )
    assert.equal(
        await cache.run('g', 'a', () => Promise.resolve('retry')),
        'retry',
    )
    const failure = cache.run('g', 'b', () => {
        throw new Error('sync failure')
    })
    await assert.rejects(failure, /sync failure/)
    assert.equal(
        await cache.run('g', 'b', () => Promise.resolve('recovered')),
        'recovered',
    )
})

test('late success after clearing cannot overwrite or repopulate a newer cached response', async () => {
    const cache = harness().query.createQueryCache()
    const old = deferred(),
        fresh = deferred()
    const a = cache.run('g', 'key', () => old.promise)
    await flush()
    cache.clear()
    const b = cache.run('g', 'key', () => fresh.promise)
    await flush()
    fresh.resolve('fresh')
    await b
    old.resolve('old')
    assert.equal(await a, 'old', 'clearing does not cancel the original caller')
    assert.equal(
        cache.run('g', 'key', () => assert.fail('new result must stay cached')),
        b,
    )
    const pending = deferred()
    const c = cache.run('other', 'key', () => pending.promise)
    await flush()
    cache.clear('other')
    pending.resolve('obsolete')
    await c
    assert.equal(
        await cache.run('other', 'key', () => Promise.resolve('reloaded')),
        'reloaded',
    )
})

test('late rejection after clearing cannot remove a newer in-flight request', async () => {
    const cache = harness().query.createQueryCache()
    const old = deferred(),
        fresh = deferred()
    const a = cache.run('g', 'key', () => old.promise)
    const rejected = assert.rejects(a, /old failure/)
    await flush()
    cache.clear('g')
    const b = cache.run('g', 'key', () => fresh.promise)
    await flush()
    old.reject(new Error('old failure'))
    await rejected
    assert.equal(
        cache.run('g', 'key', () =>
            assert.fail('must still share the new request'),
        ),
        b,
    )
    fresh.resolve('fresh')
    assert.equal(await b, 'fresh')
})

test('completed results have an LRU limit and cache hits update recency', async () => {
    const cache = harness().query.createQueryCache({ maxEntries: 2 })
    const counts = { a: 0, b: 0, c: 0 }
    const read = (key) =>
        cache.run('g', key, () => Promise.resolve(`${key}-${++counts[key]}`))
    assert.equal(await read('a'), 'a-1')
    assert.equal(await read('b'), 'b-1')
    assert.equal(await read('a'), 'a-1')
    assert.equal(await read('c'), 'c-1')
    assert.equal(await read('a'), 'a-1')
    assert.equal(await read('b'), 'b-2')
})

test('result eviction does not evict slow in-flight requests', async () => {
    const h = harness()
    const cache = h.query.createQueryCache({ maxEntries: 1, ttlMs: 10 })
    const slow = deferred()
    const request = cache.run('g', 'slow', () => slow.promise)
    await flush()
    await cache.run('g', 'a', () => Promise.resolve('a'))
    await cache.run('g', 'b', () => Promise.resolve('b'))
    h.setNow(1000)
    assert.equal(
        cache.run('g', 'slow', () =>
            assert.fail('slow request must remain deduplicated'),
        ),
        request,
    )
    slow.resolve('slow')
    assert.equal(await request, 'slow')
})

test('query groups isolate custom keys and targeted clearing also clears custom-key entries', async () => {
    const h = harness()
    const first = h.invoke.cachedInvoke('first', { id: 1 }, { key: 'shared' })
    const second = h.invoke.cachedInvoke('second', { id: 1 }, { key: 'shared' })
    await flush()
    assert.equal(h.calls.length, 2)
    h.calls[0].resolve('one')
    h.calls[1].resolve('two')
    await Promise.all([first, second])
    h.invoke.clearInvokeCacheByCommand('first')
    assert.equal(
        h.invoke.cachedInvoke('second', { id: 2 }, { key: 'shared' }),
        second,
    )
    const reload = h.invoke.cachedInvoke('first', undefined, { key: 'shared' })
    await flush()
    assert.equal(h.calls.length, 3)
    h.calls[2].resolve('new one')
    assert.equal(await reload, 'new one')
    h.invoke.clearInvokeCache()
    const next = h.invoke.cachedInvoke('second', undefined, { key: 'shared' })
    await flush()
    assert.equal(h.calls.length, 4)
    h.calls[3].resolve('new two')
    await next
})

test('group names and keys containing separators cannot collide', async () => {
    const cache = harness().query.createQueryCache()
    assert.equal(
        await cache.run('a:b', 'c', () => Promise.resolve('one')),
        'one',
    )
    assert.equal(
        await cache.run('a', 'b:c', () => Promise.resolve('two')),
        'two',
    )
    cache.clear('a')
    assert.equal(
        await cache.run('a:b', 'c', () =>
            assert.fail('other group must be retained'),
        ),
        'one',
    )
})

test('zero TTL shares only in-flight work and explicitly bypasses an existing result', async () => {
    const cache = harness().query.createQueryCache()
    await cache.run('g', 'key', () => Promise.resolve('cached'))
    const pending = deferred()
    const first = cache.run('g', 'key', () => pending.promise, { ttlMs: 0 })
    assert.equal(
        cache.run('g', 'key', () => assert.fail('request should be shared'), {
            ttlMs: 0,
        }),
        first,
    )
    pending.resolve('uncached')
    assert.equal(await first, 'uncached')
    assert.equal(
        await cache.run('g', 'key', () => Promise.resolve('next'), {
            ttlMs: 0,
        }),
        'next',
    )
})

test('falsy values are valid successful results; invalid policies fail before loading', async () => {
    const h = harness()
    const cache = h.query.createQueryCache()
    for (const value of ['', 0, false, null, undefined]) {
        const key = `${typeof value}:${value}`
        assert.equal(
            await cache.run('g', key, () => Promise.resolve(value)),
            value,
        )
        assert.equal(
            await cache.run('g', key, () =>
                assert.fail('falsy result must be cached'),
            ),
            value,
        )
    }
    assert.throws(() => h.query.createQueryCache({ maxEntries: 0 }), /正整数/)
    assert.throws(() => h.query.createQueryCache({ ttlMs: NaN }), /非负有限/)
    assert.throws(
        () =>
            cache.run('g', 'bad', () => assert.fail('must not load'), {
                ttlMs: -1,
            }),
        /非负有限/,
    )
})

for (const native of [false, true]) {
    const transport = native ? 'Tauri IPC' : 'Web HTTP'
    test(`${transport}: cover calls share requests, expire, and retry after failure`, async () => {
        const h = harness(native)
        const first = h.api.fetchCover('kuwo', 123)
        assert.equal(h.api.fetchCover('kuwo', 123), first)
        await flush()
        assert.equal(h.calls.length, 1)
        assert.equal(
            h.calls[0].target,
            native ? 'fetch_cover' : '/api/music/cover',
        )
        assert.deepEqual(h.calls[0].args, { platform: 'kuwo', songId: 123 })
        h.calls[0].resolve('https://example.org/first.jpg')
        await first
        h.setNow(299999)
        assert.equal(h.api.fetchCover('kuwo', 123), first)
        h.setNow(300000)
        const expired = h.api.fetchCover('kuwo', 123)
        await flush()
        assert.equal(h.calls.length, 2)
        h.calls[1].reject(new Error('cover unavailable'))
        await assert.rejects(expired, /cover unavailable/)
        const retry = h.api.fetchCover('kuwo', 123)
        await flush()
        assert.equal(h.calls.length, 3)
        h.calls[2].resolve('https://example.org/fresh.jpg')
        assert.equal(await retry, 'https://example.org/fresh.jpg')
    })

    test(`${transport}: platform and song IDs stay separate and shared clearing invalidates covers`, async () => {
        const h = harness(native)
        const requests = [
            h.api.fetchCover('kuwo', 1),
            h.api.fetchCover('kuwo', 2),
            h.api.fetchCover('netease', 1),
        ]
        await flush()
        assert.equal(h.calls.length, 3)
        h.calls.forEach((call, index) => call.resolve(`cover-${index}`))
        assert.deepEqual(await Promise.all(requests), [
            'cover-0',
            'cover-1',
            'cover-2',
        ])
        h.query.clearQueryCacheByGroup('fetch_cover')
        const reload = h.api.fetchCover('kuwo', 1)
        await flush()
        assert.equal(h.calls.length, 4)
        h.calls[3].resolve('new cover')
        assert.equal(await reload, 'new cover')
    })

    test(`${transport}: searches and logout continue to bypass the query cache`, async () => {
        const h = harness(native)
        const searches = [
            h.api.searchSongs('kuwo', 'term'),
            h.api.searchSongs('kuwo', 'term'),
        ]
        assert.equal(h.calls.length, 2)
        h.calls[0].resolve({ songs: [], has_more: false })
        h.calls[1].resolve({ songs: [], has_more: false })
        await Promise.all(searches)
        const logout = [h.api.logout('qqmusic'), h.api.logout('qqmusic')]
        assert.equal(h.calls.length, 4)
        h.calls[2].resolve(undefined)
        h.calls[3].resolve(undefined)
        await Promise.all(logout)
    })
}
