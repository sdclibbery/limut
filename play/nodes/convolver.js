'use strict'
define(function(require) {
  let {addNodeFunction} = require('play/nodes/node-var')
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

  let envelope = (evalAt, step, size) => {
    let from = 0, to = Math.min(step, size)
    let pre = evalAt(0), post = evalAt(to/size)
    return (i) => {
      while (i >= to && to < size) {
        from = to; pre = post
        to = Math.min(to + step, size)
        post = evalAt(to/size)
      }
      let lerp = (i - from) / (to - from)
      return (1-lerp)*pre + lerp*post
    }
  }

  let convolver = (args,e,b) => {
    let node = system.audio.createConvolver()
    var rate = system.audio.sampleRate
    let length = evalMainParamEvent(args, 'length', 1, 's', e)
    var size = rate * length

    var channels = 1
    if (args.l !== undefined || args.r !== undefined) { channels = 2 }
    if (args.env && (args.env.l !== undefined || args.env.r !== undefined)) { channels = 2 }
    var buffer = system.audio.createBuffer(channels, size, rate)
 
    let argL = args.l || args.value || args.r
    let envLArg = args.env && (args.env.l || args.env.value || args.env || args.env.r)
    let step = args.env && args.env.step || 1000
    let envL = envLArg === undefined ? () => 1 : envelope(x => evalArg(envLArg, x, e,b), step, size)

    let argR = args.r || args.value || args.l
    let envRArg = args.env && (args.env.r || args.env.value || args.env || args.env.l)
    let envR = envRArg === undefined ? () => 1 : envelope(x => evalArg(envRArg, x, e,b), step, size)

    let random = mulberry32(1) // Same random seed every time, so the reverb tail is consistent every time
    for (var i = 0; i < size; i++) {
      let signal = argL !== undefined ? evalArg(argL, i/size, e,b) : (random() * 2 - 1)
      let env = envL(i)
      buffer.getChannelData(0)[i] = signal * env
      if (channels === 2) {
        let signal = argR !== undefined ? evalArg(argR, i/size, e,b) : (random() * 2 - 1)
        let env = envR(i)
        buffer.getChannelData(1)[i] = signal * env
      }
    }
 
    node.buffer = buffer
    return node
  }
  addNodeFunction('convolver', convolver)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let env

    env = envelope(x => x, 4, 10)
    assert([0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9], [0,1,2,3,4,5,6,7,8,9].map(i => Math.round(env(i)*100)/100))

    env = envelope(x => x<0.8 ? 1 : 0, 4, 12)
    assert([1,1,1,1,1,1,1,1,1,0.75,0.5,0.25], [0,1,2,3,4,5,6,7,8,9,10,11].map(env))

    console.log('Convolver tests complete')
  }
})
