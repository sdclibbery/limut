'use strict';
define(function(require) {
  let system = require('play/system');
  let {connect} = require('play/node-connect');
  let destructor = require('play/destructor')
  let {evalParamFrame} = require('player/eval-param')
  let {isConnectable} = require('play/node-connect')
  let vars = require('vars')

  let audioNodeProto
  let getAudioNodeProto = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    return audioNodeProto
  }

  let connectOp = (l,r, e,b,evalRecurse) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    if (typeof l === 'object' && l.value) { l = evalParamFrame(l,e,b,evalRecurse) } // Fully eval args
    if (typeof r === 'object' && r.value) { r = evalParamFrame(r,e,b,evalRecurse) }
    let el = evalRecurse(l, e,b)
    if (!isConnectable(el)) {
      l = vars.all().const({value:l}, e,b) // Allow connecting from a value by wrapping into const
    }
    let composite = Object.create(getAudioNodeProto()) // Create object that satisfies instancof AudioNode
    composite.l = l
    composite.r = r
    composite.destructor = destructor()
    connect(l, r, composite.destructor)
    composite.connect = (destination) => {
      return connect(composite.r, destination, composite.destructor)
    }
    composite.disconnect = () => {
      composite.destructor.destroy()
    }
    if (e && e._destructor) { e._destructor.disconnect(composite) }
    return composite
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let mockAn = () => {
    let an = Object.create(getAudioNodeProto())
    an.connect = () => {}
    an.disconnect = () => { an.disconnected = true }
    Object.defineProperty(an, "numberOfInputs", { get() { return 1 } })
    return an
  }
  let l, r
  let an
  
  an = mockAn()
  assert(an, connectOp(an, undefined, {},0,x=>x))
  assert(an, connectOp(undefined, an, {},0,x=>x))

  l = mockAn()
  r = mockAn()
  an = connectOp(l, r, {},0,x=>x)
  assert(true, an instanceof AudioNode)
  an.disconnect()
  assert(true, l.disconnected)
  assert(true, r.disconnected)

  console.log("connectOp tests complete")
  }

  return connectOp
})