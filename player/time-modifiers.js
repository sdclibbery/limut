'use strict';
define(function(require) {

  let wrapWithModifiers = (exp, modifiers) => {
      if (!modifiers) { return exp }
      if (modifiers.per) {
          return (ev,b,evalRecurse) => {
              let per = evalRecurse(modifiers.per, ev,b,evalRecurse)
              let originalCount = ev.count
              ev.count = ev.count % per
              let result = evalRecurse(exp, ev,b%per,evalRecurse)
              ev.count = originalCount
              return result
          }
      }
      return exp
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg}.\n>>Expected equal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let f, w
    let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}
    let {evalParamFrame,evalParamEvent} = require('player/eval-param')
    
    assert(0, wrapWithModifiers(0))
    assert(0, wrapWithModifiers(0, {}))
    f = (x) => x
    assert(f, wrapWithModifiers(f))
    assert(f, wrapWithModifiers(f, {}))

    w = wrapWithModifiers((e,b,er) => b)
    assert(0, evalParamFrame(w,ev(0,0),0))
    assert(1, evalParamFrame(w,ev(1,1),1))

    w = wrapWithModifiers((e,b,er) => b, {})
    assert(0, evalParamFrame(w,ev(0,0),0))
    assert(1, evalParamFrame(w,ev(1,1),1))

    w = wrapWithModifiers((e,b,er) => b, {per:1})
    assert(0, evalParamFrame(w,ev(0,0),0))
    assert(0, w({count:1},1,evalParamFrame))
    assert(0, evalParamFrame(w,ev(1,1),1))

    w = wrapWithModifiers(({count},b,er) => count, {per:1})
    assert(0, evalParamFrame(w,ev(0,0),0))
    assert(0, w({count:1},1,evalParamFrame))
    assert(0, evalParamFrame(w,ev(1,1),1))

    w = wrapWithModifiers((e,b,er) => b, {per:()=>1})
    assert(0, evalParamFrame(w,ev(0,0),0))
    assert(0, w({count:1},1,evalParamFrame))
    assert(0, evalParamFrame(w,ev(1,1),1))

    console.log('Time modifiers tests complete')
  }

  return {
    wrap: wrapWithModifiers,
  }
})