'use strict'
define(function(require) {
  let vars = require('vars')

  let floor = (args) => {
    if (!args) { return 0 }
    return Math.floor(args.value)
  }
  floor.isVarFunction = true
  vars['floor'] = floor

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let parseExpression = require('player/parse-expression')
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d,_time:c}}

  assert(1, evalParamFrame(parseExpression('floor{3/2}'), ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression('floor{[3/2]t1}'), ev(0,0), 0))
  // assert([1,2], evalParamFrame(parseExpression('floor{(1,2)}'), ev(0,0), 0))

  console.log('Maths tests complete')
  }
})
