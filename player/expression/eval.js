'use strict';
define(function(require) {

  let evalConstants = (e) => {
    return e
  }

  let evalEvent = (e, s,b) => {
    return e
  }

  let evalFrame = (e, b) => {
    return e
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert({value:1, eval:'constant',type:'number'}, evalConstants({value:1, eval:'constant',type:'number'}))

  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})