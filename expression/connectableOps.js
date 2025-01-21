'use strict';
define(function(require) {
  let connectOp = require('expression/connectOp')
  let {gain} = require('play/nodes')

  let connectableMul = (l, r) => {
    let evalConnectableMulOp = (e,b,evalRecurse) => {
      let node = gain({value:r}, e,b)
      let el = evalRecurse(l, e,b)
      return connectOp(el, node, e,b,evalRecurse)
    }
    return evalConnectableMulOp
  }
    
  return {
    connectableMul: connectableMul
  }
})