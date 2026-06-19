'use strict'
define((require) => {
  var system = require('play/system')
  let {evalParamEvent} = require('player/eval-param')
  var metronome = require('metronome')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let players = require('player/players')
  let consoleOut = require('console')
  let {connect,isConnectable} = require('play/nodes/connect');
  let vars = require('vars')

  let fadeIn = (node, fadeTime) => {
    node.gain.value = 0
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(0, 0)
    node.gain.linearRampToValueAtTime(1, system.timeNow()+fadeTime)
  }
  let fadeOut = (node, destroy, fadeTime) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(1, 0)
    node.gain.linearRampToValueAtTime(0, system.timeNow()+fadeTime)
    setTimeout(destroy, fadeTime*1000)
  }

  let getPlayerFxChainKey = (params, connectToAudioDest) => {
    // console.log(params._player.id, params._fxString, params.bus, connectToAudioDest)
    return params._player.id + params._fxString + params.bus + connectToAudioDest
  }

  let id = 0
  let createPlayerFxChain = (eventParams, connectToAudioDest) => {
    // Setup for continuous running
    let fx = {
      _perFrame: [],
      destructor: destructor(),
      stopped: false,
      destroyWait: 0.1,
      id: id++,
      key: getPlayerFxChainKey(eventParams, connectToAudioDest), // Key to identify whether this chain needs to be recreated or can be transferred to the new player on code update
    }
    let params = Object.assign({}, eventParams)
    params.chainEndTime = 1e10 // Keep eval-audio-params per-frame callbacks going for the lifetime of the chain
    params._perFrame = fx._perFrame
    params._destructor = fx.destructor
    let lastEvent // Remember the most recent event so per-event params (eg eventpitch) hold their last value through rests
    let getOverrideEvent = (b) => { // If the player has a current event, use it
      let player = players.getById(params.player)
      if (!player) { return undefined }
      let es = player.currentEvent(b)
      if (!es || !es.length) { return undefined }
      lastEvent = es[es.length - 1]
      return lastEvent
    }
    let getCurrentOrLastEvent = (b) => { // Current event if playing, else the last one seen (hold last value through rests)
      let e = getOverrideEvent(b)
      return e !== undefined ? e : lastEvent
    }
    delete params.count
    Object.defineProperty(params, 'count', {
      get() {
        let b = metronome.beatTime(metronome.timeNow())
        let e = getOverrideEvent(b)
        if (!!e) { return e.count } else { return Math.floor(b) }
      },
      set(c) { }, // Ignore for now; used to apply time modifiers for per event, which we don't really support anyway?
    })
    let setEventParam = (p, v, d) => { // Override event timing values to be relative to represent a current event if possible
      delete params[p]
      Object.defineProperty(params, p, {
        get() {
          let b = metronome.beatTime(metronome.timeNow())
          let e = getOverrideEvent(b)
          if (!!e) { return v(e,b) } else { return d(b) }
        },
      })
    }
    setEventParam('idx', (e,b) => e.idx, (b) => Math.floor(b))
    setEventParam('dur', (e,b) => e.dur, (b) => 1)
    setEventParam('_time', (e,b) => e._time, (b) => system.timeNow())
    setEventParam('endTime', (e,b) => e.endTime, (b) => 1)
    delete params.beat
    Object.defineProperty(params, 'beat', { get() { return metronome.lastBeat() } })
    setEventParam('value', (e,b) => e.value, (b) => 0)
    setEventParam('playing', (e,b) => 1, (b) => 0)
    setEventParam('pulse', (e,b) => e.pulse(e,b), (b) => 0)
    system.add(metronome.timeNow(), state => { // Per frame update
      if (fx.stopped) { return false }
      fx._perFrame.forEach(pf => {
        return pf(state)
      })
      return true
    })

    // Expose every event param dynamically: a continuous fx chain is built once, so reads of musical params
    // (sound, add, oct, amp, this.*, ...) must reflect the currently-playing event rather than the build-time copy.
    // These are real accessor getters (not a Proxy) so they survive Object.getOwnPropertyDescriptors cloning of the
    // event - eg the per-copy event clone in graph.js parallel{} - which a Proxy get-trap would not.
    // Chain-lifecycle fields stay bound to the chain; the timing accessors defined above keep their own semantics.
    let chainLifecycleKeys = new Set(['_player','player','_destructor','_perFrame','chainEndTime','fx','_fxString','bus','key','id','linenum'])
    Object.keys(params).forEach(key => {
      if (chainLifecycleKeys.has(key)) { return }
      if (Object.getOwnPropertyDescriptor(params, key).get) { return } // Timing accessors already handle themselves
      let buildTimeValue = params[key]
      delete params[key]
      Object.defineProperty(params, key, {
        enumerable: true,
        get() {
          let e = getCurrentOrLastEvent(metronome.beatTime(metronome.timeNow()))
          if (e && key in e) { return e[key] } // Prefer the live event's value
          return buildTimeValue // Fall back to the build-time copy
        },
        set(v) { buildTimeValue = v }, // Stay writable (eg scale.paramsToFreq caches params.freq); reads still prefer the live event
      })
    })

    // Destruction
    fx.destroy = () => {
      fadeOut(fx.fadeOutGain, fx.cleanup, fx.destroyWait+3)
    }
    fx.cleanup = () => {
      fx.stopped = true
      fx._perFrame = []
      fx.destructor.destroy()
    }
    
    // Create the chain
    fx.chain = evalParamEvent(params.fx, params) // Get the Audionode fx chain
    if (!isConnectable(fx.chain)) {
      fx.chain = vars.all().gain({value:params.fx}, params,metronome.timeNow())
    }

    // Output
    fx.fadeOutGain = system.audio.createGain()
    connect(fx.chain, fx.fadeOutGain, fx.destructor)
    if (connectToAudioDest) {
      system.mix(fx.fadeOutGain)
    } else {
      let busPlayerId = evalMainParamEvent(params, 'bus')
      if (!busPlayerId) { busPlayerId = 'main' } // Default to main bus if not specified
      let bus = players.getById(busPlayerId)
      if (!bus || !bus._input) {
        consoleOut(`🟠 Player ${params._player.id} fx failed to connect to destination bus ${busPlayerId}`)
        return
      }
      fx.fadeOutGain.connect(bus._input)
    }
    fx.destructor.disconnect(fx.fadeOutGain)

    // Input via fade in
    fx.chainInput = system.audio.createGain()
    fadeIn(fx.chainInput, 0.1)
    connect(fx.chainInput, fx.chain, fx.destructor)

    return fx
}

  return {createPlayerFxChain,getPlayerFxChainKey}
})