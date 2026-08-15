'use strict'
define(function(require) {
  let {isShaderNode,naryShaderNodeWithInput} = require('draw/visualsynth/shader-node')

  // The visual half of the ?? and ?: operators (expression/operators.js): given a visual node as
  // the condition they compile into a GLSL mix() instead of choosing a branch, the same
  // dispatch-on-the-value rule the arithmetic operators (expression/shaderNodeOps.js) and the
  // maths functions (shader-maths.js) use.
  //
  //   cond ?? a ?: b   ->  mix(b, a, cond)         a where cond is true, b where it is false
  //   cond ?? a        ->  mix(input, a, cond)     the false side is whatever flows down the chain
  //
  // A shader has no branches, so both sides are always evaluated — unlike the scalar operators,
  // which short circuit. The condition is tested per component with notEqual against zero, so it
  // matches limut's scalar truthiness (any non zero value is true, negative included) and a
  // comparison, which already gives 1.0/0.0 per channel, passes straight through. That also means
  // the choice is made per channel: `#f00 ?? a ?: b` takes a for red and b for the rest.
  //
  // Else-if chains work because parsing is left associative: `c1??a ?: c2??b ?: c` arrives as
  // `((c1??a) ?: (c2??b)) ?: c`, so a branch carries a list of clauses rather than a single pair,
  // and ?: concatenates when its right hand side is itself a branch with no else of its own.
  //
  // Operands carry their raw unevalled AST alongside the evalled value, so a non-node operand
  // becomes a uniform re-evalled every frame rather than a constant frozen at event time.

  let isShaderBranch = (v) => isShaderNode(v) && v._shaderBranch !== undefined
  // A branch that has not been given its false side yet, ie one that ?: can still extend
  let isOpenBranch = (v) => isShaderBranch(v) && v._shaderBranch.els === undefined

  // Fold the clauses back to front over the false side, so the first clause is the outermost mix
  // and therefore wins — the order the scalar operators resolve in
  let branchShaderNode = (clauses, els) => {
    let operands = []
    clauses.forEach(c => { operands.push(c.cond); operands.push(c.then) })
    if (els !== undefined) { operands.push(els) }
    let node = naryShaderNodeWithInput((input, ...names) => {
      let expr = (els !== undefined) ? names[names.length-1] : input
      for (let i = clauses.length-1; i >= 0; i--) {
        expr = `mix(${expr}, ${names[i*2+1]}, vec4(notEqual(${names[i*2]}, vec4(0.0))))`
      }
      return expr
    }, operands)
    node._shaderBranch = {clauses: clauses, els: els}
    return node
  }

  // `cond ?? then` where cond evalled to a visual node. The then side is evalled here rather than
  // being left to the caller: with no branch in a shader it is always needed, and its value is
  // what says whether it is a node or wants a uniform.
  let shaderIfThen = (condRaw, condNode, thenRaw, e,b, evalRecurse) => {
    let then = {raw: thenRaw, value: evalRecurse(thenRaw, e,b)}
    return branchShaderNode([{cond: {raw: condRaw, value: condNode}, then: then}], undefined)
  }

  // `branch ?: els`. Undefined for anything that is not an extendable branch, so the caller falls
  // through to the ordinary meaning of ?: — in particular a plain visual node is simply a value
  // that is defined, so it is returned as it stands.
  let shaderOrElse = (branch, elseRaw, e,b, evalRecurse) => {
    if (!isOpenBranch(branch)) { return undefined }
    let els = {raw: elseRaw, value: evalRecurse(elseRaw, e,b)}
    // A branch on the right is the else-if case: its clauses carry on from ours, and its own false
    // side (still open) becomes the one the whole chain falls back to
    if (isOpenBranch(els.value)) {
      return branchShaderNode(branch._shaderBranch.clauses.concat(els.value._shaderBranch.clauses), undefined)
    }
    return branchShaderNode(branch._shaderBranch.clauses, els)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let mockCtx = () => {
    let ctx = { statements: [], uniforms: [] }
    ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
    ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
    return ctx
  }
  let node = (tag) => ({isShaderNode:true, build: (input, ctx) => ctx.addStatement(`${tag}(${input})`)})
  let ev = (raw) => raw // The stub evalRecurse: a test AST is its own value
  let ifThen = (cond, then, evalRecurse) => shaderIfThen(cond+'Raw', node(cond), then, {},0, evalRecurse || ev)
  let orElse = (branch, els, evalRecurse) => shaderOrElse(branch, els, {},0, evalRecurse || ev)
  let built = (n) => { // Build a branch on a fresh context, return the generated statements
    let ctx = mockCtx()
    n.build('v0', ctx)
    return ctx.statements
  }
  let emitted = (n) => { let s = built(n); return s[s.length-1] }

  // The plain ternary: a where the condition holds, b where it does not
  let ternary = orElse(ifThen('c', node('a')), node('b'))
  assert(['c(v0)', 'a(v0)', 'b(v0)', 'mix(v3, v2, vec4(notEqual(v1, vec4(0.0))))'], built(ternary))

  // With no ?: the false side is the value coming down the chain
  assert('mix(v0, v2, vec4(notEqual(v1, vec4(0.0))))', emitted(ifThen('c', node('a'))))

  // Else-if: the clauses concatenate and fold back to front, so the first one wins
  let elseIf = orElse(
    orElse(ifThen('c1', node('a')), 'c2Ast', (raw) => raw === 'c2Ast' ? ifThen('c2', node('b')) : raw),
    node('c'))
  assert('mix(mix(v5, v4, vec4(notEqual(v3, vec4(0.0)))), v2, vec4(notEqual(v1, vec4(0.0))))', emitted(elseIf))

  // Either branch may be a plain value, which becomes an animated uniform from its raw AST
  let aAst = () => 1/2
  let bAst = () => 1/4
  let ctx = mockCtx()
  orElse(ifThen('c', aAst), bAst).build('v0', ctx)
  assert(true, ctx.uniforms[0] === aAst) // The raw AST, so it keeps animating
  assert(true, ctx.uniforms[1] === bAst)
  assert('mix(u_vs1, u_vs0, vec4(notEqual(v1, vec4(0.0))))', ctx.statements[ctx.statements.length-1])

  // ?: only extends a branch that has no false side yet
  assert(undefined, orElse(node('a'), node('b'))) // A plain node is just a value that is defined
  assert(undefined, orElse(3, node('b')))
  assert(undefined, orElse(undefined, node('b')))
  assert(undefined, orElse(ternary, node('c'))) // Already has one: nothing left to fill in

  // A branch is an ordinary shader node otherwise, so eval-param and the operators leave it alone
  assert(true, isShaderNode(ternary))
  assert(true, isShaderBranch(ternary))
  assert(false, isShaderBranch(node('a')))
  assert(false, isOpenBranch(ternary))

  console.log('Shader branch tests complete')
  }

  return {
    shaderIfThen: shaderIfThen,
    shaderOrElse: shaderOrElse,
  }
})
