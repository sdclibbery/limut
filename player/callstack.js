'use strict';
define((require) => {

  let stack = []
  let level = -1

  let pushCallContext = (context) => stack.push(context)
  let popCallContext = () => stack.pop()

  let getCallContext = () => stack[stack.length + level]

  let unPushCallContext = () => level--
  let unPopCallContext = () => level++

  return {
    pushCallContext: pushCallContext,
    popCallContext: popCallContext,
    getCallContext: getCallContext,
    unPushCallContext: unPushCallContext,
    unPopCallContext: unPopCallContext
  }

})
