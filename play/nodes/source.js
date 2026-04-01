'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let setWave = require('play/synth/waveforms/set-wave')
  let {getBuffer} = require('play/samples')
  let {mainParamUnits} = require('player/sub-param')

  let osc = (args,e,b) => {
    let node = system.audio.createOscillator()
    let params = combineParams(args, e)
    let value = evalParamEvent(params.value, e,b)
    setWave(node, (typeof value === 'string') ? value : 'sawtooth')
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
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('osc', osc)

  let constNode = (args,e,b) => {
    let node = system.audio.createConstantSource()
    let params = combineParams(args, e)
    evalMainParamFrame(node.offset, params, 'value', 1)
    node.start(e._time)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('const', constNode)

  let sample = (args,e,b) => {
    let node = system.audio.createBufferSource()
    let params = combineParams(args, e)
    let value = params.sample !== undefined ? params.sample : args.value
    let startTime = 0
    let evalledValue = evalParamEvent(value, e,b)
    if (typeof evalledValue === 'string') { value = evalledValue }
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
    if (params.loopstart !== undefined && params.looplen !== undefined) {
      node.loopStart = mainParamUnits(evalParamFrame(params.loopstart,params,e.count), 0, 's')
      node.loopEnd = node.loopStart + mainParamUnits(evalParamFrame(params.looplen,params,e.count), 1, 's')
      node.loop = true
      system.add(params._time, (state) => {
        let __event = params !== undefined && params.__event ? params.__event : params
        if (__event && state.time > __event.endTime) { return false }
        if (__event && state.time < __event._time) { return true }
          node.loopStart = mainParamUnits(evalParamFrame(params.loopstart,params,state.count), 0, 's')
          node.loopEnd = node.loopStart + mainParamUnits(evalParamFrame(params.looplen,params,state.count), 1, 's')
        return true
      })
    }
    node.start(e._time, startTime)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('sample', sample)
})
