'use strict';
define(function(require) {
  let connectOp = require('expression/connectOp')
  let evalOperator = require('expression/eval-operator')
  let vars = require('vars')

  let connectableAdd = (l, el, elIsConnectable, r, er, erIsConnectable, e,b,evalRecurse) => {
    if (!elIsConnectable) { el = vars.all().const({value:l}, e,b) }
    if (!erIsConnectable) { er = vars.all().const({value:r}, e,b) }
    return { value:el, value1:er }
  }

  let connectableMul = (l, el, elIsConnectable, r, er, erIsConnectable, e,b,evalRecurse) => {
    if (!elIsConnectable) {
      let node = vars.all().gain({value:l}, e,b)
      return connectOp(node, er, e,b,evalRecurse)
    }
    let node = vars.all().gain({value:r}, e,b)
    return connectOp(el, node, e,b,evalRecurse)
  }

  let connectableDiv = (l, el, elIsConnectable, r, er, erIsConnectable, e,b,evalRecurse) => {
    if (erIsConnectable) {
      throw `Cannot divide connectable ${el} by connectable ${er}`
    }
    let recipR = evalOperator((l,r)=>l/r, 1, r)
    let node = vars.all().gain({value:recipR}, e,b)
    return connectOp(el, node, e,b,evalRecurse)
  }
    
  return {
    connectableAdd: connectableAdd,
    connectableMul: connectableMul,
    connectableDiv: connectableDiv
  }
})