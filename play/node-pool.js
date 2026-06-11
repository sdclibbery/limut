'use strict';
define(function (require) {

  let disabled = (new URLSearchParams(window.location.search)).get('nopool') !== null

  let makePool = () => {
    let stats = { created:0, reused:0, released:0, droppedFull:0 }
    let pool = {
      cap: 512,
      enabled: !disabled,
      nodes: [],
    }
    pool.install = (audioCtx) => {
      if (!pool.enabled) { return }
      pool.ctx = audioCtx
      let createGain = audioCtx.createGain.bind(audioCtx)
      audioCtx.createGain = () => {
        let n = pool.nodes.pop()
        if (n !== undefined) { stats.reused++ }
        else {
          n = createGain()
          stats.created++
        }
        n.__pooled = false
        n.__gen = (n.__gen || 0) + 1 // Generation tag: lets destructors detect a node they registered has since been released and reused elsewhere
        return n
      }
    }
    pool.release = (n) => {
      if (!pool.enabled) { return }
      if (!(n instanceof GainNode)) { return } // Only gains are poolable; sources are single use, filters carry audible internal state
      if (n.context !== pool.ctx) { return }
      if (n.__pooled) { return }
      n.gain.cancelScheduledValues(0)
      n.gain.value = 1
      delete n.gain.lastTime // Stashed by doPerFrame in eval-audio-params; stale values cause a catch-up scheduling loop
      n.channelCount = 2
      n.channelCountMode = 'max'
      n.channelInterpretation = 'speakers'
      n.__pooled = true
      stats.released++
      if (pool.nodes.length < pool.cap) { pool.nodes.push(n) }
      else { stats.droppedFull++ }
    }
    pool.stats = () => {
      return { created:stats.created, reused:stats.reused, released:stats.released, droppedFull:stats.droppedFull, poolSize:pool.nodes.length }
    }
    return pool
  }

  let main = makePool()
  window.limutNodePool = main

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let ctx = new (window.AudioContext || window.webkitAudioContext)()
  let p = makePool()
  p.enabled = true
  p.install(ctx)

  let g = ctx.createGain()
  assert(false, g.__pooled)
  assert(1, g.__gen)
  assert(1, p.stats().created)

  g.gain.value = 0.5
  g.gain.lastTime = 123
  g.channelCount = 1
  g.channelCountMode = 'explicit'
  p.release(g)
  assert(true, g.__pooled)
  assert(1, p.stats().poolSize)
  assert(1, p.stats().released)

  p.release(g) // Double release is ignored
  assert(1, p.stats().poolSize)
  assert(1, p.stats().released)

  let g2 = ctx.createGain() // Round trip: same node comes back, fully reset
  assert(true, g === g2)
  assert(2, g2.__gen)
  assert(false, g2.__pooled)
  assert(1, g2.gain.value)
  assert(undefined, g2.gain.lastTime)
  assert(2, g2.channelCount)
  assert('max', g2.channelCountMode)
  assert(0, p.stats().poolSize)
  assert(1, p.stats().reused)

  p.release(ctx.createBiquadFilter()) // Non-poolable types are ignored
  p.release({})
  p.release(undefined)
  assert(0, p.stats().poolSize)

  p.cap = 1 // Cap respected; overflow dropped
  let g3 = ctx.createGain() // Acquire before releasing: the patched factory would otherwise pop g2 straight back out
  p.release(g2)
  p.release(g3)
  assert(1, p.stats().poolSize)
  assert(1, p.stats().droppedFull)

  ctx.close()
  console.log('Node pool tests complete')
  }

  return {
    makePool: makePool,
    main: main,
  }
})
