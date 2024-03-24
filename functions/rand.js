'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let xmur3 = (x) => {
    let h = 1779033703
    h = Math.imul(h ^ Math.floor(x), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ Math.floor((x%1)*4294967296), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ h >>> 16, 2246822507)
    h = Math.imul(h ^ h >>> 13, 3266489909)
    return (h ^= h >>> 16) >>> 0
  }

  let rand = (args, e,b,state) => {
    if (state.perParseSeed === undefined) {
        state.perParseSeed = Math.random()
    }
    let seed = args && args.seed
    if (seed === undefined) { seed = state.perParseSeed*999999 }
    return xmur3(b - seed) / 4294967296
  }
  rand.isDirectFunction = true
  addVarFunction('rand', rand)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
    }
    let assertNotEqual = (expected, actual, msg) => {
      if (expected === actual) { console.trace(`Assertion failed ${msg}.\n>>Expected unequal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let assertIsSameEveryTime = (getter) => {
      let x = getter(0)
      for (let i=0; i<20; i++) {
          assert(x, getter(i/20), `Index: ${i} x: ${i/20}`)
      }
    }
    let assertIsDifferentEveryTime = (getter) => {
      let old = getter(0)
      for (let i=1; i<=20; i++) {
        let next = getter(i)
        assertNotEqual(old, next, `Index: ${i}`)
        old = next
      }
    }
    require('predefined-vars').apply(require('vars').all())
    let parseExpression = require('expression/parse-expression')
    let {evalParamFrame} = require('player/eval-param')
    let ev = (t,c,d) => {return{idx:0,count:c||0,dur:d||1,_time:t||1,voice:0,beat:{duration:(t||1)/(c||1)}}}
    let p

    assertIsDifferentEveryTime(() => evalParamFrame(parseExpression("rand"), ev(), 0))

    p = parseExpression("rand{seed:1}")
    assert(0.385, evalParamFrame(p, ev(), 0))
    assertIsSameEveryTime(() => evalParamFrame(p, ev(), 0))
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(), i/1200))

    p = parseExpression("rand{seed:2}")
    assert(0.385, evalParamFrame(p, ev(), 1))

    p = parseExpression("rand{step:1}")
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(), 0+x))
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(), 1+x))
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(), 2+x))
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(), i))

    p = parseExpression("rand@e")
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(0,0,1), 0+x))
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(1,1,1), 1+x))
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(2,2,1), 2+x))
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(i,i,1), i))

    p = parseExpression("rand{step:2}@e")
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(x*4%2,x*4%2,1), 0+x))
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(i*2,i*2,1), i*2))

    p = parseExpression("rand{seed:1}@e")
    assert(0.385, evalParamFrame(p, ev(), 0))
    assertIsSameEveryTime((x) => evalParamFrame(p, ev(0,0,1), 0+x))
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(i*2,i*2,1), i*2))

    p = parseExpression("rand{per:1}")
    assertIsDifferentEveryTime((i) => evalParamFrame(p, ev(), i/1200))
    assert(evalParamFrame(p, ev(), 0), evalParamFrame(p, ev(), 1))
    assert(evalParamFrame(p, ev(), 1), evalParamFrame(p, ev(), 2))

    console.log('Rand function tests complete')
  }

  return rand
})
  