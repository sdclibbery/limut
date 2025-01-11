'use strict';
define((require) => {

  let stack = []
  let accessLevel = -1

  let pushCallContext = (context) => {
    stack.push(context)
  }
  let popCallContext = () => {
    if (stack.length <= 0) { throw 'Cannot pop; callstack is empty' }
    stack.pop()
  }

  let getCallContext = () => {
    let level = stack.length + accessLevel
    if (level === -1)  { return undefined } // Global context; no call context to return
    if (level < -1 || level >= stack.length) {
      throw `Stack access at level ${level}; stack.length ${stack.length} accessLevel ${accessLevel}`
    }
    return stack[level]
  }

  let unPushCallContext = () => {
    if (accessLevel < -stack.length) { throw 'Cannot unpush, already at end of callstack' }
    accessLevel--
  }
  let unPopCallContext = () => {
    if (accessLevel >=  -1) { throw 'Cannot unpop, already at end of callstack' }
    accessLevel++
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    // Simple callstack test
    assert(undefined, getCallContext())
    pushCallContext('cc1')
    assert('cc1', getCallContext())
    pushCallContext('cc2')
    assert('cc2', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    popCallContext()
    assert(undefined, getCallContext())

    // Simple callstack with unpush
    pushCallContext('cc1')
    pushCallContext('cc2')
    assert('cc2', getCallContext())
    unPushCallContext()
    assert('cc1', getCallContext())
    unPopCallContext()
    assert('cc2', getCallContext())
    popCallContext()
    popCallContext()
    assert(undefined, getCallContext())

    // Branched callstack with unpush and repush

    // Should all be back to cleared by the end of the tests
    assert(0, stack.length)
    assert(-1, accessLevel)

    console.log('Callstack tests complete')
  }

  return {
    pushCallContext: pushCallContext,
    popCallContext: popCallContext,
    getCallContext: getCallContext,
    unPushCallContext: unPushCallContext,
    unPopCallContext: unPopCallContext
  }

})
