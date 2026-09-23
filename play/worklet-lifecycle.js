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
  // 1. The node-side shim (below): start()/stop() and the voice count.
  // 2. The processor-side guard at the top of process(). It lives inside each processor's source
  //    template literal, which runs in the worklet scope and is read verbatim by the Node test
  //    harness (worklet-dsp skill), so it cannot be interpolated from here. It is repeated in the
  //    three sources and must read:
  //
  //      if (parameters.stop[0] > 0.5) { this.port.postMessage('terminated'); return false }
  //      if (!this.started) { ...latch on the LAST start sample, else budget/terminate... }
  //
  //    stop is tested BEFORE start: a node stopped before it ever starts (eg a synth body that
  //    throws between construction and start()) would otherwise render forever. The unstarted
  //    budget is the backstop for a node that is never stopped either.
  //
  //    start is LATCHED and read at the last sample of the block: it is a-rate, so a gate written
  //    part way through a block leaves sample 0 low. With gate() below, this makes a start time in
  //    the past behave like a native node's.
  const UNSTARTED_LIMIT_SECONDS = 60

  // Give a worklet node OscillatorNode-like start(time)/stop(time), gating its start/stop params,
  // and count it as a live voice for system.voiceCount() from construction, so an unstarted node
  // still shows up.
  //
  // The count comes down when the processor posts 'terminated', not on stop(): stop() only writes
  // a param, which the render thread may not read for a quantum, or ever if the context is
  // suspended. Counting on stop() would hide nodes still on the audio thread.
  //
  // addEventListener rather than port.onmessage, so later code assigning onmessage cannot unhook
  // the count; it needs the explicit port.start().
  let workletLifecycle = (node, audio = system.audio) => {
    system.voiceStarted()
    let counted = true
    let onMessage = (e) => {
      if (e.data !== 'terminated') { return }
      if (counted) { counted = false; system.voiceStopped() }
      // Release the port, or the node never leaves the render graph: a started MessagePort with a
      // live listener keeps itself alive and pins its AudioWorkletNode, which Chromium keeps walking
      // every render quantum after process() returns false - a permanent per-note render cost.
      node.port.removeEventListener('message', onMessage)
      node.port.close() // postMessage to a closed port is a silent no-op, so a late setWave is safe
    }
    node.port.addEventListener('message', onMessage)
    node.port.start()
    // A time at or before currentTime means "now", as for a native source node's start(when). A
    // worklet gate has no such guarantee: setValueAtTime at a time the render thread has passed
    // varies between Chromium and Gecko, and live players (keyboard, midi) always schedule slightly
    // in the past, so a note could silently never start. Writing .value sets the intrinsic value,
    // which an unautomated block reads, so there is nothing to miss.
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
