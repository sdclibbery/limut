'use strict';
define(function (require) {
  let system = require('play/system')
  let metronome = require('metronome')
  let {evalMainParamEvent,evalSubParamEvent,evalMainParamFrame} = require('play/eval-audio-params')

  let semisToCents = (v) => v * 100

  // Ramp detune from baseFreq to targetFreq, scheduled in cents relative to refFreq.
  // Freq is linearly interpolated then log2'd, so approximate with multiple linearRamps.
  let scheduleGlide = (audioParam, startTime, glideDur, baseFreq, targetFreq, refFreq, glideCurve) => {
    let curvePower = 1/(glideCurve+1)
    let steps = 24
    let startCents = 12 * Math.log2(baseFreq / refFreq) * 100
    audioParam.setValueAtTime(startCents, startTime)
    for (let i = 1; i <= steps; i++) {
      let lerp = i/steps
      let appliedLerp = Math.pow(lerp, curvePower)
      let glideFreq = targetFreq*appliedLerp + baseFreq*(1-appliedLerp)
      let cents = 12 * Math.log2(glideFreq / refFreq) * 100
      audioParam.linearRampToValueAtTime(cents, startTime + lerp*glideDur)
    }
  }

  let setupAddc = (audioParam, params) => {
    if (params.addc === undefined) { return }
    let csn = system.audio.createConstantSource()
    csn.offset.value = 0
    evalMainParamFrame(csn.offset, params, 'addc', 0, undefined, semisToCents)
    csn.connect(audioParam)
    csn.start(params._time)
    params._destructor.stop(csn)
    params._destructor.disconnect(csn)
  }

  let setupVib = (audioParam, params) => {
    if (params.vib === undefined) { return }
    let vibCpb = evalMainParamEvent(params, 'vib', 0, 'cpb')
    if (!vibCpb) { return }
    let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
    let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2, 'b')
    let beatDur = metronome.beatDuration()

    let osc = system.audio.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = vibCpb / beatDur // cpb -> hz

    let gain = system.audio.createGain()
    let targetCents = vibdepth * 100
    let delaySec = Math.max(0, vibdelay) * beatDur
    if (delaySec < 1e-4) {
      gain.gain.setValueAtTime(targetCents, params._time)
    } else {
      gain.gain.setValueAtTime(0, params._time)
      let steps = 16
      for (let i = 1; i <= steps; i++) {
        let lerp = i/steps
        gain.gain.linearRampToValueAtTime(targetCents * Math.pow(lerp, 8), params._time + lerp*delaySec)
      }
    }

    osc.connect(gain)
    gain.connect(audioParam)
    osc.start(params._time)
    params._destructor.stop(osc)
    params._destructor.disconnect(osc)
    params._destructor.disconnect(gain)
  }

  // Base event lookup for the event currently being built. Deliberately a single entry that the
  // next event overwrites: NO event may hold a reference to another event. Caching the base list on
  // the event itself (as `_glideBases`) chained every event to the ones before it, so one live event
  // kept the player's whole history reachable - and with it each note's pitch AudioParam, and so its
  // oscillator node. Measured Aug 2026: `a acid, dur=1/50` held ~180MB of main thread heap after
  // three minutes and stalled frames for up to 997ms in GC, against 42MB for the same patch with
  // glide off. The id serves the same purpose for the retrofit guard below - a number, not a handle.
  let glideEventId = 0
  let lookup = {}
  let baseEventsFor = (params) => {
    if (lookup.event === params) { return lookup }
    lookup = {
      event: params,
      id: ++glideEventId,
      // Exclude params itself: whether the event is already on the player depends on where the
      // synth is called from, and an event must never glide from itself.
      bases: (params._player && params._player.events)
        ? params._player.events.filter(e => e !== params && e.voice === params.voice)
        : [],
    }
    return lookup
  }

  let setupGlide = (audioParam, params) => {
    // Register this audioParam so that future glide-target events can retrofit a glide onto it
    if (!params._pitchAudioParams) { params._pitchAudioParams = [] }
    params._pitchAudioParams.push(audioParam)

    let glide = evalMainParamEvent(params, 'glide', 0, 'b')
    if (!glide) { return }
    let glideCurve = evalSubParamEvent(params, 'glide', 'curve', 1)
    let beatDur = metronome.beatDuration()
    let glideDur = glide * beatDur

    // Looked up once per event and shared by that event's other pitchEffects calls (fm ops,
    // multiwave oscillators)
    let {bases, id} = baseEventsFor(params)
    if (bases.length === 0 || !params.freq) { return }

    let lastBase = bases.reduce((a,b) => (a.endTime >= b.endTime ? a : b))
    if (!lastBase.freq) { return }

    scheduleGlide(audioParam, params._time, glideDur, lastBase.freq, params.freq, params.freq, glideCurve)

    // Retrofit glide onto every still-alive base event's audioParams. Guard against
    // double-scheduling if this event has multiple pitchEffects calls (fm ops etc).
    bases.forEach(base => {
      if (base._glidedTo === id) { return }
      base._glidedTo = id
      if (!base.freq || !base._pitchAudioParams) { return }
      base._pitchAudioParams.forEach(baseAp => {
        scheduleGlide(baseAp, params._time, glideDur, base.freq, params.freq, base.freq, glideCurve)
      })
    })
  }

  let pitchEffects = (audioParam, params) => {
    setupGlide(audioParam, params)
    setupAddc(audioParam, params)
    setupVib(audioParam, params)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }
    let mockAp = () => { let ap = {ramps: 0}; ap.setValueAtTime = () => ap.ramps++; ap.linearRampToValueAtTime = () => ap.ramps++; return ap }
    let player = {events: []}
    let ev = (freq, endTime) => {
      let e = {freq: freq, endTime: endTime, voice: 0, _time: 0, _player: player, glide: 1/4}
      player.events.push(e)
      return e
    }
    // References an event holds to any other event are what leaked the whole note history, so
    // check for them directly rather than for the names the old code happened to use.
    let referencesAnEvent = (e, others) => Object.keys(e).some(k => others.includes(e[k])
      || (Array.isArray(e[k]) && e[k].some(v => others.includes(v))))

    let first = ev(100, 1)
    let ap1 = mockAp()
    pitchEffects(ap1, first)
    assert(0, ap1.ramps, 'the first event has nothing to glide from')

    let second = ev(200, 2)
    let ap2 = mockAp()
    pitchEffects(ap2, second)
    assert(25, ap2.ramps, 'the new event glides from the base events pitch')
    assert(25, ap1.ramps, 'and the still sounding base event is retrofitted with a glide to the new pitch')

    let ap2b = mockAp() // A second pitchEffects call on the same event (fm ops, multiwave)
    pitchEffects(ap2b, second)
    assert(25, ap2b.ramps, 'the events other pitch params glide too')
    assert(25, ap1.ramps, 'but the base is not retrofitted twice, which would double schedule it')

    assert(false, referencesAnEvent(first, [second]), 'a base event holds no reference to the event that glided from it')
    assert(false, referencesAnEvent(second, [first]), 'and an event holds no reference to its base events')

    let third = ev(300, 3) // The one entry lookup cache must not pin the previous generation either
    pitchEffects(mockAp(), third)
    assert(false, referencesAnEvent(third, [first, second]), 'nor to any earlier event')

    console.log('Pitch effects tests complete')
  }

  return pitchEffects
})
