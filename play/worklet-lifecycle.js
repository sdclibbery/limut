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
  //      if (parameters.stop[0] > 0.5) { this.port.postMessage('terminated'); return false }
  //      if (!this.started) { ...latch on the LAST start sample, else budget/terminate... }
  //
  //    stop is tested BEFORE start on purpose. A node that is stopped before it is
  //    ever started - eg a synth body that throws between construction and
  //    start(), with the player error swallowed by main.js - would otherwise sit in
  //    the unstarted branch and render forever (measured Aug 2026: 20/20 survival,
  //    permanently). The unstarted-sample budget is the backstop for a node that is
  //    never stopped either.
  //
  //    start is LATCHED, and read at the last sample of the block rather than the
  //    first: it is an a-rate param, so a gate written part way through a block leaves
  //    sample 0 low, and once latched the node keeps rendering even if the param is
  //    later re-read as low. Together with the value-gating in gate() below, that is
  //    what makes a start time in the past behave like a native node's.
  const UNSTARTED_LIMIT_SECONDS = 60

  // Wrap a freshly constructed worklet node with the OscillatorNode-alike
  // start(time)/stop(time) methods that gate its start/stop params, and count it
  // as a live voice for system.voiceCount(). Counting from construction (not from
  // start()) is deliberate: an unstopped worklet is the expensive thing, so it
  // should be visible in the count even if it never starts.
  //
  // The count comes down when the PROCESSOR says it is done - it posts 'terminated'
  // from process() immediately before returning false - and not when stop() is
  // called. stop() only writes an AudioParam: the render thread may not read it for
  // another quantum, a node stopped while the context is suspended never terminates
  // at all, and (before the guard fix above) a stopped-but-never-started node kept
  // rendering forever. Decrementing in stop() made all of those read as free while
  // they were still on the audio thread, which is exactly the thing this count
  // exists to catch. The tradeoff is that the readout lags real termination by a
  // render quantum plus the port hop, which for a voice count is nothing.
  //
  // The listener goes on with addEventListener rather than port.onmessage so that
  // any later main-thread code that wants to talk to the processor (assigning
  // node.port.onmessage) cannot silently unhook the voice count; addEventListener
  // needs the explicit port.start().
  let workletLifecycle = (node, audio = system.audio) => {
    system.voiceStarted()
    let counted = true
    let onMessage = (e) => {
      if (e.data !== 'terminated') { return }
      if (counted) { counted = false; system.voiceStopped() }
      // Release the port, or the node never leaves the render graph. A started
      // MessagePort with a live message listener keeps itself alive, and it owns -
      // and therefore pins - the AudioWorkletNode. A pinned AudioWorkletNode stays
      // in Chromium's audio graph and is walked every render quantum even though its
      // processor returned false, so each note costs a small permanent slice of the
      // render budget. Measured Aug 2026 (CDP WebAudio node census, `p1 superosc 0.,
      // dur=1/4` at bpm=500): live AudioWorkletNodes grew linearly at exactly the note
      // rate to 3998 in four minutes and never fell - not even after Ctrl-. - while
      // live GainNodes stayed flat at 17. Render capacity tracked it linearly, 0.18 ->
      // 0.76 over 13 minutes, and stayed there with zero voices sounding. The climb
      // rate was identical for unison=1 and unison=8, and for a 5KB and a 130KB
      // wavetable, ie it is a fixed per-node cost, not DSP and not the wavetable copy.
      node.port.removeEventListener('message', onMessage)
      node.port.close() // postMessage to a closed port is a silent no-op, so a late setWave is safe
    }
    node.port.addEventListener('message', onMessage)
    node.port.start()
    // A time at or before currentTime means "now", the way a native source node's
    // start(when)/stop(when) is defined ("if when is in the past, start as soon as
    // possible"). A worklet gate has no such guarantee: setValueAtTime(1, when) with
    // when inside a block the render thread has already passed is at the mercy of the
    // engine's AudioParam timeline, and Chromium and Gecko do not agree. That bit the
    // live players, whose _time is a frame stale and so always slightly in the past
    // (player/keyboard.js, player/midi.js): a keyboard note would be built, gate its
    // start param at a past time, never be seen to start, and render exact silence for
    // the unstarted budget - a whole missing voice, no error. Writing .value instead
    // sets the param's intrinsic value, which is what an unautomated block reads, so
    // there is nothing to miss.
    let gate = (name, time) => {
      let param = node.parameters.get(name)
      if (time <= audio.currentTime) { param.value = 1 } else { param.setValueAtTime(1, time) }
    }
    node.start = (time = audio.currentTime) => gate('start', time)
    node.stop = (time = audio.currentTime) => gate('stop', time)
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
      let listeners = []
      let n = {
        writes,
        closed: 0,
        // Send what the processor sends: the node only hears it via the port.
        fromProcessor: (data) => listeners.slice().forEach(l => l({data})),
        // Records both ways a gate can be written: a scheduled event, and the intrinsic
        // value (which is how a time in the past is gated - see the gate() comment above).
        parameters: { get: (name) => ({
          setValueAtTime: (v,t) => writes.push([name,v,t]),
          set value(v) { writes.push([name,v,'value']) },
        }) },
      }
      n.port = {
        addEventListener: (name,l) => listeners.push(l),
        removeEventListener: (name,l) => { let i = listeners.indexOf(l); if (i >= 0) { listeners.splice(i,1) } },
        start: () => {},
        close: () => n.closed++,
        listenerCount: () => listeners.length,
      }
      return n
    }
    let fakeAudio = { currentTime: 7 }

    let baseVoices = system.voiceCount()
    let n = workletLifecycle(fakeNode(), fakeAudio)
    assert(baseVoices+1, system.voiceCount(), 'voice counted from construction, not from start')
    n.start(9)
    assert('start,1,9', n.writes[0].join(','), 'a start in the future is scheduled at that time')
    // A time already gone by is gated on the intrinsic value, not scheduled: a past event is
    // not reliably honoured once the render thread has passed that block, which is what left
    // live (keyboard/midi) notes silent - their _time is always a frame or so behind.
    n.start(3)
    assert('start,1,value', n.writes[1].join(','), 'a start in the past gates the value directly')
    n.start()
    assert('start,1,value', n.writes[2].join(','), 'start defaults to now, ie the value')
    n.stop(5)
    assert('stop,1,value', n.writes[3].join(','), 'stop in the past gates the value directly')
    n.stop(9)
    assert('stop,1,9', n.writes[4].join(','), 'a stop in the future is scheduled at that time')
    assert(baseVoices+1, system.voiceCount(), 'stop alone does not decrement: the processor is still rendering')
    n.stop() // A node can be stopped twice (eg destructor after an explicit stop)
    n.fromProcessor('terminated')
    assert(baseVoices, system.voiceCount(), 'termination decrements the voice count')
    // The port must be released on termination: a started port with a live listener
    // pins the node in the render graph, where it costs a slice of every quantum.
    assert(1, n.closed, 'termination closes the port')
    assert(0, n.port.listenerCount(), 'termination removes the message listener')
    n.fromProcessor('terminated')
    assert(baseVoices, system.voiceCount(), 'a repeated termination message does not double-decrement')
    assert(1, n.closed, 'a repeated termination does not re-close the port')

    // A node that is never started still counts until it terminates: the processor
    // guard tests stop before start so it terminates rather than rendering forever.
    let unstarted = workletLifecycle(fakeNode(), fakeAudio)
    assert(baseVoices+1, system.voiceCount(), 'unstarted node is counted')
    unstarted.stop()
    assert(baseVoices+1, system.voiceCount(), 'unstarted node still counts until its processor terminates')
    unstarted.fromProcessor('terminated')
    assert(baseVoices, system.voiceCount(), 'unstarted node decrements on termination')

    // Other port traffic (superosc gets its wavetable this way) must not be
    // mistaken for a termination.
    let chatty = workletLifecycle(fakeNode(), fakeAudio)
    chatty.fromProcessor({ wave: null })
    assert(baseVoices+1, system.voiceCount(), 'a non-termination message leaves the count alone')
    chatty.fromProcessor('terminated')
    assert(baseVoices, system.voiceCount(), 'termination after other traffic still decrements')

    console.log('Worklet lifecycle tests complete')
  }

  return workletLifecycle
})
