'use strict';
define(function(require) {
  let vars = require('vars')
  let mainVars = require('main-vars')
  let {evalParamFrame} = require('player/eval-param')
  let {getCallContext,unPushCallContext,unPopCallContext} = require('player/callstack')

  let isVarChar = (char) => {
    return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || (char == '_')
  }

  let parseVar = (state) => {
    let key = ''
    let char
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if (isVarChar(char)) {
        key += char
        state.idx += 1
        continue
      }
      break
    }
    return key
  }

  let callsiteId = 0
  let varLookup = (key, args, context, interval, userFunctionArgs) => {
    if (!key) { return }

    // look for static function call; call var immediately if present
    let f = vars.get(key)
    if (typeof f === 'function' && f.isStaticVarFunction) {
      return f(args, context)
    }

    // Lookup argument if inside a user defined function
    if (userFunctionArgs !== undefined && userFunctionArgs[key] !== undefined) {
      let defaultValue = userFunctionArgs[key]
      let position
      Object.getOwnPropertyNames(userFunctionArgs).forEach((k,i) => {
        if (k === key) { position = i }
      })
      let userFunctionArgumentLookup = (e,b,er) => {
        let args = getCallContext()
        if (args === undefined) { return undefined }
        let value = args[key] // Get arg by direct lookup by name
        if (value === undefined) { value = args['value'+(position || '')] } // Get arg by position
        if (value === undefined) { value = defaultValue } // If no arg passed in, use default value from prototype
        if (value === false) { value = undefined } // No default arg either
        unPushCallContext() // Need to look outside the current callstack level when evalling the arg
        value = er(value,e,b)
        unPopCallContext()
        return value
      }
      userFunctionArgumentLookup._name = key
      return userFunctionArgumentLookup
    }

    // Return a lookup function
    let state = {} // Create a state store for this parse instance
    let result
    let thisCallsiteId = 'cs' + callsiteId++
    if (interval === undefined && typeof vars.get(key) === 'function') { interval = vars.get(key).interval }
    let parseVarLookup = (event,b, evalRecurse, modifiers) => {
      let vr = vars.get(key)
      let v
      if (typeof vr === 'function' && vr.isVarFunction) { // Var function
        modifiers = modifiers || {}
        if (vr.dontEvalArgs) { // AudioNode functions cannot do per frame update if the args are already evalled
          Object.assign(modifiers, args)
        } else {
          Object.assign(modifiers, evalRecurse(args,event,b))
        }
        if (modifiers) {
          if (parseVarLookup.args !== undefined) { modifiers.value = parseVarLookup.args }
        } else {
          modifiers = parseVarLookup.args
        }
        if (vr.passCallsiteId && modifiers) {
          modifiers.__functionContext = thisCallsiteId // Add the id of this callsite as an extra arg, for memoisation
        }
        if (vr.isNormalCallFunction) { // Used by user defined functions which need evalRecurse but not state
          v = vr(event,b, evalRecurse, modifiers)
        } else {
          v = vr(modifiers, event,b, state, evalRecurse)
        }
        if (typeof v === 'object' && v._finalResult) {
          if (typeof modifiers !== 'object' || Object.keys(modifiers).length === 0) {
            return key // It was an aggregator, but it was passed no args. Return the string for min/max etc
          }
        }
        return v
      } else if (mainVars.exists(key)) {
        throw `Reading main var ${key}`
      } else {
        v = vr // ordinary var
        if (v === undefined) { v = key } // If not found as a var, treat as a string value
      }
      v = evalParamFrame(v,event,b)
      if (v === undefined) { v = 0 } // If not found at all, assume its for a currently unavailable player and default to zero
      return v
    }
    result = parseVarLookup
    result.interval = interval
    result._name = key
    if (typeof vars.get(key) === 'function' && vars.get(key)._thisVar) { result._thisVar = true } // For node vars: pass this through to prevent the node function getting evalled during expand-chords
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertThrows = async (expected, code) => {
    let got
    try {await code()}
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }
  let p
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}
  let vars = require('vars').all()
  let state

  vars.foo = 'bar'
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert(3, state.idx)
  vars.foo = 'baz'
  assert('baz', p({},0,(v)=>v))
  delete vars.foo

  vars['foo'] = 'bar'
  p = varLookup(parseVar({str:'FoO',idx:0}), [])
  assert('bar', p({},0,(v)=>v))
  delete vars.foo

  vars.foo = () => 5
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), {value:1}, {})
  assert(3, state.idx)
  assert(5, evalParamFrame(p,ev(0,0),0))
  delete vars.foo

  vars.foo = (args) => args.baz
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), {baz:5}, {})
  assert(3, state.idx)
  assert(5, evalParamFrame(p,ev(0,0),0))
  delete vars.foo

  vars.foo = () => 5
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), undefined, {})
  assert(3, state.idx)
  assert(5, p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  vars.foo = (args) => args.bar
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), {bar:3}, {})
  assert(3, state.idx)
  assert(3, p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [1,2]
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([1,2], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [1]
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([1], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => []
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => undefined
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert(0, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = (x) => x.value*x.value
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  p.modifiers = {value:2}
  assert(4, evalParamFrame(p,ev(0),0))
  delete vars.foo

  vars.foo = (x) => x.value
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  p.modifiers = {value:[2,3]}
  assert([2,3], evalParamFrame(p,ev(0),0))
  delete vars.foo

  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert('foo', p(ev(0),0,evalParamFrame))

  state = {str:'bpm',idx:0}
  p = varLookup(parseVar(state), [])
  assertThrows('main var', () => p(ev(0),0,evalParamFrame))

  console.log('Parse var tests complete')
  }
  
  return {
    parseVar: parseVar,
    varLookup: varLookup,
    isVarChar: isVarChar,
  }
})