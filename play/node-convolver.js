'use strict'
define(function(require) {
  let system = require('play/system');
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let {evalParamFrame} = require('player/eval-param')

  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  let evalArg = (arg, v, e,b) => {
    if (arg.modifiers === undefined) { arg.modifiers = {} }
    arg.modifiers.value = v
    return evalParamFrame(arg,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
  }

  let envelope = (arg, step) => {
    let env = {
      arg: arg,//args.env && (args.env.l || args.env.value || args.env.r), // !!!Doesn't handle r channel!!!
      step: step,//args.env && args.env.step || 1000,
      i: 0,
      pre: undefined,
      post: undefined
    }
    env.get = (i, size, e,b) => {
      if (env.arg === undefined) { return 1 } // No envelope
      if (env.pre === undefined) {
        env.i = Math.min(env.i + env.step, size)
        env.post = evalArg(env.arg, env.i/size, e,b)
      }
      if (env.pre === undefined || i >= env.i) {
        env.pre = env.post
        env.i = Math.min(env.i + env.step, size)
        env.post = evalArg(env.arg, env.i/size, e,b)
      }
      let lerp = (env.i - i) / env.step
      return (1-lerp)*env.pre + lerp*env.post // Linear interpolate envelope
    }
    return env
  }

  let convolver = (args,e,b) => {
    let node = system.audio.createConvolver()
    var rate = system.audio.sampleRate
    let length = evalMainParamEvent(args, 'length', 1, 's')
    var size = rate * length

    var channels = 1
    if (args.l !== undefined || args.r !== undefined) { channels = 2 }
    if (args.env && (args.env.l !== undefined || args.env.r !== undefined)) { channels = 2 }
    var buffer = system.audio.createBuffer(channels, size, rate)
 
    let argL = args.l || args.value || args.r
    let envLArg = args.env && (args.env.l || args.env.value || args.env || args.env.r)
    let envL = envelope(envLArg, args.env && args.env.step || 1000)

    let argR = args.r || args.value || args.l
    let envRArg = args.env && (args.env.r || args.env.value || args.env || args.env.l)
    let envR = envelope(envRArg, args.env && args.env.step || 1000)

    let random = mulberry32(1) // Same random seed every time, so the reverb tail is consistent every time
    for (var i = 0; i < size; i++) {
      let signal = argL !== undefined ? evalArg(argL, i/size, e,b) : (random() * 2 - 1)
      let env = envL.get(i, size, e,b)
      buffer.getChannelData(0)[i] = signal * env
      if (channels === 2) {
        let signal = argR !== undefined ? evalArg(argR, i/size, e,b) : (random() * 2 - 1)
        let env = envR.get(i, size, e,b)
        buffer.getChannelData(1)[i] = signal * env
      }
    }
 
    node.buffer = buffer
    return node
  }

  return convolver
})
