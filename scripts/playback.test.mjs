import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import * as pinia from 'pinia'

const source = readFileSync(
    new URL('../src/stores/playerStore.ts', import.meta.url),
    'utf8',
)
const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
    },
})
const song = (mid, platform = 'qqmusic') => ({
    platform,
    mid,
    id: 1,
    title: mid,
    artist: '测试歌手',
    album: '',
    coverUrl: '',
    mediaMid: mid,
    qualities: [],
})
const link = (mid) => ({
    id: `session-${mid}`,
    url: `/api/playback/session-${mid}`,
    quality: '128kmp3',
    contentType: 'audio/mpeg',
})
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}

function harness(resolve = async (song) => link(song.mid)) {
    const elements = [],
        released = [],
        calls = [],
        failures = []
    class Audio extends EventTarget {
        constructor(src) {
            super()
            Object.assign(this, {
                src,
                paused: true,
                ended: false,
                duration: 120,
                currentTime: 0,
                volume: 1,
            })
            elements.push(this)
        }
        async play() {
            if (failures.length) throw failures.shift()
            this.paused = false
            this.ended = false
            this.dispatchEvent(new Event('playing'))
        }
        pause() {
            this.paused = true
            this.dispatchEvent(new Event('pause'))
        }
        removeAttribute(name) {
            if (name === 'src') this.src = ''
        }
        load() {}
    }
    const exports = {}
    vm.runInNewContext(outputText, {
        exports,
        Audio,
        Error,
        require(name) {
            if (name === 'vue') return vue
            if (name === 'pinia') return pinia
            assert.equal(name, '../api/playbackApi')
            return {
                resolvePlayback: (song) => {
                    calls.push(song)
                    return resolve(song)
                },
                releasePlayback: async (source) => {
                    released.push(source.id)
                },
            }
        },
    })
    const store = exports.usePlayerStore(pinia.createPinia())
    return { store, elements, released, calls, failures }
}

test('one shared player pauses, resumes, replaces tracks and releases the old stream', async () => {
    const h = harness()
    await h.store.play(song('a'))
    assert.equal(h.store.status, 'playing')
    await h.store.play(song('a'))
    assert.equal(h.store.status, 'paused')
    await h.store.toggle()
    assert.equal(h.store.status, 'playing')
    assert.equal(h.calls.length, 1)
    await h.store.play(song('b'))
    assert.equal(h.elements[0].src, '')
    assert.equal(h.elements[0].paused, true)
    assert.deepEqual(h.released, ['session-a'])
    h.elements[0].dispatchEvent(new Event('error'))
    assert.equal(h.store.status, 'playing')
    h.store.$dispose()
    assert.equal(h.elements[1].src, '')
    assert.deepEqual(h.released, ['session-a', 'session-b'])
})

test('late responses cannot replace a newer selection or restart a closed player', async () => {
    const a = deferred(),
        b = deferred(),
        c = deferred()
    const h = harness((song) => ({ a, b, c })[song.mid].promise)
    const pa = h.store.play(song('a'))
    const pb = h.store.play(song('b'))
    b.resolve(link('b'))
    await pb
    a.resolve(link('a'))
    await pa
    assert.equal(h.store.song.mid, 'b')
    assert.equal(h.elements.length, 1)
    assert.deepEqual(h.released, ['session-a'])
    const pc = h.store.play(song('c'))
    h.store.stop()
    c.resolve(link('c'))
    await pc
    assert.equal(h.store.song, null)
    assert.equal(h.store.status, 'idle')
    assert.equal(h.elements.length, 1)
    assert.deepEqual(h.released, ['session-a', 'session-b', 'session-c'])
    h.store.$dispose()
})

test('browser autoplay rejection leaves a resumable track and controls clamp their values', async () => {
    const h = harness()
    h.failures.push({ name: 'NotAllowedError' })
    await h.store.play(song('a'))
    assert.equal(h.store.status, 'paused')
    assert.match(h.store.error, /点击播放/)
    await h.store.toggle()
    assert.equal(h.store.status, 'playing')
    assert.equal(h.calls.length, 1)
    h.elements[0].dispatchEvent(new Event('durationchange'))
    h.store.seek(999)
    assert.equal(h.elements[0].currentTime, 120)
    h.store.seek(-10)
    assert.equal(h.store.currentTime, 0)
    h.store.setVolume(2)
    assert.equal(h.elements[0].volume, 1)
    h.store.setVolume(0)
    assert.equal(h.elements[0].volume, 0)
    h.store.$dispose()
})

test('link errors and expired streams can be retried without stale events taking over', async () => {
    let calls = 0
    const h = harness(async () => {
        if (++calls === 1) throw new Error('音源不可用')
        return link(`a-${calls}`)
    })
    await h.store.play(song('a'))
    assert.equal(h.store.status, 'error')
    assert.match(h.store.error, /音源不可用/)
    await h.store.toggle()
    assert.equal(h.store.status, 'playing')
    h.elements[0].dispatchEvent(new Event('error'))
    assert.equal(h.store.status, 'error')
    await h.store.toggle()
    assert.equal(h.store.status, 'playing')
    assert.equal(calls, 3)
    assert.deepEqual(h.released, ['session-a-2'])
    h.store.$dispose()
})

test('song identity includes its platform and disposing cancels pending playback', async () => {
    const pending = deferred()
    let calls = 0
    const h = harness(async (song) =>
        ++calls < 3 ? link(`${song.platform}-${song.mid}`) : pending.promise,
    )
    await h.store.play(song('123', 'qqmusic'))
    await h.store.play(song('123', 'kuwo'))
    assert.equal(h.elements.length, 2)
    const result = h.store.play(song('456'))
    h.store.$dispose()
    pending.resolve(link('456'))
    await result
    assert.equal(h.elements.length, 2)
    assert.equal(h.store.song, null)
    assert.ok(h.released.includes('session-456'))
})
