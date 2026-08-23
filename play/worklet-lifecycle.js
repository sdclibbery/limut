'use strict';
define(function (require) {
  let system = require('play/system')

  // Shared start/stop lifecycle for limut's AudioWorklet oscillators (superosc,
  // chaos, pwm). They are not native source nodes: start()/stop() are not real
  // methods, they just gate a pair of AudioParams that the processor reads. The
  // node only dies when the render thread runs process() again and sees the stop
  // param, so an unstopped worklet renders forever and is never collected.
  //
  // Two halves, and only one of them can live here:
  //
  // 1. The node-side shim (below) - start()/stop() methods plus the voice count.
  //    Genuinely shared, so it is defined once.
  // 2. The processor-side guard at the top of process(). That code lives inside
  //    each processor's source template literal, which is evaluated in the worklet
  //    global scope and is also read verbatim by the Node test harness (see the
  //    worklet-dsp skill), so it must stay self-contained - no interpolation from
  //    here. It is therefore repeated in the three sources, and must read:
  //
  //      if (parameters.stop[0] > 0.5) { return false }
  //      if (parameters.start[0] < 0.5) { this.unstartedSamples = ... }
  //
  //    stop is tested BEFORE start on purpose. A node that is stopped before it is
  //    ever started - eg a synth body that throws between construction and
  //    start(), with the player error swallowed by main.js - would otherwise sit in
  //    the unstarted branch and render forever (measured Aug 2026: 20/20 survival,
  //    permanently). The unstarted-sample budget is the backstop for a node that is
  //    never stopped either.
  const UNSTARTED_LIMIT_SECONDS = 60

  // Wrap a freshly constructed worklet node with the OscillatorNode-alike
  // start(time)/stop(time) methods that gate its start/stop params, and count it
  // as a live voice for system.voiceCount(). Counting from construction (not from
  // start()) is deliberate: an unstopped worklet is the expensive thing, so it
  // should be visible in the count even if it never starts.
  let workletLifecycle = (node, audio = system.audio) => {
    system.voiceStarted()
    let stopped = false
    node.start = (time = audio.currentTime) => {
      node.parameters.get('start').setValueAtTime(1, time)
    }
    node.stop = (time = audio.currentTime) => {
      node.parameters.get('stop').setValueAtTime(1, time)
      if (!stopped) { stopped = true; system.voiceStopped() }
    }
    return node
  }

  workletLifecycle.UNSTARTED_LIMIT_SECONDS = UNSTARTED_LIMIT_SECONDS

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }
    let fakeNode = () => {
      let writes = []
      return {
        writes,
        parameters: { get: (name) => ({ setValueAtTime: (v,t) => writes.push([name,v,t]) }) },
      }
    }
    let fakeAudio = { currentTime: 7 }

    let baseVoices = system.voiceCount()
    let n = workletLifecycle(fakeNode(), fakeAudio)
    assert(baseVoices+1, system.voiceCount(), 'voice counted from construction, not from start')
    n.start(3)
    assert('start,1,3', n.writes[0].join(','), 'start gates the start param at the given time')
    n.start()
    assert('start,1,7', n.writes[1].join(','), 'start defaults to now')
    n.stop(5)
    assert('stop,1,5', n.writes[2].join(','), 'stop gates the stop param at the given time')
    assert(baseVoices, system.voiceCount(), 'stop decrements the voice count')
    n.stop() // A node can be stopped twice (eg destructor after an explicit stop)
    assert(baseVoices, system.voiceCount(), 'a second stop does not double-decrement')

    // A node that is never started still counts, and is still stoppable: the processor
    // guard tests stop before start so it terminates rather than rendering forever.
    let unstarted = workletLifecycle(fakeNode(), fakeAudio)
    assert(baseVoices+1, system.voiceCount(), 'unstarted node is counted')
    unstarted.stop()
    assert(baseVoices, system.voiceCount(), 'unstarted node can be stopped')

    console.log('Worklet lifecycle tests complete')
  }

  return workletLifecycle
})
