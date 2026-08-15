'use strict';
define(function(require) {
  let lookupOp = require('expression/lookupOp')
  let connectOp = require('expression/connectOp')
  let {connectableAdd,connectableSub,connectableMul,connectableDiv} = require('expression/connectableOps')
  let {shaderNodeOps} = require('expression/shaderNodeOps')
  let {isShaderNode} = require('draw/visualsynth/shader-node')
  let {shaderIfThen,shaderOrElse} = require('draw/visualsynth/shader-branch')

  let defaultUndefined = (op, l,r) => {
    if (l === undefined) { l = 0 }
    if (r === undefined) { r = 0 }
    let result = op(l,r)
    if (typeof result === 'string') { return result }
    return !Number.isFinite(result) ? 0 : result // Don't allow infinities
  }

  let comparison = (op) => {
    let comparisonOp = (l,r,e,b,er) => {
      return op(l,r) ? 1 : 0
    }
    return comparisonOp
  }

  // A visual node condition has no branch to take, so ?? and ?: compile into a GLSL mix instead of
  // choosing a side (see draw/visualsynth/shader-branch.js). These two operators eval their own
  // operands (doNotEvalArgs), so the dispatch lives here rather than in the shaderNodeOp table that
  // eval-operator.js applies to the already evalled operands of the arithmetic operators.
  let ifThenOp = (l,r,event,b,evalRecurse) => {
    if (l === undefined) { return undefined }
    if (Array.isArray(l)) { return l.length > 0 ? r : undefined }
    let el = (typeof l === 'function') ? evalRecurse(l, event,b) : l
    if (isShaderNode(el)) { return shaderIfThen(l, el, r, event,b, evalRecurse) }
    return el ? r : undefined
  }

  let orElseOp = (l,r,event,b,evalRecurse) => {
    if (l === undefined) { return r }
    let el = (typeof l === 'function') ? evalRecurse(l, event,b) : l
    let branch = shaderOrElse(el, r, event,b, evalRecurse) // Undefined unless el is a ?? awaiting its false side
    if (branch !== undefined) { return branch }
    if (el === undefined) { return r }
    return el
  }

  let concatOp = (l,r) => {
    if (l === undefined) { return [r] }
    if (r === undefined) { return [l] }
    if (Array.isArray(l)) {
      return l.concat(r)
    }
    if (Array.isArray(r)) {
      return [l].concat(r)
    }
    return [l,r]
  }

  let operators = {
    '+': (l,r)=>defaultUndefined((l,r)=>l+r, l,r),
    '-': (l,r)=>defaultUndefined((l,r)=>l-r, l,r),
    '*': (l,r)=>defaultUndefined((l,r)=>l*r, l,r),
    '/': (l,r)=>defaultUndefined((l,r)=>(l/r), l,r),
    '%': (l,r)=>defaultUndefined((l,r)=>l%r, l,r),
    '^': (l,r)=>defaultUndefined((l,r)=>Math.pow(l,r), l,r),

    '==': comparison((l,r)=>l==r),
    '!=': comparison((l,r)=>l!=r),
    '<=': comparison((l,r)=>l<=r),
    '>=': comparison((l,r)=>l>=r),
    '<': comparison((l,r)=>l<r),
    '>': comparison((l,r)=>l>r),

    '|': concatOp,
    '>>': connectOp,
    '.': lookupOp,
    '??': ifThenOp,
    '?:': orElseOp,
  }
  operators['|'].raw = true
  operators['>>'].raw = true
  operators['>>'].doNotEvalArgs = true
  operators['.'].raw = true
  operators['.'].doNotEvalArgs = true
  operators['?:'].raw = true
  operators['?:'].doNotEvalArgs = true
  operators['??'].raw = true
  operators['??'].doNotEvalArgs = true
  operators['+'].connectableOp = connectableAdd
  operators['-'].connectableOp = connectableSub
  operators['*'].connectableOp = connectableMul
  operators['/'].connectableOp = connectableDiv
  // Arithmetic and comparisons compile into GLSL when either side is a visual synth node
  for (let k in shaderNodeOps) { operators[k].shaderNodeOp = shaderNodeOps[k] }
  // As do ?? and ?:, but from inside the ops themselves; the flag is for eval-operator.js
  operators['??'].shaderBranchOp = true
  operators['?:'].shaderBranchOp = true

  operators['*'].segmentPowerCombine = 'add'
  operators['/'].segmentPowerCombine = 'add'
  operators['%'].segmentPowerCombine = 'force3'
  operators['^'].segmentPowerCombine = 'force3'
  operators['=='].segmentPowerCombine = 'force3'
  operators['!='].segmentPowerCombine = 'force3'
  operators['<'].segmentPowerCombine = 'force3'
  operators['>'].segmentPowerCombine = 'force3'
  operators['<='].segmentPowerCombine = 'force3'
  operators['>='].segmentPowerCombine = 'force3'

  let precedence = { // MUST ALL BE > 0
    '.':1,
    '|':2,
    '^':3,
    '%':4, '/':4, '*':4,
    '-':5, '+':5,
    '==':6, '!=':6, '<=':6, '>=':6, '<':6, '>':6,
    '>>':7,
    '??':8,
    '?:':9,
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let er = v=>v
    
    assert(3, operators['+'](1,2))
    assert('12', operators['+']('1','2'))
    assert(1, operators['+'](1,undefined))
    assert(2, operators['+'](undefined,2))
    assert(0, operators['+'](undefined,undefined))

    assert(6, operators['*'](2,3))
    assert(0, operators['*'](2,undefined))
    assert(0, operators['*'](undefined,3))
    assert(0, operators['*'](undefined,undefined))

    assert(2/3, operators['/'](2,3))
    assert(0, operators['/'](2,undefined))
    assert(0, operators['/'](undefined,3))
    assert(0, operators['/'](undefined,undefined))

    assert(1, operators['%'](3,2))
    assert(0, operators['%'](2,undefined))
    assert(0, operators['%'](undefined,3))
    assert(0, operators['%'](undefined,undefined))

    assert(8, operators['^'](2,3))
    assert(0, operators['^'](-1,1/2))
    assert(1, operators['^'](2,undefined))
    assert(0, operators['^'](undefined,3))
    assert(1, operators['^'](undefined,undefined))

    assert([1,2,3,4], concatOp([1,2], [3,4]))
    assert([1,2,3], concatOp([1,2], 3))
    assert([1,3,4], concatOp(1, [3,4]))
    assert([1,2], concatOp(1, 2))
    assert([1], concatOp(1, undefined))

    assert(1, orElseOp(1, 2, {},0,v=>v))
    assert(1, orElseOp(1, undefined, {},0,v=>v))
    assert(2, orElseOp(undefined, 2, {},0,v=>v))
    assert(undefined, orElseOp(undefined, undefined, {},0,v=>v))
    assert(0, orElseOp(0, 2, {},0,v=>v))

    assert(2, ifThenOp(1, 2, {},0,v=>v))
    assert(undefined, ifThenOp(1, undefined, {},0,v=>v))
    assert(undefined, ifThenOp(0, 2, {},0,v=>v))
    assert(undefined, ifThenOp(undefined, undefined, {},0,v=>v))

    { // A visual node condition compiles into a mix instead of choosing a side
      let node = (tag) => ({isShaderNode:true, build: (input, ctx) => ctx.addStatement(`${tag}(${input})`)})
      let mockCtx = () => {
        let ctx = { statements: [], uniforms: [] }
        ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
        ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
        return ctx
      }
      let emitted = (v) => { let ctx = mockCtx(); v.build('v0', ctx); return ctx.statements[ctx.statements.length-1] }
      let cond = node('c')
      let condAst = () => cond // The left operand arrives unevalled, as doNotEvalArgs makes it
      let branch = ifThenOp(condAst, node('a'), {},0, v=>(typeof v === 'function' ? v() : v))
      assert(true, branch.isShaderNode)
      assert('mix(v0, v2, vec4(notEqual(v1, vec4(0.0))))', emitted(branch)) // No else: the incoming value
      assert('mix(v3, v2, vec4(notEqual(v1, vec4(0.0))))',
        emitted(orElseOp(branch, node('b'), {},0, v=>v)))
      // Scalar conditions are untouched, even where a branch is a visual node
      assert(true, ifThenOp(1, node('a'), {},0, v=>v).isShaderNode)
      assert(undefined, ifThenOp(0, node('a'), {},0, v=>v))
      assert(true, orElseOp(node('a'), node('b'), {},0, v=>v).isShaderNode) // A plain node is defined: kept
    }

    assert(undefined, lookupOp())
    assert(1, lookupOp(1, undefined))
    assert(undefined, lookupOp(undefined, 1))
    assert(2, lookupOp([1,2], 1, {},0,er))
    assert(2, lookupOp([1,2], 1.5, {},0,er))
    assert(1, lookupOp([1,2], 2, {},0,er))
    assert([2,3], lookupOp([1,[2,3]], 1, {},0,er))
    assert(1, lookupOp({v:1}, 'v', {},0,er))
    assert({b:1}, lookupOp({a:{b:1}}, 'a', {},0,er))
    assert(1, lookupOp(lookupOp({a:{b:1}}, 'a', {},0,er), 'b', {},0,er))

    assert(0, comparison((l,r)=>l==r)(1, 2))
    assert(1, comparison((l,r)=>l==r)(2, 2))
    assert(1, comparison((l,r)=>l!=r)(1, 2))
    assert(0, comparison((l,r)=>l!=r)(2, 2))

    console.log('operators tests complete')
  }
  return {
    operators: operators,
    precedence: precedence,
  }
})