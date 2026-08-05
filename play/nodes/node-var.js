'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    v._chordPlaceholder = true // Don't evaluate node functions during chord expansion; hold a placeholder slot instead
    addVarFunction(k, v)
  }

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    params.value = args.value // Do not take "value" from the event, it will be set to the pattern value which we won't want
    params.__event = e // For eval audio params to access the 'real' event
    return params
  }

  // Node functions with a default positional param (eg `osc{440}` == `osc{freq:440}`) pick the
  // key to read rather than the value, so units, connectables and timevars all flow through
  // evalMainParamFrame unchanged. Only the call's own args count: an event-level param of the
  // same name must not shadow an explicit positional.
  let positionalParamKey = (args, name) => (args.value !== undefined && args[name] === undefined) ? 'value' : name

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, message) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n ${message || ''}`) }
    }

    assert('freq', positionalParamKey({}, 'freq'))
    assert('value', positionalParamKey({value:440}, 'freq'))
    assert('freq', positionalParamKey({freq:440}, 'freq'))
    assert('freq', positionalParamKey({value:440, freq:220}, 'freq')) // Named arg wins over the positional
    assert('value', positionalParamKey({value:0}, 'freq')) // Zero is a valid positional
    assert('value', positionalParamKey({value:{value:55,_units:'hz'}}, 'freq')) // Units survive; unwrapped downstream
    assert('value', positionalParamKey({value:()=>440}, 'freq')) // Timevars/functions passed through unevaluated

    console.log('Node var tests complete')
  }

  return {
    addNodeFunction: addNodeFunction,
    combineParams: combineParams,
    positionalParamKey: positionalParamKey
  }
})
