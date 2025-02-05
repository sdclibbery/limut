'use strict';
define((require) => {

  let root = { children:[] }
  root.current = root

  let pushCallContext = (context) => {
    if (root.current === undefined) { throw `Cant push, no current!` }
    let newNode = {
      context: context,
      children: [],
      parent: root.current
    }
    root.current.children.push(newNode)
    root.current = newNode
  }

  let popCallContext = () => {
    if (root.current === root) { throw `Cant pop, already at root` }
    root.current.parent.children = root.current.parent.children.filter((child) => child !== root.current)
    root.current = root.current.parent
  }

  let getCallContext = () => {
    return root.current ? root.current.context : undefined
  }

  let unPushCallContext = () => {
    if (root.current === root) { throw `Cant unpush, already at root` }
    if (root.current.parent === undefined) { throw `Cant unpush, no parent!` }
    root.current = root.current.parent
  }

  let unPopCallContext = () => {
    if (root.current.children.length === 0) { throw `Cant unpop, no children` }
    root.current = root.current.children[root.current.children.length - 1]
  }

  let deepCopyCallTree = (realRoot, copyRoot, realNode, copyNode, copyParent) => {
    if (realNode.context !== undefined) { copyNode.context = realNode.context }
    copyNode.children = realNode.children.map((child) => {
      let childCopy = {}
      deepCopyCallTree(realRoot, copyRoot, child, childCopy, copyNode)
      return childCopy
    })
    if (copyParent !== undefined) { copyNode.parent = copyParent }
    if (realRoot.current === realNode) { copyRoot.current = copyNode }
  }
  let getCallTree = () => {
    let copy = {}
    deepCopyCallTree(root, copy, root, copy, undefined)
    return copy
  }

  let setCallTree = (tree) => {
    if (root.children.length > 0) { throw `Cant set call tree, current call tree is not empty` }
    root = tree
  }

  let clearCallTree = () => {
    root = { children:[] }
    root.current = root
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

    // Deep copy call tree
    pushCallContext('cc1')
    assert(1, root.children.length)
    assert('cc1', root.children[0].context)
    assert(true, root.current === root.children[0])
    assert(true, root.children[0].parent === root)
    let copy = getCallTree()
    popCallContext()
    setCallTree(copy)
    assert(1, root.children.length)
    assert('cc1', root.children[0].context)
    assert(true, root.current === root.children[0])
    assert(true, root.children[0].parent === root)
    clearCallTree()

    // Should be cleared back to root by the end of all tests
    assert(true, root.current === root)

    console.log('Callstack tests complete')
  }

  return {
    pushCallContext: pushCallContext,
    popCallContext: popCallContext,
    getCallContext: getCallContext,
    unPushCallContext: unPushCallContext,
    unPopCallContext: unPopCallContext,
    getCallTree: getCallTree,
    setCallTree: setCallTree,
    clearCallTree: clearCallTree
  }

})
