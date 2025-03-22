'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  var metronome = require('metronome')
  let {connect,isConnectable} = require('play/nodes/connect')
  require('play/nodes/mocks')
  require('play/nodes/convolver')
  require('play/nodes/source')
  require('play/nodes/graph')

  let gain = (args,e,b) => {
    let node = system.audio.createGain()
    let params = combineParams(args, e)
    evalMainParamFrame(node.gain, params, 'value', 1)
    return node
  }
  addNodeFunction('gain', gain)

  let biquad = (args,e,b) => {
    let node = system.audio.createBiquadFilter()
    let params = combineParams(args, e)
    node.type = evalMainParamEvent(args, 'value', 'lowpass')
    evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
    evalMainParamFrame(node.Q, params, 'q', 5)
    evalMainParamFrame(node.gain, params, 'gain', undefined, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for WebAudio
    return node
  }
  addNodeFunction('biquad', biquad)

  let shaper = (args,e,b) => {
    let node = system.audio.createWaveShaper()
    let count = evalMainParamEvent(args, 'samples', 257)
    let oversample = evalMainParamEvent(args, 'oversample', '2x')
    let curve = new Float32Array(count)
    args.value.modifiers = args.value.modifiers || {}
    for (let i = 0; i < count; i++) {
      let x = (i/(count-1))*2 - 1
      args.value.modifiers.value = x
      let y = evalParamFrame(args.value,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
      curve[i] = y
    }
    node.curve = curve
    node.oversample = oversample
    return node
  }
  addNodeFunction('shaper', shaper)

  let delay = (args,e,b) => {
    let maxDelay = evalMainParamEvent(args, 'max', 1, 'b') * metronome.beatDuration()
    let node = system.audio.createDelay(maxDelay)
    let params = combineParams(args, e)
    evalMainParamFrame(node.delayTime, params, 'value', 1/4, 'b', d => d * metronome.beatDuration())
    e._disconnectTime += maxDelay
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (feedbackChain !== undefined) {
      if (!isConnectable(feedbackChain)) { feedbackChain = gain({value:unevalledFeedback}, e,b) }
      connect(node, feedbackChain, e._destructor)
      connect(feedbackChain, node, e._destructor)
    }
    return node
  }
  addNodeFunction('delay', delay)

  let panner = (args,e,b) => {
    let node = system.audio.createStereoPanner()
    let params = combineParams(args, e)
    evalMainParamFrame(node.pan, params, 'value', 0)
    return node
  }
  addNodeFunction('panner', panner)

  let compress = (args,e,b) => {
    let node = system.audio.createDynamicsCompressor()
    let params = combineParams(args, e)
    evalMainParamFrame(node.ratio, params, 'ratio', 0, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.threshold, params, 'threshold', -50, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.knee, params, 'knee', 40, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.attack, params, 'attack', 0.01, 's')
    evalMainParamFrame(node.release, params, 'release', 0.25, 's')
    return node
  }
  addNodeFunction('compress', compress) // There is a wrapper in the libs actually called 'compressor'

  let audioNodeProto
  let flipper = (args,e,b) => {
    let splitter = system.audio.createChannelSplitter(2)
    let merger = system.audio.createChannelMerger(2)
    splitter.connect(merger, 0, 1)
    splitter.connect(merger, 1, 0)
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let composite = Object.create(audioNodeProto) // Create a composite to wrap the pair of nodes
    composite.l = splitter
    composite.r = merger
    composite.connect = (destination) => {
      return connect(composite.r, destination, e._destructor)
    }
    composite.disconnect = () => {
      composite.l.disconnect()
      composite.r.disconnect()
    }
    e._destructor.disconnect(composite)
    return composite
  }
  addNodeFunction('flipper', flipper)
})
