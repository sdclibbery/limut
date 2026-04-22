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

  let setupGlide = (audioParam, params) => {
    // Register this audioParam so that future glide-target events can retrofit a glide onto it
    if (!params._pitchAudioParams) { params._pitchAudioParams = [] }
    params._pitchAudioParams.push(audioParam)

    let glide = evalMainParamEvent(params, 'glide', 0, 'b')
    if (!glide) { return }
    let glideCurve = evalSubParamEvent(params, 'glide', 'curve', 1)
    let beatDur = metronome.beatDuration()
    let glideDur = glide * beatDur

    // Look up base events once per event. Cache on params so multiple pitchEffects calls
    // (e.g. fm ops, multiwave oscillators) share the same base event lookup.
    let bases = params._glideBases
    if (bases === undefined) {
      bases = (params._player && params._player.events)
        ? params._player.events.filter(e => e.voice === params.voice)
        : []
      params._glideBases = bases
    }
    if (bases.length === 0 || !params.freq) { return }

    let lastBase = bases.reduce((a,b) => (a.endTime >= b.endTime ? a : b))
    if (!lastBase.freq) { return }

    scheduleGlide(audioParam, params._time, glideDur, lastBase.freq, params.freq, params.freq, glideCurve)

    // Retrofit glide onto every still-alive base event's audioParams. Guard against
    // double-scheduling if this event has multiple pitchEffects calls (fm ops etc).
    bases.forEach(base => {
      if (base._glidedToEvent === params) { return }
      base._glidedToEvent = params
      if (!base.freq || !base._pitchAudioParams) { return }
      base._pitchAudioParams.forEach(baseAp => {
        scheduleGlide(baseAp, params._time, glideDur, base.freq, params.freq, base.freq, glideCurve)
      })
    })
  }

  return (audioParam, params) => {
    setupGlide(audioParam, params)
    setupAddc(audioParam, params)
    setupVib(audioParam, params)
  }

})
