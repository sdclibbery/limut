'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame,evalSubParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')

  // A "live" envelope (keyboard/gamepad/midi) has no note off time at note start, so it holds a
  // placeholder endTime and can only arm its destroy when the note is released. Every live voice is
  // registered here so it stays reachable even if it is never released: an input device that fails to
  // deliver its note off (window blur with a key held, a pad unplugged) would otherwise leave the
  // voice rendering, and costing audio thread time, for the life of the page.
  let liveVoices = new Set()

  let scheduleDestroy = (params) => {
    liveVoices.delete(params)
    setTimeout(() => params._destructor.destroy(), 100+((params._tail || 0) + params.endTime - system.audio.currentTime)*1000)
  }

  // Register a live voice and its release. The release only ever runs once: a second call would
  // re-ramp the gain from wherever the first release had got to (a click) and race its destroy timer
  let liveRelease = (params, onRelease) => {
    liveVoices.add(params)
    let released = false
    params._noteOff = () => {
      if (released) { return }
      released = true
      onRelease()
      scheduleDestroy(params)
    }
  }

  let releaseAllLive = () => {
    Array.from(liveVoices).forEach(params => params._noteOff()) // Each release removes itself from liveVoices
  }

  // Analogue style: segments fall evenly in dB. A ramp to 0 goes exponentially to floorDb below its
  // start, reaching it a few ms before the segment ends, then linearly to 0, since an exponential
  // ramp can never reach 0. The floor is relative to the note so the shape doesn't depend on its gain
  let fadeTail = 0.005
  let fadeOut = (param, from, time, duration, floorDb, tail) => {
    tail = Math.min(Math.max(tail || 0, fadeTail), duration/2)
    param.exponentialRampToValueAtTime(Math.max(from*Math.pow(10, -floorDb/20), 1e-9), time+duration-tail)
    param.linearRampToValueAtTime(0, time+duration)
  }
  let decayTo = (param, from, to, time, duration) => {
    if (to >= from/100) {
      param.exponentialRampToValueAtTime(to, time+duration)
    } else {
      param.exponentialRampToValueAtTime(from/100, time+duration-Math.min(fadeTail, duration/2))
      param.linearRampToValueAtTime(to, time+duration)
    }
  }
  // Linear amplitude decays used to reach -40dB at 99% of their time, so ending there keeps a note's length
  let adsrFloorDb = 40
  let expFloorDb = 60
  // Pluck: a slow decay cut off by a gate-style release, so most of the note stays loud
  let percFloorDb = 12
  let percRelease = 0.1

  let fullEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09, 'b') * params.beat.duration
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur, 'b') * params.beat.duration
    let sustain = evalMainParamEvent(params, 'sus', dur, 'b') * params.beat.duration - decay
    if (params._noteOff !== undefined) { sustain = undefined } // "live" envelope, use note off to determine when to release
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', 0.1*dur, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    decayTo(vca.gain, gain, gain*susLevel, params._time + attack, decay)
    if (sustain !== undefined) {
      vca.gain.linearRampToValueAtTime(gain*susLevel, params._time + attack+decay+sustain)
      fadeOut(vca.gain, gain*susLevel, params._time + attack+decay+sustain, release, adsrFloorDb)
      params.endTime = params._time + attack+decay+sustain+release
      scheduleDestroy(params)
    } else {
      params.endTime = params._time + 1e6
      liveRelease(params, () => {
        let releaseTime = Math.max(system.audio.currentTime, params._time + attack+decay+0.001)
        vca.gain.linearRampToValueAtTime(gain*susLevel, releaseTime)
        fadeOut(vca.gain, gain*susLevel, releaseTime, release, adsrFloorDb)
        params.endTime = releaseTime+release
      })
    }

    params._destructor.disconnect(vca)
    return vca
  }

  let organEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.01, 'b') * params.beat.duration
    let sustain = dur * params.beat.duration
    if (params._noteOff !== undefined) { sustain = undefined } // "live" envelope, use note off to determine when to release
    let release = evalMainParamEvent(params, 'rel', 0.1, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    if (sustain !== undefined) {
      vca.gain.linearRampToValueAtTime(gain, params._time + attack+sustain)
      fadeOut(vca.gain, gain, params._time + attack+sustain, release, expFloorDb)
      params._releaseTime = params._time + attack+sustain
      params.endTime = params._time + attack+sustain+release
      scheduleDestroy(params)
    } else {
      params.endTime = params._time + 1e6
      liveRelease(params, () => {
        let relTime = Math.max(system.audio.currentTime, params._time + attack + 0.001)
        vca.gain.setValueAtTime(gain, relTime)
        fadeOut(vca.gain, gain, relTime, release, expFloorDb)
        params._releaseTime = relTime
        params.endTime = relTime+release
      })
    }
    params._destructor.disconnect(vca)
    return vca
  }

  let simpleEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09, 'b') * params.beat.duration
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur, 'b') * params.beat.duration
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', dur, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    decayTo(vca.gain, gain, gain*susLevel, params._time + attack, decay)
    fadeOut(vca.gain, gain*susLevel, params._time + attack+decay, release, adsrFloorDb)
    params.endTime = params._time + attack+decay+release
    params._destructor.disconnect(vca)
    scheduleDestroy(params)
    return vca
  }

  let percussionEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let decay = evalMainParamEvent(params, 'dec', evalMainParamEvent(params, 'rel', dur, 'b'), 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(gain, params._time)
    fadeOut(vca.gain, gain, params._time, decay, percFloorDb, decay*percRelease)
    params.endTime = params._time + decay
    params._destructor.disconnect(vca)
    scheduleDestroy(params)
    return vca
  }

  let exponentialPercussionEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let decay = evalMainParamEvent(params, 'dec', evalMainParamEvent(params, 'rel', dur, 'b'), 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    let attack = Math.min(0.001, decay/2)
    vca.gain.linearRampToValueAtTime(gain, params._time+attack)
    fadeOut(vca.gain, gain, params._time+attack, decay-attack, expFloorDb)
    params.endTime = params._time + decay
    params._destructor.disconnect(vca)
    scheduleDestroy(params)
    return vca
  }

  let noneEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    params.endTime = params._time + dur * params.beat.duration
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(gain, 0)
    vca.gain.setValueAtTime(0, params.endTime) // The voice is only destroyed some time after endTime
    params._destructor.disconnect(vca)
    scheduleDestroy(params)
    return vca
  }

  let fadeUpCosine = (vca, gain, time, duration) => {
    for (let i = 0; i < 16; i++) {
      vca.gain.linearRampToValueAtTime(Math.sin(i/15 * 0.5*Math.PI)*gain, time + i/15 * duration)
    }
  }
  let fadeDownCosine = (vca, gain, time, duration) => {
    for (let i = 0; i < 16; i++) {
      vca.gain.linearRampToValueAtTime(Math.cos(i/15 * 0.5*Math.PI)*gain, time + i/15 * duration)
    }
  }

  let fadeUpLinear = (vca, gain, time, duration) => {
    vca.gain.setValueAtTime(0, time)
    vca.gain.linearRampToValueAtTime(gain, time + duration)
  }
  let fadeDownLinear = (vca, gain, time, duration) => {
    vca.gain.setValueAtTime(gain, time)
    vca.gain.linearRampToValueAtTime(0, time + duration)
  }

  let padEnvelope = (params, gainBase, type) => {
    let fadeUpAtTime = fadeUpCosine
    let fadeDownAtTime = fadeDownCosine
    if (type === 'linear') {
      fadeUpAtTime = fadeUpLinear
      fadeDownAtTime = fadeDownLinear
    }
    let dur = Math.max(evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'), 0.01)
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = Math.max(evalMainParamEvent(params, 'att', dur, 'b') * params.beat.duration, 0.001)
    let release = Math.max(evalMainParamEvent(params, 'rel', dur, 'b') * params.beat.duration, 0.001)
    let sus = Math.max(dur*params.beat.duration - attack, 0.001)
    if (params._noteOff !== undefined) { sus = undefined } // "live" envelope, use note off to determine when to release
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    fadeUpAtTime(vca, gain, params._time, attack)
    if (sus !== undefined) {
      fadeDownAtTime(vca, gain, params._time + attack+sus, release)
      params.endTime = params._time + attack+sus+release
      scheduleDestroy(params)
    } else {
      params.endTime = params._time + 1e6
      liveRelease(params, () => {
        let relTime = Math.max(params._time + attack, system.audio.currentTime) + 0.001
        fadeDownAtTime(vca, gain, relTime, release)
        params.endTime = relTime+release
      })
    }
    params._destructor.disconnect(vca)
    return vca
  }

  let customEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    evalMainParamFrame(vca.gain, params, 'envelope', 1, undefined, g => g*gain)
    params.endTime = params._time + dur * params.beat.duration
    params._destructor.disconnect(vca)
    scheduleDestroy(params)
    return vca
  }

  let envelope = (params, gainbase, defaultEnvelope) => {
    params._destructor = destructor(true)
    gainbase *= evalMainParamEvent(params, "loud", 1)
    let envelope = evalMainParamEvent(params, "envelope", defaultEnvelope)
    let env
    if (typeof envelope === 'string') {
      switch (envelope) {
        case 'full': env = fullEnvelope(params, gainbase); break
        case 'organ': env = organEnvelope(params, gainbase); break
        case 'simple': env = simpleEnvelope(params, gainbase); break
        case 'pad': env = padEnvelope(params, gainbase, 'cosine'); break
        case 'linpad': env = padEnvelope(params, gainbase, 'linear'); break
        case 'percussion': env = percussionEnvelope(params, gainbase); break
        case 'perc': env = percussionEnvelope(params, gainbase); break
        case 'pluck': env = percussionEnvelope(params, gainbase); break
        case 'exp': env = exponentialPercussionEnvelope(params, gainbase); break
        case 'none': env = noneEnvelope(params, gainbase); break
        default: env = fullEnvelope(params, gainbase); break
      }
    } else {
      env = customEnvelope(params, gainbase)
    }
    return env
  }
  envelope.releaseAllLive = releaseAllLive // Panic: release every live voice, whether or not it is still on a player
  envelope.liveVoiceCount = () => liveVoices.size

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }
  let liveParams = () => { return {_time: system.audio.currentTime, beat: {duration: 1}, dur: 1, _noteOff: () => {}} }

  ;['full','organ','pad','linpad'].forEach(type => {
    let baseCount = liveVoices.size
    let params = liveParams()
    envelope(params, 0.1, type)
    assert(baseCount+1, liveVoices.size, `${type}: live voice registered`)
    assert(true, params.endTime > system.audio.currentTime + 1e5, `${type}: endTime is the live placeholder`)
    params._noteOff()
    assert(true, params.endTime < system.audio.currentTime + 10, `${type}: release sets a real endTime`)
    assert(baseCount, liveVoices.size, `${type}: released voice deregistered`)
    let releasedEndTime = params.endTime
    params._noteOff() // Second release is a no-op: no re-ramp (which would click) and no second destroy timer
    assert(releasedEndTime, params.endTime, `${type}: repeated release changes nothing`)
    assert(baseCount, liveVoices.size, `${type}: repeated release does not deregister anything else`)
  })

  { // Releases fall evenly in dB to a floor relative to the note, then fade linearly to 0 at endTime
    let record = (params, type) => {
      let realCreate = system.audio.createGain
      let calls = []
      let patched = []
      system.audio.createGain = () => {
        let g = realCreate.call(system.audio)
        g.gain.linearRampToValueAtTime = (v,t) => calls.push(['linear',v,t])
        g.gain.exponentialRampToValueAtTime = (v,t) => calls.push(['exponential',v,t])
        patched.push(g)
        return g
      }
      try {
        envelope(params, 0.1, type)
        if (params._noteOff) { params._noteOff() }
      } finally {
        system.audio.createGain = realCreate
        // The node goes back into the GainNode pool, so a leftover override would silence the next real note to get it
        patched.forEach(g => { delete g.gain.linearRampToValueAtTime; delete g.gain.exponentialRampToValueAtTime })
      }
      return calls
    }
    let near = (a, b) => Math.abs(a-b) < 1e-9
    let checkRelease = (type, params, from, floorDb) => {
      let calls = record(params, type)
      let last = calls[calls.length-1]
      let exp = calls[calls.length-2]
      assert('linear', last[0], `${type}: ends with a linear fade`)
      assert(0, last[1], `${type}: fades to 0`)
      assert(true, near(last[2], params.endTime), `${type}: fade ends at endTime`)
      assert('exponential', exp[0], `${type}: release is exponential`)
      assert(true, near(exp[1], from*Math.pow(10, -floorDb/20)), `${type}: release floor ${floorDb}dB below its start; got ${exp[1]/from}`)
    }
    let scheduled = (extra) => Object.assign({_time: system.audio.currentTime, beat: {duration: 1}, dur: 1}, extra)
    let live = (extra) => Object.assign(liveParams(), extra)
    ;[1, 4].forEach(amp => {
      checkRelease('organ', scheduled({amp:amp}), 0.1*amp, 60)
      checkRelease('organ', live({amp:amp}), 0.1*amp, 60)
      checkRelease('exp', scheduled({amp:amp}), 0.1*amp, 60)
      checkRelease('perc', scheduled({amp:amp}), 0.1*amp, 12)
      checkRelease('pluck', scheduled({amp:amp}), 0.1*amp, 12)
      checkRelease('full', scheduled({amp:amp}), 0.1*amp*0.8, 40)
      checkRelease('full', live({amp:amp}), 0.1*amp*0.8, 40)
      checkRelease('simple', scheduled({amp:amp}), 0.1*amp*0.8, 40)
    })
    { // pluck gate release is the last tenth of the note
      let params = scheduled({dec:1})
      let calls = record(params, 'pluck')
      let exp = calls[calls.length-2]
      assert(true, near(exp[2], params.endTime - 0.1), `pluck: release starts a tenth from the end; got ${params.endTime-exp[2]}`)
    }
    { // decay to a zero sustain level can't be exponential all the way
      let calls = record(scheduled({sus:{value:1,level:0}, att:0, dec:1/2}), 'full')
      let zeroAt = calls.findIndex(c => c[1] === 0)
      assert('exponential', calls[zeroAt-1][0], 'full: decay to 0 is exponential first')
      assert(true, near(calls[zeroAt-1][1], 0.001), `full: decay to 0 goes to -40dB first; got ${calls[zeroAt-1][1]}`)
    }
    { // a zero length segment schedules nothing before the segment start
      let params = scheduled({att:0, dec:0, rel:0, sus:1})
      let calls = record(params, 'full')
      assert(true, calls.every(c => c[2] >= params._time), 'full: zero length segments stay in order')
    }
  }

  { // A voice whose note off never arrives is still reachable, and releasing it destroys it
    let baseCount = liveVoices.size
    let params = liveParams()
    envelope(params, 0.1, 'full')
    assert(baseCount+1, liveVoices.size)
    releaseAllLive()
    assert(baseCount, liveVoices.size, 'releaseAllLive releases a voice that was never note-offed')
    assert(true, params.endTime < system.audio.currentTime + 10, 'releaseAllLive sets a real endTime')
  }

  { // An envelope with a known length is not live: it arms its own destroy and registers nothing
    let baseCount = liveVoices.size
    let params = {_time: system.audio.currentTime, beat: {duration: 1}, dur: 1}
    envelope(params, 0.1, 'full')
    assert(baseCount, liveVoices.size, 'a non live envelope is not registered')
    assert(true, params.endTime < system.audio.currentTime + 10)
  }

  ;['none', 'full', 'organ'].forEach(type => { // dur and sus are in beats, endTime in seconds
    let params = {_time: system.audio.currentTime, beat: {duration: 1/2}, dur: 1, sus: 1, att: 0, dec: 0, rel: 0}
    envelope(params, 0.1, type)
    assert(true, Math.abs(params.endTime - (params._time + 1/2)) < 1e-6, `${type}: endTime is dur in seconds; got ${params.endTime-params._time}`)
  })
  { // custom envelope expression
    let params = {_time: system.audio.currentTime, beat: {duration: 1/2}, dur: 1, envelope: 1}
    envelope(params, 0.1, 'full')
    assert(true, Math.abs(params.endTime - (params._time + 1/2)) < 1e-6, `custom: endTime is dur in seconds; got ${params.endTime-params._time}`)
  }

  console.log('Envelope tests complete')
  }

  return envelope
})
