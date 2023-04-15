'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {evalMainParamFrame,evalMainParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let {reverb} = require('play/effects/reverb')
  let {mixedFreeverb} = require('play/effects/freeverb')
  let {mixedChorus} = require('play/effects/chorus')
  let {mixedPhaser} = require('play/effects/phaser')
  let {mixedFlanger} = require('play/effects/flanger')
  let players = require('player/players')
  let consoleOut = require('console')
  let {echo} = require('play/effects/echo')

  let effectChain = (params, node) => {
    node = waveEffects(params, node)
    node = effects(params, node)
    node = mixedChorus(params, node)
    node = mixedPhaser(params, node)
    node = mixedFlanger(params, node)
    node = mixedFreeverb(params, node)
    node = reverb(params, node)
    node = echo(params, node)
    return node
  }

  let fadeTime = 0.1
  let fadeIn = (node) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(0, system.timeNow()) // Similar signal on both sides of the crossfade, so use a linear crossfade
    node.gain.linearRampToValueAtTime(1, system.timeNow()+fadeTime)
  }
  let fadeOut = (node, destroy) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(1, system.timeNow())
    node.gain.linearRampToValueAtTime(0, system.timeNow()+fadeTime)
    setTimeout(destroy, fadeTime*1000)
  }

  let connectToDestination = (bus, params) => {
    if (bus.id === 'main') { // If this is the main bus, it must mix direct to system
      system.mix(bus.output)
      return
    }
    let destBusId = evalMainParamEvent(params, 'bus')
    if (!destBusId) { destBusId = 'main' } // Default to main bus if not specified
    let destBus = players.getById(destBusId)
    if (destBus && destBus._input) { // Do nothing if bus not present
      bus.output.connect(destBus._input)
    } else {
      consoleOut(`Bus ${bus.id} failed to connect to destination bus ${destBusId}`)
    }
  }

  let createBus = (busId, oldBus) => {
    let bus = {
      id: busId,
      oldBus: oldBus,
      _perFrame: [], destructor: destructor(),
      destroyWait: 0.1,
     }

    // Input
    let input
    if (bus.oldBus) {
      input = bus.oldBus._input // Copy the same input mixer from the previous version of this bus to allow crossfading
    }
    if (!input) {
      input = system.audio.createGain()
    }
    bus._input = input
    
    // Create rest of bus later, when param overrides are available
    let stopped = false
    bus.start = (params) => {
      params._perFrame = bus._perFrame
      params._destructor = bus.destructor
      let offset = 0
      Object.defineProperty(params, "count", { // Params must define count so that evalParamEvent works, but use a dynamic getter so we can give it the current time (this effectively forces all values to per-frame interval)
        get() { return offset + metronome.beatTime(metronome.timeNow()) },
        set(c) { offset = c - metronome.beatTime(metronome.timeNow()) },
      })
      Object.defineProperty(params, "idx", { // Also define idx to allow [] index timevar to sort of work
        get() { return metronome.beatTime(metronome.timeNow())%2 },
      })
      params._destroyWait = 0
      // output
      bus.output = system.audio.createGain()
      connectToDestination(bus, params)
      bus.destructor.disconnect(bus.output)
      // crossfade
      bus.crossfade = system.audio.createGain() // Crossfade from old version of bus to new
      input.connect(bus.crossfade)
      bus.destructor.disconnect(bus.crossfade)
      if (bus.oldBus) {
        if (bus.oldBus.destroy) { bus.oldBus.destroy() } // Fade out old bus and destroy
        delete bus.oldBus
      }
      fadeIn(bus.crossfade)
      // effect chain
      effectChain(params, bus.crossfade, bus).connect(bus.output)
      bus.destroyWait += params._destroyWait
      bus.output.gain.cancelScheduledValues(0)
      evalMainParamFrame(bus.output.gain, params, 'amp', 1) // output amp
      // Per frame update
      system.add(metronome.timeNow(), state => {
        if (stopped) { return false }
        bus._perFrame.forEach(pf => pf(state))
        return true
      })
      // Pulse
      let pulseData
      params.pulse = () => {
        if (!bus.analyser) { // Create the analyser first time the data is asked for
          bus.analyser = system.audio.createAnalyser()
          bus.output.connect(bus.analyser)
          bus.analyser.fftSize = 32
          bus.analyser.smoothingTimeConstant = 1
          bus.destructor.disconnect(bus.analyser)
          pulseData = new Float32Array(bus.analyser.fftSize)
        }
        bus.analyser.getFloatTimeDomainData(pulseData)
        let peakInstantaneousPower = 0
        for (let i = 0; i < bus.analyser.fftSize; i++) {
          const power = pulseData[i] ** 2
          peakInstantaneousPower = Math.max(power, peakInstantaneousPower)
        }
        let peakInstantaneousPowerDecibels = 10 * Math.log10(peakInstantaneousPower)
        let pulse = 1 + peakInstantaneousPowerDecibels / 30
        return Math.min(Math.max(pulse, 0), 1)
      }
    }
    // Destroy
    bus.destroy = () => {
      if (bus.oldBus) {
        if (bus.oldBus.destroy) { bus.oldBus.destroy() } // Fade out old bus and destroy (for when start() hasn't run yet)
        delete bus.oldBus
      }
      if (bus.crossfade) {
        fadeOut(bus.crossfade, () => {
          input.disconnect(bus.crossfade) // Only disconnect input from THIS bus as it may get transferred to another bus
          setTimeout(() => bus.cleanup(), bus.destroyWait*1000)
        })
      } else {
        setTimeout(() => bus.cleanup(), bus.destroyWait*1000)
      }
    }
    bus.cleanup = () => {
      stopped = true
      bus._perFrame = []
      bus.destructor.destroy()
    }
        
    return bus
  }

  return createBus
})