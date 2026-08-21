'use strict'
define(function(require) {
  let {makeShaderNode,isShaderNode,composeShaderNodes,naryShaderNode} = require('draw/visualsynth/shader-node')

  // The visual half of the repetition node functions in play/nodes/graph.js: given visual node
  // chains rather than audio ones, series/parallel/multitap/loop compile to GLSL instead of wiring
  // a Web Audio graph. Same dispatch-on-the-value rule as mix{} (shader-mix.js), the arithmetic
  // operators and the maths functions; graph.js decides, this file only emits.
  //
  //   series{{i}->chain, n}    ->  the chain n times over, unrolled: each repeat consumes the last
  //   parallel{{i}->chain, n}  ->  n copies of the chain from the same input, summed (as audio sums)
  //   multitap{{i}->chain, n}  ->  chained like series, but every stage's output summed
  //   loop{{i}->chain, n}      ->  a real GLSL for loop: the body emitted once, its output fed back
  //                                into its input each iteration
  //   loop{chain, n, sum:f}    ->  the same loop with a second accumulator: f of the carried value
  //                                totalled over the iterations, and that total handed on
  //
  // series, parallel and multitap are unrolled, so their index is an ordinary javascript number and
  // each repeat may differ in any way at all. loop rolls, so the body is emitted once whatever the
  // count is (which is what makes a big count affordable) and its index is a value in the shader:
  // usable in shader expressions, but not for anything structural.

  // Repeat the chain, each one consuming the last: exactly what >> does, so it is the same compose.
  let seriesShaderNode = (chains) => {
    return chains.reduce((a, b) => composeShaderNodes(a, b))
  }

  // Every copy builds from the same input (the operand rule naryShaderNode already follows) and
  // their outputs are summed, which is what connect() does with the parallel map on the audio side.
  let parallelShaderNode = (chains) => {
    if (chains.length === 1) { return chains[0] }
    return naryShaderNode((...copies) => copies.join(' + '), chains.map(c => ({raw: undefined, value: c})))
  }

  // Chained like series, but each stage's output is kept and they are all summed: a tapped line.
  let multitapShaderNode = (chains) => {
    return makeShaderNode((input, ctx) => {
      let v = input
      let taps = chains.map(c => { v = c.build(v, ctx); return v })
      if (taps.length === 1) { return taps[0] }
      return ctx.addStatement(taps.join(' + '))
    })
  }

  // The loop's iteration index, as a value in the chain. Splatted across all four components, the
  // same convention a single channel read (in.v) uses, so it behaves as a scalar in arithmetic.
  //
  // The counter's name comes from a ctx counter during the build walk, but the node itself is made
  // at event time, when the body lambda is called — so the name arrives through a box the loop
  // fills in around the body's build. Builds are one depth-first walk with nothing interleaved, so
  // a nested loop simply saves and restores its own box in turn.
  let loopIndexNode = () => {
    let box = {name: undefined}
    let node = makeShaderNode((input, ctx) => ctx.addStatement(`vec4(float(${box.name}))`))
    node._loopIndexBox = box
    return node
  }

  // A fold over no terms at all: what a summing loop of zero iterations comes to.
  let zeroShaderNode = () => {
    return makeShaderNode((input, ctx) => ctx.addStatement('vec4(0.0)'))
  }

  // A real GLSL for loop. The value flowing in becomes a mutable accumulator declared before the
  // loop; each iteration builds the body from it and assigns the body's output back, so the chain
  // feeds back into itself the way an audio loop{} does. The count is baked in as a literal: it is
  // structural (it settles at event time and is part of the generated source, ie the cache key)
  // rather than an animatable uniform.
  //
  // A sum chain gives it a *second* accumulator: a total, declared alongside the carried value and
  // added to once per iteration, which becomes what the loop hands on. That is the one thing the
  // carried value cannot do for itself, since it is a single vec4 and any whole-vector op in the
  // body wipes out anything riding in a spare channel of it. The sum is built from the carried
  // value *before* the body advances it, so the first term is the value as it arrives and an octave
  // sum lines up with parallel{} term for term; the price is that the last body application is dead.
  //
  // Both are built inside one captureBlock, the sum first so its statements lead the block. The +=
  // sits after all of them rather than interleaved: the body only ever assigns to fresh vNs, so acc
  // does not move until the write-back at the end of the block, and one block keeps sum and body
  // sharing the emit-once memo.
  let loopShaderNode = (body, count, indexNode, sum) => {
    return makeShaderNode((input, ctx) => {
      let acc = ctx.addStatement(input) // The loop carried value: declared outside, assigned inside
      let total = sum !== undefined ? ctx.addStatement('vec4(0.0)') : undefined
      let name = ctx.loopVar()
      let box = indexNode !== undefined ? indexNode._loopIndexBox : undefined
      let saved = box !== undefined ? box.name : undefined
      if (box !== undefined) { box.name = name }
      let block, sumOut
      try {
        block = ctx.captureBlock(() => {
          if (sum !== undefined) { sumOut = sum.build(acc, ctx) }
          return body.build(acc, ctx)
        })
      } finally {
        if (box !== undefined) { box.name = saved }
      }
      ctx.addRaw(`for (int ${name} = 0; ${name} < ${count}; ${name}++) {`)
      block.statements.forEach(s => ctx.addRaw('  ' + s))
      if (total !== undefined) { ctx.addRaw(`  ${total} += ${sumOut};`) }
      ctx.addRaw(`  ${acc} = ${block.out};`)
      ctx.addRaw(`}`)
      return total !== undefined ? total : acc
    })
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let {makeContext} = require('draw/visualsynth/codegen')
  let node = (tag) => makeShaderNode((input, ctx) => ctx.addStatement(`${tag}(${input})`))
  let statements = (n, input) => { // Build n on a real context and return the statements it emitted
    let ctx = makeContext()
    ctx.out = n.build(input || ctx.rootInput, ctx)
    return ctx
  }

  // series: each repeat consumes the one before it
  let s = statements(seriesShaderNode([node('a'), node('b'), node('c')]))
  assert(['vec4 v1 = a(v0);', 'vec4 v2 = b(v1);', 'vec4 v3 = c(v2);'], s.statements)
  assert('v3', s.out)
  assert(['vec4 v1 = a(v0);'], statements(seriesShaderNode([node('a')])).statements) // One repeat is just the chain

  // parallel: every copy builds from the same input, and the copies are summed
  let p = statements(parallelShaderNode([node('a'), node('b'), node('c')]))
  assert(['vec4 v1 = a(v0);', 'vec4 v2 = b(v0);', 'vec4 v3 = c(v0);', 'vec4 v4 = v1 + v2 + v3;'], p.statements)
  assert('v4', p.out)
  assert(['vec4 v1 = a(v0);'], statements(parallelShaderNode([node('a')])).statements) // One copy sums nothing

  // multitap: chained like series, but every stage's output is summed
  let m = statements(multitapShaderNode([node('a'), node('b'), node('c')]))
  assert(['vec4 v1 = a(v0);', 'vec4 v2 = b(v1);', 'vec4 v3 = c(v2);', 'vec4 v4 = v1 + v2 + v3;'], m.statements)
  assert('v4', m.out)
  assert(['vec4 v1 = a(v0);'], statements(multitapShaderNode([node('a')])).statements) // One stage is its own tap

  // loop: the body is emitted once, inside a for block, with the value fed back through it
  let l = statements(loopShaderNode(node('a'), 8))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 8; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '}'], l.statements)
  assert('v1', l.out) // The accumulator is what the rest of the chain sees

  // loop: the index is a value in the body, named after the counter of the loop it belongs to
  let ix = loopIndexNode()
  let body = composeShaderNodes(ix, node('a'))
  let li = statements(loopShaderNode(body, 4, ix))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 4; l_i0++) {',
    '  vec4 v2 = vec4(float(l_i0));',
    '  vec4 v3 = a(v2);',
    '  v1 = v3;',
    '}'], li.statements)
  assert(undefined, ix._loopIndexBox.name) // Restored afterwards

  // loop: nested loops each get their own counter and their own index
  let inner = loopIndexNode()
  let outer = loopIndexNode()
  let nested = statements(loopShaderNode(loopShaderNode(composeShaderNodes(inner, outer), 2, inner), 3, outer))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v2 = v1;',
    '  for (int l_i1 = 0; l_i1 < 2; l_i1++) {',
    '    vec4 v3 = vec4(float(l_i1));',
    '    vec4 v4 = vec4(float(l_i0));',
    '    v2 = v4;',
    '  }',
    '  v1 = v2;',
    '}'], nested.statements) // The outer loop's counter is allocated first, and the inner sees both

  // loop with a sum: a second accumulator, totalled before the body advances the carried value
  let sm = statements(loopShaderNode(node('a'), 3, undefined, node('f')))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(0.0);',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v3 = f(v1);',
    '  vec4 v4 = a(v1);',
    '  v2 += v3;',
    '  v1 = v4;',
    '}'], sm.statements)
  assert('v2', sm.out) // The total is what the rest of the chain sees, not the carried value

  // loop with a sum: body and sum share one index, and its box is restored afterwards
  let si = loopIndexNode()
  let sBody = composeShaderNodes(si, node('a'))
  let sSum = composeShaderNodes(si, node('f'))
  let sl = statements(loopShaderNode(sBody, 2, si, sSum))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(0.0);',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v3 = vec4(float(l_i0));',
    '  vec4 v4 = f(v3);',
    '  vec4 v5 = a(v3);',
    '  v2 += v4;',
    '  v1 = v5;',
    '}'], sl.statements) // The index emits once: sum and body share the emit-once memo within the block
  assert(undefined, si._loopIndexBox.name)

  // loop with a sum: the index may be used by the sum alone, and still gets its counter's name
  let so = loopIndexNode()
  let sl2 = statements(loopShaderNode(node('a'), 2, so, composeShaderNodes(so, node('f'))))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(0.0);',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v3 = vec4(float(l_i0));',
    '  vec4 v4 = f(v3);',
    '  vec4 v5 = a(v1);',
    '  v2 += v4;',
    '  v1 = v5;',
    '}'], sl2.statements)

  // loop with a sum: nests, each loop with its own counter and its own pair of accumulators
  let sn = statements(loopShaderNode(loopShaderNode(node('a'), 2, undefined, node('f')), 3, undefined, node('g')))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(0.0);',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v3 = g(v1);',
    '  vec4 v4 = v1;',
    '  vec4 v5 = vec4(0.0);',
    '  for (int l_i1 = 0; l_i1 < 2; l_i1++) {',
    '    vec4 v6 = f(v4);',
    '    vec4 v7 = a(v4);',
    '    v5 += v6;',
    '    v4 = v7;',
    '  }',
    '  v2 += v3;',
    '  v1 = v5;',
    '}'], sn.statements) // The inner loop's total is what the outer body hands back

  // a fold over no iterations at all is zero, not the value that arrived
  assert(['vec4 v1 = vec4(0.0);'], statements(zeroShaderNode()).statements)

  // A node built inside the loop body is not reused outside it: its variable is out of scope there
  let shared = node('a')
  let ctx = makeContext()
  let outOfBlock = composeShaderNodes(loopShaderNode(shared, 2), shared)
  outOfBlock.build(ctx.rootInput, ctx)
  assert(['vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '}',
    'vec4 v3 = a(v1);'], ctx.statements) // Emitted again outside, as its own v3

  // A node built before the loop and used again inside it on the same input IS reused: an outer
  // variable is in scope within the block
  let before = node('a')
  ctx = makeContext()
  makeShaderNode((input, c) => {
    let v = before.build(input, c)
    loopShaderNode(makeShaderNode((i2, c2) => before.build(input, c2)), 2).build(v, c)
    return v
  }).build(ctx.rootInput, ctx)
  assert(1, ctx.statements.filter(st => st.includes('a(v0)')).length)

  console.log('Shader repeat tests complete')
  }

  return {
    seriesShaderNode: seriesShaderNode,
    parallelShaderNode: parallelShaderNode,
    multitapShaderNode: multitapShaderNode,
    loopIndexNode: loopIndexNode,
    loopShaderNode: loopShaderNode,
    zeroShaderNode: zeroShaderNode,
  }
})
