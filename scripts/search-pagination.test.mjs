import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const root = path.resolve(import.meta.dirname, '..')
const definitions = [
    {
        type: 'Song',
        search: 'searchSongs',
        more: 'loadMoreSongs',
        items: 'searchResults',
        field: 'songs',
        command: 'search_songs',
        route: 'songs/search',
    },
    {
        type: 'Playlist',
        search: 'searchPlaylists',
        more: 'loadMorePlaylists',
        items: 'playlists',
        field: 'playlists',
        command: 'search_playlists',
        route: 'playlists/search',
    },
    {
        type: 'Album',
        search: 'search',
        more: 'loadMore',
        items: 'albums',
        field: 'albums',
        command: 'search_albums',
        route: 'albums/search',
    },
    {
        type: 'Artist',
        search: 'search',
        more: 'loadMore',
        items: 'artists',
        field: 'artists',
        command: 'search_artists',
        route: 'artists/search',
    },
]
const item = (id) => ({ id, mid: id, title: id, name: id })
const plain = (value) => JSON.parse(JSON.stringify(value))

function harness(definition, native) {
    const requests = []
    const modules = new Map()
    const route = vue.reactive({
        path: '/playlist',
        fullPath: '/playlist',
        query: {},
    })
    function request(target, args) {
        let resolve, reject
        const promise = new Promise((a, b) => {
            resolve = a
            reject = b
        })
        requests.push({ target, args: plain(args), resolve, reject })
        return promise
    }
    function load(file) {
        const absolute = path.resolve(root, file)
        if (modules.has(absolute)) return modules.get(absolute)
        const exports = {}
        modules.set(absolute, exports)
        const contents = readFileSync(absolute, 'utf8')
        const source = absolute.endsWith('.vue')
            ? contents.match(
                  /<script setup lang="ts">([\s\S]*?)<\/script>/,
              )[1] + '\nexports.view = { routeError, songs, loading };'
            : contents
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
            },
        })
        vm.runInNewContext(outputText, {
            exports,
            Error,
            require(name) {
                if (name === 'vue') return vue
                if (name === 'vue-router')
                    return {
                        useRoute: () => route,
                        useRouter: () => ({ push() {}, replace() {} }),
                    }
                if (name.endsWith('/runtimeApi'))
                    return { isNativeRuntime: () => native }
                if (name.endsWith('/useMusicNavigation'))
                    return { useMusicNavigation: () => ({}) }
                if (name.endsWith('/useDownloadActions'))
                    return { useDownloadActions: () => ({}) }
                if (name.endsWith('.vue')) return {}
                if (name === '@tauri-apps/api/core')
                    return {
                        isTauri: () => native,
                        invoke: async (command, args) =>
                            JSON.stringify(await request(command, args)),
                    }
                if (name === './webClient')
                    return {
                        webRequest: (url, options) =>
                            request(url, JSON.parse(options.body)),
                    }
                if (name === './cachedInvoke')
                    return {
                        cachedInvoke: () =>
                            assert.fail('search must not use the call cache'),
                    }
                assert.ok(name.startsWith('.'), `unexpected import: ${name}`)
                return load(path.resolve(path.dirname(absolute), `${name}.ts`))
            },
        })
        return exports
    }
    const api = load('src/api/musicApi.ts')
    const scope = vue.effectScope()
    const factory = `use${definition.type}Search`
    const state = scope.run(() =>
        load(`src/composables/${factory}.ts`)[factory](),
    )
    return {
        state,
        requests,
        scope,
        api,
        route,
        openPlaylistView(query) {
            route.query = query
            route.fullPath = '/playlist?' + new URLSearchParams(query)
            return scope.run(() => load('src/views/PlaylistView.vue').view)
        },
        search: state[definition.search],
        more: state[definition.more],
        items: state[definition.items],
        resolve(index, ids, hasMore = false) {
            requests[index].resolve({
                [definition.field]: ids.map(item),
                has_more: hasMore,
            })
        },
    }
}

for (const native of [false, true]) {
    const transport = native ? 'Tauri IPC' : 'Web HTTP'
    for (const definition of definitions) {
        const name = `${transport} ${definition.type}`
        test(`${name}: old searches and errors cannot override a newer platform`, async (t) => {
            for (const staleError of [false, true]) {
                const h = harness(definition, native)
                t.after(() => h.scope.stop())
                const a = h.search('qqmusic', 'old')
                const b = h.search('kugou', ' latest ')
                assert.equal(
                    h.requests[1].target,
                    native
                        ? definition.command
                        : `/api/music/${definition.route}`,
                )
                assert.deepEqual(h.requests[1].args, {
                    platform: 'kugou',
                    keyword: 'latest',
                    page: 1,
                    limit: 20,
                })
                h.resolve(1, ['new'])
                await b
                if (staleError) h.requests[0].reject(new Error('late failure'))
                else h.resolve(0, ['old'], true)
                await a
                assert.deepEqual(
                    Array.from(h.items.value, (row) => row.id),
                    ['new'],
                )
                assert.equal(h.state.error.value, '')
                assert.equal(h.state.loading.value, false)
                assert.equal(h.state.hasMore.value, false)
            }
        })

        test(`${name}: old pagination is isolated and simultaneous load-more requests are deduplicated`, async (t) => {
            const h = harness(definition, native)
            t.after(() => h.scope.stop())
            const first = h.search('qqmusic', 'first')
            h.resolve(0, ['a', 'a', 'b'], true)
            await first
            assert.deepEqual(
                Array.from(h.items.value, (row) => row.id),
                ['a', 'b'],
            )
            const more = h.more()
            await h.more()
            assert.equal(h.requests.length, 2)
            assert.deepEqual(h.requests[1].args, {
                platform: 'qqmusic',
                keyword: 'first',
                page: 2,
                limit: 20,
            })
            h.state.reset()
            const newer = h.search('netease', 'second')
            h.resolve(2, ['new'])
            await newer
            h.resolve(1, ['stale'], true)
            await more
            assert.deepEqual(
                Array.from(h.items.value, (row) => row.id),
                ['new'],
            )
            assert.equal(h.state.currentPage.value, 1)
            assert.equal(h.state.loadingMore.value, false)
        })

        test(`${name}: initial and pagination failures retry the same page and preserve loaded results`, async (t) => {
            const h = harness(definition, native)
            t.after(() => h.scope.stop())
            const first = h.search('kugou', 'keyword')
            h.requests[0].reject(new Error('first page failed'))
            await first
            assert.equal(h.state.error.value, 'first page failed')
            assert.equal(h.state.currentPage.value, 0)
            const retry = h.state.retry()
            h.resolve(1, ['a', 'b'], true)
            await retry
            if (h.state.selectedIds) h.state.selectedIds.value = ['a']
            const more = h.more()
            h.requests[2].reject('page two failed')
            await more
            assert.equal(h.state.error.value, 'page two failed')
            assert.deepEqual(
                Array.from(h.items.value, (row) => row.id),
                ['a', 'b'],
            )
            assert.equal(h.state.currentPage.value, 1)
            const retryMore = h.state.retry()
            assert.deepEqual(h.requests[3].args, h.requests[2].args)
            h.resolve(3, ['b', 'c', 'c'])
            await retryMore
            assert.deepEqual(
                Array.from(h.items.value, (row) => row.id),
                ['a', 'b', 'c'],
            )
            assert.equal(h.state.currentPage.value, 2)
            assert.equal(h.state.error.value, '')
            if (h.state.selectedIds) {
                assert.deepEqual(plain(h.state.selectedIds.value), ['a'])
                const next = h.search('kugou', 'another')
                assert.equal(h.state.selectedIds.value.length, 0)
                h.resolve(4, [])
                await next
            }
        })

        test(`${name}: reset, blank searches and scope disposal invalidate pending responses`, async () => {
            const h = harness(definition, native)
            const first = h.search('qqmusic', 'old')
            await h.search('qqmusic', '   ')
            h.resolve(0, ['old'])
            await first
            assert.equal(h.items.value.length, 0)
            assert.equal(h.state.hasSearched.value, false)
            const next = h.search('kugou', 'next')
            h.scope.stop()
            h.resolve(1, ['late'])
            await next
            assert.equal(h.items.value.length, 0)
            assert.equal(h.state.loading.value, false)
        })
    }

    test(`${transport}: personal Kugou playlists and details use the existing credential-free frontend contract`, async (t) => {
        const h = harness(definitions[0], native)
        t.after(() => h.scope.stop())
        const collection = 'collection_3_123_1_0'
        const lists = h.api.fetchCreatedPlaylists('kugou')
        assert.equal(
            h.requests[0].target,
            native ? 'fetch_created_playlists' : '/api/music/playlists/created',
        )
        assert.deepEqual(h.requests[0].args, { platform: 'kugou' })
        h.requests[0].resolve({ playlists: [{ id: collection }] })
        assert.equal((await lists).playlists[0].platform, 'kugou')
        const detail = h.api.fetchCreatedPlaylistSongs(collection, '0', 'kugou')
        assert.equal(
            h.requests[1].target,
            native
                ? 'fetch_created_playlist_songs'
                : '/api/music/playlists/created/fetch',
        )
        assert.deepEqual(h.requests[1].args, {
            platform: 'kugou',
            id: collection,
            dirid: '0',
        })
        h.requests[1].resolve({
            playlist: { id: collection },
            songs: [item('song')],
        })
        assert.equal((await detail).songs[0].platform, 'kugou')
    })

    test(`${transport}: personal Kugou collection IDs reach the detail loader and invalid IDs stay local`, async (t) => {
        const h = harness(definitions[0], native)
        t.after(() => h.scope.stop())
        const collection = 'collection_3_123_1_0'
        const view = h.openPlaylistView({
            platform: 'kugou',
            id: collection,
            dirid: '0',
            source: 'mine',
        })
        assert.equal(h.requests.length, 1)
        assert.equal(view.routeError.value, '')
        h.requests[0].resolve({
            playlist: { id: collection, name: '我的酷狗歌单' },
            songs: [item('song')],
        })
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(view.songs.value[0].platform, 'kugou')
        h.route.query = {
            platform: 'kugou',
            id: '123',
            dirid: '0',
            source: 'mine',
        }
        h.route.fullPath = '/playlist?platform=kugou&id=123&dirid=0&source=mine'
        await vue.nextTick()
        assert.match(view.routeError.value, /个人歌单地址无效/)
        assert.equal(h.requests.length, 1)
        assert.equal(view.songs.value.length, 0)
    })
}
