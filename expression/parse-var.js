'use strict';
define(function(require) {
  let vars = require('vars')
  let mainVars = require('main-vars')
  let {evalParamFrame} = require('player/eval-param')
  let {getCallContext,unPushCallContext,unPopCallContext,findInCallChainByKey} = require('player/callstack')

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

  // A piped value (the LHS of `.` or of `>>`) takes one positional slot of the callee, so the
  // callsite's own positional args from that slot on shift up one: x>>foo{2} calls foo{x,2}, not
  // foo{x}. The slot is the first one unless the callee is a user defined function that declares an
  // arg called `in` somewhere else (parse-expression.js sets _pipeSlot), which is how a function can
  // take something other than the incoming value as its first, default argument: `kal{5}` is
  // `kal{shape:5}` while `rot2{1/8}>>kal{5}` still pipes the rotated coordinate into kal's `in`.
  let shiftPositionalArgs = (o, from) => {
    from = from || 0
    let count = 0
    while (o['value'+(count||'')] !== undefined) { count++ }
    for (let i=count-1; i>=from; i--) { o['value'+(i+1)] = o['value'+(i||'')] }
    delete o['value'+(from||'')]
    return o
  }

  // Where a lookup's value ultimately comes from: the expression bound to it, and the call frame
  // that expression is evaluated in - resolved by walking the same scope chain the eval path walks,
  // but without evaluating anything. Two values with the same {ast, context} are the same expression
  // in the same scope, so they must hold the same value on every frame; the visual synth's codegen
  // uses that to share one uniform between them (draw/visualsynth/codegen.js), instead of one per
  // reference. A pass-through binding (an argument bound to its caller's argument, as the noise
  // library's `seed` is all the way down) resolves to its root in one call, since each hop unwinds
  // into the scope its expression was written in exactly as the eval path unwinds it.
  //
  // Best effort throughout: anything unexpected gives undefined, and the caller then just does not
  // share. It must never be able to break a build, and it must leave the call stack where it found
  // it, so each hop unwinds only as far as it actually got.
  let resolveBindingSource = (value) => {
    if (typeof value === 'function' && value._bindingSource !== undefined) {
      let inner = value._bindingSource()
      if (inner !== undefined) { return inner }
      return undefined // Its own binding could not be resolved; neither can ours
    }
    return {ast: value, context: getCallContext()}
  }
  let resolveOutside = (depth, value) => {
    let n = 0
    try {
      while (n < depth) { unPushCallContext(); n++ }
      return resolveBindingSource(value)
    } catch (err) {
      return undefined
    } finally {
      if (n > 0) { unPopCallContext(n) }
    }
  }

  let callsiteId = 0
  let varLookup = (key, args, context, interval, userFunctionArgs, inheritedArgs) => {
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
      let argCallsiteId = 'cs' + callsiteId++
      let userFunctionArgumentLookup = (e,b,er,mods) => {
        let args = getCallContext()
        if (args === undefined) { return undefined }
        let value = args[key] // Get arg by direct lookup by name
        if (value === undefined) { value = args['value'+(position || '')] } // Get arg by position
        if (value === undefined) { value = defaultValue } // If no arg passed in, use default value from prototype
        if (value === false) { value = undefined } // No default arg either
        unPushCallContext() // Need to look outside the current callstack level when evalling the arg
        if (typeof value === 'function' && value.isUserFunction && mods !== undefined) {
          mods.__functionContext = argCallsiteId // Distinguish calls from different callsites for memoisation
          value = value(e,b,er,mods) // The arg holds a lambda and this is a call: pass the callsite args through
        } else {
          value = er(value,e,b)
        }
        unPopCallContext()
        return value
      }
      // The binding this lookup reads, resolved without evaluating it. Mirrors the name-then-
      // position-then-default order above exactly, so the two can never disagree about which
      // expression is in play.
      userFunctionArgumentLookup._bindingSource = () => {
        let args = getCallContext()
        if (args === undefined) { return undefined }
        let value = args[key]
        if (value === undefined) { value = args['value'+(position || '')] }
        if (value === undefined) { value = defaultValue }
        if (value === false) { value = undefined }
        if (value === undefined) { return undefined }
        return resolveOutside(1, value)
      }
      userFunctionArgumentLookup._name = key
      return userFunctionArgumentLookup
    }

    // Inherited arg from an enclosing lambda: walk the call chain by name.
    // The wrapper aliases keyless slots to declared names at push time, so a
    // name lookup in each frame is sufficient (no positional fallback).
    if (inheritedArgs !== undefined && inheritedArgs[key] !== undefined) {
      let defaultValue = inheritedArgs[key]
      let inheritedCallsiteId = 'cs' + callsiteId++
      let inheritedLookup = (e,b,er,mods) => {
        let found = findInCallChainByKey(key)
        let value, depth
        if (found !== undefined) {
          value = found.context[key]
          depth = found.depth + 1
        } else {
          value = defaultValue
          depth = 1
        }
        if (value === false) { value = undefined } // No default arg either
        if (value === undefined) { return undefined }
        // Step out past every frame between us and the binding frame, so the
        // captured expression evaluates in the scope where it was captured.
        unPushCallContext(depth)
        if (typeof value === 'function' && value.isUserFunction && mods !== undefined) {
          mods.__functionContext = inheritedCallsiteId // Distinguish calls from different callsites for memoisation
          value = value(e,b,er,mods) // The arg holds a lambda and this is a call: pass the callsite args through
        } else {
          value = er(value,e,b)
        }
        unPopCallContext(depth)
        return value
      }
      // As above, walking the call chain by name the way the lookup itself does
      inheritedLookup._bindingSource = () => {
        let found = findInCallChainByKey(key)
        let value, depth
        if (found !== undefined) {
          value = found.context[key]
          depth = found.depth + 1
        } else {
          value = defaultValue
          depth = 1
        }
        if (value === false) { value = undefined }
        if (value === undefined) { return undefined }
        return resolveOutside(depth, value)
      }
      inheritedLookup._name = key
      return inheritedLookup
    }

    // Return a lookup function
    let state = {} // Create a state store for this parse instance
    let result
    let thisCallsiteId = 'cs' + callsiteId++
    if (interval === undefined && typeof vars.get(key) === 'function') { interval = vars.get(key).interval }
    let parseVarLookup = (event,b, evalRecurse, modifiers) => {
      // A live `let` binding is the innermost scope, so it shadows vars and builtins for the rest of
      // the chain (expression/let-node.js). Bindings hang off the event because that is the object
      // whose lifetime matches a chain's: a persistent fx chain re-reads its params every frame,
      // long after the chain was built. Handed back as it stands — a bound shader node or AudioNode
      // must not be walked by the eval below.
      if (event !== undefined && event !== null && event._lets !== undefined) {
        let bound = event._lets[key]
        if (bound !== undefined) { return bound }
      }
      let vr
      if (parseVarLookup.namespace) { // Get the var using a namespace
        let ns = vars.get(parseVarLookup.namespace)
        if (!!ns) { vr = ns[key] }
      } else {
        vr = vars.get(key)
      }
      // Dereference alias chains (eg `set lpf2 = lpf`): a stored value that is itself a bare
      // argless var lookup stands for its target, so callsite args must reach the target function
      let seenAliases
      while (typeof vr === 'function' && vr.isVarLookup && !vr.hasOwnArgs
          && vr.modifiers === undefined && vr.args === undefined && !vr.namespace) {
        let target = vars.get(vr._name)
        if (target === undefined) { break }
        if (seenAliases === undefined) { seenAliases = [] }
        if (target === vr || seenAliases.includes(target)) { vr = undefined; break } // Cyclic alias: fall through to the string value
        seenAliases.push(vr)
        vr = target
      }
      let v
      if (typeof vr === 'function' && vr.isVarFunction) { // Var function
        modifiers = modifiers || {}
        if (vr.dontEvalArgs) { // AudioNode functions cannot do per frame update if the args are already evalled
          Object.assign(modifiers, args)
        } else {
          Object.assign(modifiers, evalRecurse(args,event,b))
        }
        let piped = parseVarLookup.args !== undefined
        let pipeSlot = vr._pipeSlot || 0
        if (modifiers) {
          if (piped) {
            shiftPositionalArgs(modifiers, pipeSlot)
            modifiers['value'+(pipeSlot||'')] = parseVarLookup.args
          }
        } else {
          modifiers = parseVarLookup.args
        }
        if (vr.passCallsiteId && modifiers) {
          modifiers.__functionContext = thisCallsiteId // Add the id of this callsite as an extra arg, for memoisation
        }
        if (vr.wantsRawArgs && args !== undefined && Object.keys(args).length > 0) {
          // Some functions need the unevalled arg expressions as well as the evalled values; eg
          // visual node maths, where a non-node arg becomes a uniform re-evalled every frame.
          // Copy before shifting: the raw map is the parsed AST and must not be mutated. Guarded
          // on non-empty args so an argless call still leaves modifiers empty for the check below.
          modifiers.__rawArgs = piped ? shiftPositionalArgs(Object.assign({}, args), pipeSlot) : args
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
    result.isVarLookup = true
    result.hasOwnArgs = args !== undefined && args !== null && Object.keys(args).length > 0
    result.ownArgs = args // The unevalled callsite args, for >> to see what the call was already given
    if (typeof vars.get(key) === 'function' && vars.get(key)._chordPlaceholder) { result._chordPlaceholder = true } // For node vars: pass this through to prevent the node function getting evalled during chord expansion
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

  // A piped value (the LHS of `.` or `>>`) takes the first positional slot; existing positionals shift up
  vars.foo = (args) => [args.value, args.value1, args.value2]
  vars.foo.isVarFunction = true
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2,value1:3}, {})
  p.args = 1
  assert([1,2,3], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2}, {})
  p.args = 1
  assert([1,2,undefined], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  p.args = 1
  assert([1,undefined,undefined], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2,value1:3}, {}) // Not piped: no shift
  assert([2,3,undefined], p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  vars.foo = (args) => [args.value, args.to]
  vars.foo.isVarFunction = true
  p = varLookup(parseVar({str:'foo',idx:0}), {to:4}, {}) // Named args are not shifted
  p.args = 1
  assert([1,4], p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  // _pipeSlot: a user function declaring `in` somewhere other than first takes the piped value
  // there, so its own first positional arg is left alone (kal{5} is kal{shape:5})
  vars.foo = (args) => [args.value, args.value1, args.value2]
  vars.foo.isVarFunction = true
  vars.foo._pipeSlot = 1
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2}, {})
  p.args = 1
  assert([2,1,undefined], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2,value1:3}, {}) // Positionals from the slot on shift up
  p.args = 1
  assert([2,1,3], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), undefined, {}) // Fewer positionals than the slot: nothing to shift
  p.args = 1
  assert([undefined,1,undefined], p(ev(0,0),0,evalParamFrame))
  p = varLookup(parseVar({str:'foo',idx:0}), {value:2,value1:3}, {}) // Not piped: no shift
  assert([2,3,undefined], p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  // wantsRawArgs: the unevalled arg expressions are passed alongside the evalled values
  let rawSeen
  vars.foo = (args) => { rawSeen = args.__rawArgs; return 0 }
  vars.foo.isVarFunction = true
  vars.foo.wantsRawArgs = true
  let rawAst = () => 7
  let rawArgs = {value:rawAst}
  p = varLookup(parseVar({str:'foo',idx:0}), rawArgs, {})
  p(ev(0,0),0,evalParamFrame)
  assert(true, rawSeen.value === rawAst)
  p = varLookup(parseVar({str:'foo',idx:0}), rawArgs, {})
  p.args = 1
  p(ev(0,0),0,evalParamFrame)
  assert(true, rawSeen.value1 === rawAst) // Shifted in step with the evalled args
  assert(true, rawSeen.value === undefined)
  assert(true, rawArgs.value === rawAst) // The parsed AST map itself must not be mutated
  rawSeen = undefined
  p = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  p(ev(0,0),0,evalParamFrame)
  assert(undefined, rawSeen) // No args: nothing added, so the empty-modifiers check still works
  delete vars.foo

  // Alias (set foo2 = foo): callsite args must reach the target var function
  vars.foo = (args) => args.bar
  vars.foo.isVarFunction = true
  vars.foo2 = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  p = varLookup(parseVar({str:'foo2',idx:0}), {bar:3}, {})
  assert(3, p(ev(0,0),0,evalParamFrame))
  delete vars.foo
  delete vars.foo2

  // Alias of an alias
  vars.foo = (args) => args.bar
  vars.foo.isVarFunction = true
  vars.foo2 = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  vars.foo3 = varLookup(parseVar({str:'foo2',idx:0}), undefined, {})
  p = varLookup(parseVar({str:'foo3',idx:0}), {bar:3}, {})
  assert(3, p(ev(0,0),0,evalParamFrame))
  delete vars.foo
  delete vars.foo2
  delete vars.foo3

  // Cyclic alias must not blow the stack; falls back to the string value
  vars.foo = varLookup(parseVar({str:'foo2',idx:0}), undefined, {})
  vars.foo2 = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  p = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  assert('foo', p(ev(0,0),0,evalParamFrame))
  delete vars.foo
  delete vars.foo2

  // Self alias must not blow the stack either
  vars.foo = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  p = varLookup(parseVar({str:'foo',idx:0}), undefined, {})
  assert('foo', p(ev(0,0),0,evalParamFrame))
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


  // _bindingSource: the expression a lookup reads and the frame it is read in, resolved without
  // evaluating anything. draw/visualsynth/codegen.js keys uniform sharing on it, so it has to
  // agree with the eval path above about which expression is in play, and leave the call stack
  // exactly where it found it.
  let {pushCallContext,popCallContext} = require('player/callstack')
  let bound = () => 9
  let outerFrame = {}
  {
    let l = varLookup('sd', undefined, {}, undefined, {sd:0}) // A declared arg, default 0
    let callFrame = {sd:bound}
    pushCallContext(outerFrame)
    pushCallContext(callFrame)
    let src = l._bindingSource()
    assert(true, src.ast === bound) // The bound expression, uncalled
    assert(true, src.context === outerFrame) // read in the frame outside the call, where it was written
    assert(true, getCallContext() === callFrame) // and the stack is put back
    popCallContext(); popCallContext()
  }
  {
    let l = varLookup('sd', undefined, {}, undefined, {sd:0}) // Found by position, as noiseface{i,f,seed} passes it
    pushCallContext(outerFrame)
    pushCallContext({value:bound})
    assert(true, l._bindingSource().ast === bound)
    popCallContext(); popCallContext()
  }
  {
    let l = varLookup('sd', undefined, {}, undefined, {sd:7}) // Nothing passed: the declared default
    pushCallContext(outerFrame)
    pushCallContext({})
    assert({ast:7, context:outerFrame}, l._bindingSource())
    popCallContext(); popCallContext()
  }
  {
    let l = varLookup('sd', undefined, {}, undefined, {sd:false}) // No default either
    pushCallContext({})
    assert(undefined, l._bindingSource())
    popCallContext()
  }
  {
    let l = varLookup('sd', undefined, {}, undefined, {sd:0})
    assert(undefined, l._bindingSource()) // Outside any call there is no binding to name
  }
  {
    // A pass-through binding resolves to its root in one call: this is the shape lib/visual.limut's
    // noise stack has, where every `seed` is an arg bound to its caller's arg the whole way down.
    // Each hop unwinds one frame, so the root expression is named in the scope it was written in.
    let inner = varLookup('sd', undefined, {}, undefined, {sd:0}) // The innermost function's arg
    let outer = varLookup('sd', undefined, {}, undefined, {sd:0}) // Its caller's, which binds it
    pushCallContext(outerFrame) // where the root expression is written
    pushCallContext({sd:bound}) // the outer call: its sd is bound to that expression
    pushCallContext({sd:outer}) // the inner call: its sd is bound to the outer call's sd
    let src = inner._bindingSource()
    assert(true, src.ast === bound)
    assert(true, src.context === outerFrame)
    popCallContext(); popCallContext(); popCallContext()
  }
  {
    // An inherited arg (named by a lambda nested inside the one that declares it) walks the call
    // chain by name, and unwinds past every frame between, so the expression still resolves in the
    // scope it was captured in
    let l = varLookup('sd', undefined, {}, undefined, undefined, {sd:0})
    pushCallContext(outerFrame)
    pushCallContext({sd:bound})
    let between = {i:1} // an enclosed lambda that does not name sd itself
    pushCallContext(between)
    let src = l._bindingSource()
    assert(true, src.ast === bound)
    assert(true, src.context === outerFrame)
    assert(true, getCallContext() === between) // and the stack is put back
    popCallContext(); popCallContext(); popCallContext()
  }
  {
    let l = varLookup('sd', undefined, {}, undefined, undefined, {sd:5}) // Not in the chain: the default
    pushCallContext(outerFrame)
    pushCallContext({i:1})
    assert({ast:5, context:outerFrame}, l._bindingSource())
    popCallContext(); popCallContext()
  }
  {
    // Unwinding further than there are frames cannot throw and cannot corrupt the stack: sharing is
    // an optimisation, and giving up on it must never be able to break a build
    let l = varLookup('sd', undefined, {}, undefined, undefined, {sd:5})
    assert(undefined, l._bindingSource())
    assert(undefined, getCallContext())
  }

  console.log('Parse var tests complete')
  }
  
  return {
    parseVar: parseVar,
    varLookup: varLookup,
    isVarChar: isVarChar,
  }
})