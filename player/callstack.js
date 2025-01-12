'use strict';
define((require) => {

  let root = { children:[] }
  let current = root

  let pushCallContext = (context) => {
    let newNode = {
      context: context,
      children: [],
      parent: current
    }
    if (current) { current.children.push(newNode) }
    current = newNode
  }

  let popCallContext = () => {
    if (current === root) { throw `Cant pop, already at root` }
    current.parent.children = current.parent.children.filter((child) => child !== current)
    current = current.parent
  }

  let getCallContext = () => {
    return current ? current.context : undefined
  }

  let unPushCallContext = () => {
    if (current === root) { throw `Cant unpush, already at root` }
    current = current.parent
  }

  let unPopCallContext = () => {
    if (current.children.length === 0) { throw `Cant unpop, no children` }
    current = current.children[current.children.length - 1]
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
    pushCallContext('cc1')
    pushCallContext('cc2a')
    unPushCallContext()
    assert('cc1', getCallContext())
    pushCallContext('cc2b')
    assert('cc2b', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    unPopCallContext()
    assert('cc2a', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    popCallContext()

    // Unpop with multiple children
    pushCallContext('cc1')
    pushCallContext('cc2a')
    unPushCallContext()
    pushCallContext('cc2b')
    unPushCallContext()
    pushCallContext('cc2c')
    assert('cc2c', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    unPopCallContext()
    assert('cc2b', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    unPopCallContext()
    assert('cc2a', getCallContext())
    popCallContext()
    assert('cc1', getCallContext())
    popCallContext()

    // Should be cleared back to root by the end of all tests
    assert(true, current === root)

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
