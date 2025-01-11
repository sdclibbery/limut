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

  return {
    pushCallContext: pushCallContext,
    popCallContext: popCallContext,
    getCallContext: getCallContext,
    unPushCallContext: unPushCallContext,
    unPopCallContext: unPopCallContext
  }

})
