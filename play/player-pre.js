'use strict';
define(function (require) {
  let system = require('play/system')

  // Session-lifetime registry of per-player "pre-fx" tap nodes, keyed by lowercase id.
  // A player's per-event dry voice (the node it hands to fxMixChain, or a bus's _input) is
  // fanned out into registry[id], which therefore sums the whole player's pre-fx output.
  // Created lazily on first reference and never destroyed, so untapped players cost nothing
  // and the tap survives player redefinition / forward references (q.pre before p exists).
  let registry = {}

  let getOrCreate = (id) => {
    if (!id) { return undefined }
    id = id.toLowerCase()
    if (!registry[id]) { registry[id] = system.audio.createGain() }
    return registry[id]
  }
  let get = (id) => { // Producer side: undefined unless some consumer referenced this id
    if (!id) { return undefined }
    return registry[id.toLowerCase()]
  }

  // Consumer side. Each consumer gets its own isolation gain fed from the shared registry
  // node R, because the consumer's destructor no-arg-disconnects whatever node we hand it
  // (play/eval-audio-params.js) and a no-arg disconnect on R would sever every other
  // consumer. The isolation gains are pooled GainNodes, so a shim removes the R->Ci inbound
  // edge on teardown *before* Ci is disconnected/released (no phantom inbound edge on reuse).
  let consumerTaps = new WeakMap() // destructor -> { [id]: isolationGain }
  let getConsumerTap = (id, destructor) => {
    let R = getOrCreate(id)
    if (!destructor) { return R } // No lifecycle context (visuals/tests/arithmetic): hand back R
    id = id.toLowerCase()
    let byId = consumerTaps.get(destructor)
    if (!byId) { byId = {}; consumerTaps.set(destructor, byId) }
    if (byId[id]) { return byId[id] }
    let Ci = system.audio.createGain()
    R.connect(Ci)
    // Registered before the consumer registers Ci itself, so destroy (which runs in
    // registration order) removes R->Ci first. try/catch: destructor.destroy() has no guard,
    // and a stale-edge throw would abort the remaining disconnects.
    destructor.disconnect({ disconnect: () => { try { R.disconnect(Ci) } catch (e) {} } })
    byId[id] = Ci
    return Ci
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
    }

    registry = {}
    assert(undefined, get('p1')) // Untapped: nothing
    let R = getOrCreate('p1')
    assert(true, R instanceof AudioNode)
    assert(R, getOrCreate('P1')) // Idempotent + case insensitive
    assert(R, get('p1'))

    assert(R, getConsumerTap('p1', undefined)) // No destructor: registry node itself

    let registered = []
    let fakeDestructor = { disconnect: (n) => registered.push(n) }
    let ci = getConsumerTap('p1', fakeDestructor)
    assert(true, ci instanceof AudioNode)
    assert(true, ci !== R) // Isolation gain, not R
    assert(1, registered.length) // One shim registered for the new tap
    assert(true, typeof registered[0].disconnect === 'function') // Shim is disconnect-able
    assert(ci, getConsumerTap('p1', fakeDestructor)) // Cached per (destructor, id)
    assert(1, registered.length) // Cache hit: no extra shim
    let cj = getConsumerTap('p2', fakeDestructor)
    assert(true, cj !== ci) // Distinct id -> distinct tap, same destructor
    assert(2, registered.length) // Second shim for p2

    registry = {}
    console.log('player-pre tests complete')
  }

  return { getOrCreate, get, getConsumerTap }
})
