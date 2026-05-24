'use strict'
define(function(require) {
  let {addVarFunction} = require('predefined-vars')
  let {evalParamFrame} = require('player/eval-param')

  let chord = (args, event, beat, state, evalRecurse) => {
    let size = Math.floor(evalRecurse(args.value, event, beat) || 1)
    if (size < 1) size = 1
    let value = args.value1
    let isLambda = typeof value === 'function' && value.isUserFunction
    let result = []
    for (let i = 0; i < size; i++) {
      if (isLambda) {
        // Pass evalParamFrame (not the inherited evalRecurse) so the lambda body
        // is fully evaluated within the call context. The caller may have set
        // evalToObjectOrPrimitive (eg. the delay handler), which would otherwise
        // leave map-literal bodies unevaluated until after the call context is
        // popped, collapsing all voices to i=0.
        // Distinct event per index so per-function memoisation in the body doesn't
        // collapse all i to the first cached result.
        let e = Object.assign({}, event)
        result.push(value(e, beat, evalParamFrame, {value: i}))
      } else {
        result.push(value)
      }
    }
    return result
  }
  chord.isVarFunction = true
  chord.dontEvalArgs = true
  addVarFunction('chord', chord)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
    }
    require('predefined-vars').apply(require('vars').all())
    let parseExpression = require('expression/parse-expression')
    let {evalParamFrame} = require('player/eval-param')
    let expandChords = require('player/expand-chords')
    let ev = (i,c,d,v) => {return{idx:i,count:c,dur:d,_time:c,voice:v}}
    let p

    // Constant value: chord{2,3} → [3,3]
    assert([3,3], evalParamFrame(parseExpression('chord{2,3}'), ev(0,0), 0))

    // Size clamps to 1: chord{0,5} → [5]
    assert([5], evalParamFrame(parseExpression('chord{0,5}'), ev(0,0), 0))

    // Size floors: chord{3.9,1} → [1,1,1]
    assert([1,1,1], evalParamFrame(parseExpression('chord{3.9,1}'), ev(0,0), 0))

    // Lambda with primitive return: chord{3, {i}->i*2} → [0,2,4]
    assert([0,2,4], evalParamFrame(parseExpression('chord{3,{i}->i*2}'), ev(0,0), 0))

    // Lambda with map return: chord{3, {i}->{i,add:2*i}} → [{value:0,add:0},{value:1,add:2},{value:2,add:4}]
    assert([{value:0,add:0},{value:1,add:2},{value:2,add:4}],
      evalParamFrame(parseExpression('chord{3,{i}->{i,add:2*i}}'), ev(0,0), 0))

    // Equivalence with literal chord: chord{2,3} should expand the same as (3,3)
    p = expandChords([{add:evalParamFrame(parseExpression('chord{2,3}'), ev(0,0), 0)}])
    assert(2, p.length)
    assert(3, p[0].add)
    assert(3, p[1].add)
    assert(0, p[0].voice)
    assert(1, p[1].voice)

    // Equivalence with literal chord of maps: chord{3,{i}->{i,add:2*i}} on a param
    // should expand to 3 voices each with their per-voice map
    p = expandChords([{delay:evalParamFrame(parseExpression('chord{3,{i}->{i,add:2*i}}'), ev(0,0), 0)}])
    assert(3, p.length)
    assert({value:0,add:0}, p[0].delay)
    assert({value:1,add:2}, p[1].delay)
    assert({value:2,add:4}, p[2].delay)

    // Regression: when the caller passes evalToObjectOrPrimitive (as the delay
    // handler does), the lambda's map-literal body must still be fully evaluated
    // within the call context. Otherwise all voices collapse to i=0.
    assert([{value:0,add:0},{value:1/4,add:2},{value:2/4,add:4},{value:3/4,add:6}],
      evalParamFrame(parseExpression('chord{4,{i}->{i/4,add:i*2}}'), ev(0,0), 0, {evalToObjectOrPrimitive:true}))

    // Inherited args: inner lambda sees outer lambda's arg
    let vars = require('vars').all()
    vars.foo = parseExpression('{i} -> chord{2, {j} -> i+j}')
    assert([3,4], evalParamFrame(parseExpression('foo{3}'), ev(0,0), 0))
    delete vars.foo

    // Inner own arg shadows outer (chord{2} passes j=0,1; inner i shadows outer)
    vars.foo = parseExpression('{i} -> chord{2, {i} -> i}')
    assert([0,1], evalParamFrame(parseExpression('foo{99}'), ev(0,0), 0))
    delete vars.foo

    // Inherited arg whose value is itself an expression captured from outer scope
    vars.bar = parseExpression('{x} -> x*100')
    vars.foo = parseExpression('{i} -> chord{1, {j} -> i+j}')
    assert([300], evalParamFrame(parseExpression('foo{bar{3}}'), ev(0,0), 0))
    delete vars.foo
    delete vars.bar

    // Inner lambda returning a map with field referring to inherited arg
    // (matches the user-reported pattern: chord{N, {j}->{j, add:i+j}} inside {i}->...)
    vars.foo = parseExpression('{i} -> chord{2, {j} -> {j, add:i+j}}')
    assert([{value:0,add:5},{value:1,add:6}],
      evalParamFrame(parseExpression('foo{5}'), ev(0,0), 0))
    delete vars.foo

    console.log('Chord function tests complete')
  }
})
