'use strict';
define(function(require) {
  let connectOp = require('expression/connectOp')
  let vars = require('vars').all()

  let connectableAdd = (l, el, elIsConnectable, r, er, erIsConnectable, e,b,evalRecurse) => {
    if (!elIsConnectable) { el = vars.const({value:l}, e,b) }
    if (!erIsConnectable) { er = vars.const({value:r}, e,b) }
    return { value:el, value1:er }
  }
    
  let connectableMul = (l, el, elIsConnectable, r, er, erIsConnectable, e,b,evalRecurse) => {
    if (!elIsConnectable) {
      let node = vars.gain({value:l}, e,b)
      return connectOp(node, er, e,b,evalRecurse)
    }
    let node = vars.gain({value:r}, e,b)
    return connectOp(el, node, e,b,evalRecurse)
  }
    
  return {
    connectableAdd: connectableAdd,
    connectableMul: connectableMul
  }
})