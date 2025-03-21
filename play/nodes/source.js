'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let setWave = require('play/synth/waveforms/set-wave')
  let {getBuffer} = require('play/samples')

  let osc = (args,e,b) => {
    let node = system.audio.createOscillator()
    let params = combineParams(args, e)
    let value = evalParamEvent(params.value, e,b)
    setWave(node, (typeof value === 'string') ? value :  'sawtooth')
    let freq = 440
    if (typeof value === 'number' && value !== 0) {
      evalMainParamFrame(node.frequency, params, 'value', 440, 'hz')
      freq = evalParamEvent(params['value'], e)
    } else {
      evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
      freq = evalParamEvent(params['freq'], e)
    }
    let phase = evalParamEvent(params['phase'], e)
    let offset = 0
    if (typeof freq === 'number' && typeof phase === 'number') { offset = phase / freq }
    node.start(e._time + offset)
    e._destructor.stop(node)
    return node
  }
  addNodeFunction('osc', osc)

  let sample = (args,e,b) => {
    let node = system.audio.createBufferSource()
    let params = combineParams(args, e)
    let value = params.sample !== undefined ? params.sample : args.value
    let startTime = 0
    if (typeof value === 'string' || value === undefined) {
      if (value === undefined) { value = 'sample/salamander/C4v8.mp3' }
      node.buffer = getBuffer(value)
      startTime = evalMainParamEvent(params, 'start', 0, 's')
    } else {
      const length = evalMainParamEvent(params, 'length', 0.2, 's')
      const sampleRate = system.audio.sampleRate
      let buffer = system.audio.createBuffer(1, length*sampleRate, sampleRate)
      let data = buffer.getChannelData(0)
      args.value.modifiers = args.value.modifiers || {}
      for (var i = 0; i < data.length; i++) {
        args.value.modifiers.value = i / data.length
        let y = evalParamFrame(args.value,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
        data[i] = y
      }
      node.buffer = buffer
    }
    evalMainParamFrame(node.playbackRate, params, 'rate', 1)
    node.loop = params.loop === undefined || params.loop === true ? true : false // Default to looping if not set
    node.start(e._time, startTime)
    e._destructor.stop(node)
    return node
  }
  addNodeFunction('sample', sample)

  let constNode = (args,e,b) => {
    let node = system.audio.createConstantSource()
    let params = combineParams(args, e)
    evalMainParamFrame(node.offset, params, 'value', 1)
    node.start(e._time)
    e._destructor.stop(node)
    return node
  }
  addNodeFunction('const', constNode)

})
