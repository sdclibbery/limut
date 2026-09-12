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
  //   loop{chain, n, map:f, fold:g}
  //                            ->  the same loop with a fold running alongside the carried value
  //   loop{chain, n, until:c}  ->  the same loop with an early exit: c is tested after the body
  //   loop{chain, n, carry:{...}}
  //                            ->  the same loop with named values carried alongside, assigned by a
  //                                let{} in the body and still in scope after the loop
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

  // A loop index, as a value in the chain. Splatted across all four components, the same convention
  // a single channel read (in.v) uses, so it behaves as a scalar in arithmetic.
  //
  // The box holds a GLSL *expression* rather than a bare counter name, because the two indices a
  // folding loop hands out differ: the body's is the counter itself, where a fold term's is one
  // past it (the term taken after body application i belongs to value i+1 of the trajectory) and is
  // the literal 0 for the seed term built before the loop. The expression only exists during the
  // build walk, but the node itself is made at event time, when the lambda is called — so it
  // arrives through the box. Builds are one depth-first walk with nothing interleaved, so a nested
  // loop simply saves and restores its own box in turn.
  let loopIndexNode = () => {
    let box = {expr: undefined}
    let node = makeShaderNode((input, ctx) => ctx.addStatement(`vec4(float(${box.expr}))`))
    node._loopIndexBox = box
    return node
  }

  // The fold's accumulator, as a value a combiner can name (fold:{a,v}->min{a,v}). Emits no
  // statement and hands its variable straight back, which is safe for the same reason
  // implicitInputNode is: a build input is always a plain variable name, never a compound
  // expression. The name arrives through a box, as a loop index's expression does.
  let loopAccNode = () => {
    let box = {name: undefined}
    let node = makeShaderNode((input, ctx) => box.name)
    node._loopAccBox = box
    return node
  }

  // A real GLSL for loop. The value flowing in becomes a mutable accumulator declared before the
  // loop; each iteration builds the body from it and assigns the body's output back, so the chain
  // feeds back into itself the way an audio loop{} does. The count is baked in as a literal: it is
  // structural (it settles at event time and is part of the generated source, ie the cache key)
  // rather than an animatable uniform.
  //
  // fold gives it a *second* accumulator: a running total declared alongside the carried value,
  // which becomes what the loop hands on. That is the one thing the carried value cannot do for
  // itself, since it is a single vec4 and any whole-vector op in the body wipes out anything riding
  // in a spare channel of it. {map, combine, accNode, termIndex}:
  //
  //   map      each value the loop passes through, mapped to a term of the fold. Absent, the term
  //            is the value itself.
  //   combine  how a term joins the total. Absent, the total is a sum (+=).
  //
  // The total is *seeded with the first term* — map of the value as it arrives, before any body
  // application — and then folds in map of the body's output once per iteration. So count body
  // applications give count+1 terms, one at every value the loop visits: nothing is dead (the old
  // sum: took its term before the body, which left the last body application unused), and there is
  // no identity to supply, since a reduce over a non-empty sequence needs none.
  //
  // The seed is built in a captureBlock of its own purely to isolate its memo: it and the body see
  // different index expressions, so a node reached with the same input in both must emit twice
  // rather than collapsing onto one variable. Its statements are then spliced straight out, since
  // they belong outside the loop. The fold assignment and the write-back to the carried value are
  // emitted inside the block, in place, so a combiner's statements sit between the term and the
  // assignment that reads them.
  //
  // until gives it an early exit: {test, index}, a condition emitted at the *bottom* of the block,
  // after the write-back, breaking out of the loop when it is true. So the body always runs at
  // least once and at most count times, and a march can stop at a hit or at the far plane instead
  // of paying every step. Testing after the body rather than before it is what lets the condition
  // name the body's let{} bindings, since ctx.lets is filled during the build walk and the block's
  // copy is still live at that point - so the distance the step just computed can be tested without
  // stashing it in a spare channel. Truthiness is the one ?? uses (shader-branch.js): any component
  // non zero is true. With a fold the break lands after that step's term has joined the total, so
  // the terms stay one at every value the loop visits.
  //
  // This is the only branch the generated shader has. A GPU runs fragments in lockstep groups, so
  // it saves work per group rather than per pixel - which is still most of it for the large
  // contiguous runs of background and of early hits a march produces.
  //
  // carry gives it any number of *named* accumulators: [{name, init}] in the order they were
  // declared, each a variable declared before the loop and left in ctx.carried, so a let{} of that
  // name in the body assigns it in place (expression/let-node.js) rather than naming a new variable
  // that would go out of scope at the closing brace. That is what a march needs and neither of the
  // other two can do: the carried value is one vec4 whose spare channels the first whole-vector op
  // in the body wipes out, and the fold hands its total on rather than leaving it somewhere to be
  // read - so a point and a distance can be stepped each iteration and a material id picked up at
  // the hit and read by the shading *after* the loop.
  //
  // An init is built from the value arriving at the loop, in a captureBlock whose statements are
  // spliced straight back out - the fold seed's trick at the same place and for the same reason,
  // to keep its memo clear of the body's. ctx.lets and ctx.carried are set outside the block, so
  // both survive it; ctx.carried is restored by the enclosing block in lockstep with ctx.lets, so a
  // nested loop's carried names do not leak out of the body they were declared in.
  let loopShaderNode = (body, count, bodyIndex, fold, until, carry) => {
    let map = fold !== undefined ? fold.map : undefined
    let combine = fold !== undefined ? fold.combine : undefined
    let bodyBox = bodyIndex !== undefined ? bodyIndex._loopIndexBox : undefined
    let termBox = fold !== undefined && fold.termIndex !== undefined ? fold.termIndex._loopIndexBox : undefined
    let accBox = fold !== undefined && fold.accNode !== undefined ? fold.accNode._loopAccBox : undefined
    let untilBox = until !== undefined && until.index !== undefined ? until.index._loopIndexBox : undefined
    return makeShaderNode((input, ctx) => {
      let acc = ctx.addStatement(input) // The loop carried value: declared outside, assigned inside
      let savedBody = bodyBox !== undefined ? bodyBox.expr : undefined
      let savedTerm = termBox !== undefined ? termBox.expr : undefined
      let savedAcc = accBox !== undefined ? accBox.name : undefined
      let savedUntil = untilBox !== undefined ? untilBox.expr : undefined
      let termAt = (v) => map === undefined ? v : map.build(v, ctx)
      let total
      try {
        if (carry !== undefined) {
          carry.forEach(c => {
            let init = ctx.captureBlock(() => c.init.build(acc, ctx))
            init.statements.forEach(s => ctx.addRaw(s))
            let v = ctx.addStatement(init.out)
            ctx.lets[c.name] = v
            ctx.carried[c.name] = v
          })
        }
        if (fold !== undefined) {
          if (termBox !== undefined) { termBox.expr = '0' } // The seed term is the value before the loop
          let seed = ctx.captureBlock(() => termAt(acc))
          seed.statements.forEach(s => ctx.addRaw(s))
          total = ctx.addStatement(seed.out)
          if (accBox !== undefined) { accBox.name = total }
        }
        if (count >= 1) {
          let name = ctx.loopVar()
          if (bodyBox !== undefined) { bodyBox.expr = name }
          if (termBox !== undefined) { termBox.expr = name + ' + 1' }
          if (untilBox !== undefined) { untilBox.expr = name + ' + 1' } // The value it tests is the one after this step, as a term's is
          let block = ctx.captureBlock(() => {
            let out = body.build(acc, ctx)
            if (fold !== undefined) {
              let term = termAt(out)
              ctx.addRaw(combine === undefined ? `${total} += ${term};` : `${total} = ${combine.build(term, ctx)};`)
            }
            // A body that only assigns carried values (a march step) hands its input straight back,
            // and `acc = acc;` is noise in the generated source
            if (out !== acc) { ctx.addRaw(`${acc} = ${out};`) }
            if (until !== undefined) {
              // Built from the body's output rather than from acc: the same value at this point,
              // but a variable this iteration wrote, where acc is one the body has already built
              // from while it held the *previous* value. Building the condition from acc would let
              // the memo (ctx.built) hand back one of those stale variables for a node the two have
              // in common, which is the same hazard the seed term's captureBlock guards against.
              ctx.addRaw(`if (any(notEqual(${until.test.build(out, ctx)}, vec4(0.0)))) { break; }`)
            }
          })
          ctx.addRaw(`for (int ${name} = 0; ${name} < ${count}; ${name}++) {`)
          block.statements.forEach(s => ctx.addRaw('  ' + s))
          ctx.addRaw(`}`)
        }
      } finally {
        if (bodyBox !== undefined) { bodyBox.expr = savedBody }
        if (termBox !== undefined) { termBox.expr = savedTerm }
        if (accBox !== undefined) { accBox.name = savedAcc }
        if (untilBox !== undefined) { untilBox.expr = savedUntil }
      }
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

  // loop: the body's index is the counter itself, named after the loop it belongs to
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
  assert(undefined, ix._loopIndexBox.expr) // Restored afterwards

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

  // loop with a map: the total is seeded with the first term, before the loop, and a term is taken
  // from the body's output every iteration - count+1 terms in all, and no dead body application
  let fm = statements(loopShaderNode(node('a'), 3, undefined, {map: node('f')}))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = f(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v4 = a(v1);',
    '  vec4 v5 = f(v4);',
    '  v3 += v5;',
    '  v1 = v4;',
    '}'], fm.statements)
  assert('v3', fm.out) // The total is what the rest of the chain sees, not the carried value

  // loop with a combiner: it builds from the term and reads the total through the accumulator node,
  // and its statements land between the term and the assignment that consumes them
  let an = loopAccNode()
  let combine = makeShaderNode((input, ctx) => ctx.addStatement(`h(${an.build(input, ctx)}, ${input})`))
  let fc = statements(loopShaderNode(node('a'), 2, undefined, {map: node('f'), combine: combine, accNode: an}))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = f(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v4 = a(v1);',
    '  vec4 v5 = f(v4);',
    '  vec4 v6 = h(v3, v5);',
    '  v3 = v6;',
    '  v1 = v4;',
    '}'], fc.statements)
  assert(undefined, an._loopAccBox.name) // Restored afterwards

  // loop with a fold but no map: the term is the carried value itself
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = v1;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v3 = a(v1);',
    '  v2 += v3;',
    '  v1 = v3;',
    '}'], statements(loopShaderNode(node('a'), 2, undefined, {})).statements)

  // loop: the term's index is 0 for the seed and one past the counter inside the loop, so it names
  // which value of the trajectory the term came from
  let ti = loopIndexNode()
  let ft = statements(loopShaderNode(node('a'), 2, undefined, {map: composeShaderNodes(ti, node('f')), termIndex: ti}))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(float(0));',
    'vec4 v3 = f(v2);',
    'vec4 v4 = v3;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v5 = a(v1);',
    '  vec4 v6 = vec4(float(l_i0 + 1));',
    '  vec4 v7 = f(v6);',
    '  v4 += v7;',
    '  v1 = v5;',
    '}'], ft.statements)
  assert(undefined, ti._loopIndexBox.expr) // Restored afterwards

  // loop: the body's index and the term's are separate nodes, so the body's stays zero based
  let bi2 = loopIndexNode()
  let ti2 = loopIndexNode()
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(float(0));',
    'vec4 v3 = f(v2);',
    'vec4 v4 = v3;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v5 = vec4(float(l_i0));',
    '  vec4 v6 = a(v5);',
    '  vec4 v7 = vec4(float(l_i0 + 1));',
    '  vec4 v8 = f(v7);',
    '  v4 += v8;',
    '  v1 = v6;',
    '}'], statements(loopShaderNode(composeShaderNodes(bi2, node('a')), 2, bi2,
      {map: composeShaderNodes(ti2, node('f')), termIndex: ti2})).statements)

  // loop: the seed's build cannot share a memo with the body's, or a node that reaches the same
  // input in both (here the index, read off the root) would collapse onto one variable and the term
  // inside the loop would read the seed's index
  let ti3 = loopIndexNode()
  let rootMap = makeShaderNode((input, ctx) => ctx.addStatement(`f(${ti3.build(ctx.rootInput, ctx)})`))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(float(0));',
    'vec4 v3 = f(v2);',
    'vec4 v4 = v3;',
    'for (int l_i0 = 0; l_i0 < 1; l_i0++) {',
    '  vec4 v5 = a(v1);',
    '  vec4 v6 = vec4(float(l_i0 + 1));',
    '  vec4 v7 = f(v6);',
    '  v4 += v7;',
    '  v1 = v5;',
    '}'], statements(loopShaderNode(node('a'), 1, undefined, {map: rootMap, termIndex: ti3})).statements)

  // loop with a fold: nests, each loop with its own counter and its own pair of accumulators
  let fn = statements(loopShaderNode(loopShaderNode(node('a'), 2, undefined, {map: node('f')}), 2, undefined, {map: node('g')}))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = g(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v4 = v1;',
    '  vec4 v5 = f(v4);',
    '  vec4 v6 = v5;',
    '  for (int l_i1 = 0; l_i1 < 2; l_i1++) {',
    '    vec4 v7 = a(v4);',
    '    vec4 v8 = f(v7);',
    '    v6 += v8;',
    '    v4 = v7;',
    '  }',
    '  vec4 v9 = g(v6);',
    '  v3 += v9;',
    '  v1 = v6;',
    '}'], fn.statements) // The inner loop's total is what the outer body hands back

  // no iterations at all: with a fold, just the seed term; without one, the value passes through
  let f0 = statements(loopShaderNode(node('a'), 0, undefined, {map: node('f')}))
  assert(['vec4 v1 = v0;', 'vec4 v2 = f(v1);', 'vec4 v3 = v2;'], f0.statements)
  assert('v3', f0.out)
  let z0 = statements(loopShaderNode(node('a'), 0))
  assert(['vec4 v1 = v0;'], z0.statements)
  assert('v1', z0.out)

  // loop with an early exit: the test is emitted at the bottom of the block, after the write-back,
  // so it reads the value this step produced
  let u = statements(loopShaderNode(node('a'), 8, undefined, undefined, {test: node('c')}))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 8; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '  vec4 v3 = c(v2);',
    '  if (any(notEqual(v3, vec4(0.0)))) { break; }',
    '}'], u.statements)
  assert('v1', u.out) // Still the carried value: a break changes when the loop stops, not what it hands on

  // loop with an early exit and a fold: the break lands after the term has joined the total, so the
  // terms stay one at every value the loop visits
  let uf = statements(loopShaderNode(node('a'), 4, undefined, {map: node('f')}, {test: node('c')}))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = f(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 4; l_i0++) {',
    '  vec4 v4 = a(v1);',
    '  vec4 v5 = f(v4);',
    '  v3 += v5;',
    '  v1 = v4;',
    '  vec4 v6 = c(v4);',
    '  if (any(notEqual(v6, vec4(0.0)))) { break; }',
    '}'], uf.statements)
  assert('v3', uf.out)

  // loop: the condition's index is one past the counter, naming the value it tests, and is restored
  let ui = loopIndexNode()
  let uidx = statements(loopShaderNode(node('a'), 2, undefined, undefined, {test: composeShaderNodes(ui, node('c')), index: ui}))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '  vec4 v3 = vec4(float(l_i0 + 1));',
    '  vec4 v4 = c(v3);',
    '  if (any(notEqual(v4, vec4(0.0)))) { break; }',
    '}'], uidx.statements)
  assert(undefined, ui._loopIndexBox.expr) // Restored afterwards

  // loop: a node the body and the condition have in common emits twice rather than collapsing onto
  // one variable - the condition builds from the body's output, not from the carried value the body
  // built from while it still held the previous value
  let sharedAcc = node('a')
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '  vec4 v3 = a(v2);',
    '  if (any(notEqual(v3, vec4(0.0)))) { break; }',
    '}'], statements(loopShaderNode(sharedAcc, 2, undefined, undefined, {test: sharedAcc})).statements)

  // loop: a let{} bound inside the body is still in scope for the condition, which is the whole
  // reason the test goes after the body rather than before it
  let bound = makeShaderNode((input, ctx) => { ctx.lets['d'] = ctx.addStatement(`a(${input})`); return ctx.lets['d'] })
  let readsLet = makeShaderNode((input, ctx) => ctx.addStatement(`c(${ctx.lets['d']})`))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v2 = a(v1);',
    '  v1 = v2;',
    '  vec4 v3 = c(v2);',
    '  if (any(notEqual(v3, vec4(0.0)))) { break; }',
    '}'], statements(loopShaderNode(bound, 2, undefined, undefined, {test: readsLet})).statements)

  // loop: nested loops each break out of their own
  let un = statements(loopShaderNode(loopShaderNode(node('a'), 2, undefined, undefined, {test: node('c')}), 3, undefined, undefined, {test: node('d')}))
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v2 = v1;',
    '  for (int l_i1 = 0; l_i1 < 2; l_i1++) {',
    '    vec4 v3 = a(v2);',
    '    v2 = v3;',
    '    vec4 v4 = c(v3);',
    '    if (any(notEqual(v4, vec4(0.0)))) { break; }',
    '  }',
    '  v1 = v2;',
    '  vec4 v5 = d(v2);',
    '  if (any(notEqual(v5, vec4(0.0)))) { break; }',
    '}'], un.statements)

  // no iterations at all: no loop, so no test either
  assert(['vec4 v1 = v0;'], statements(loopShaderNode(node('a'), 0, undefined, undefined, {test: node('c')})).statements)

  // loop with carry: the named value is declared before the loop, from the value arriving at it, and
  // assigned in place inside the block - so it survives the iteration and is still in scope after.
  // The body here hands its input straight back, as a march step does, so there is no acc write-back
  let carriedLet = (name, tag) => makeShaderNode((input, ctx) => {
    let v = ctx.addStatement(`${tag}(${input})`)
    ctx.addRaw(`${ctx.carried[name]} = ${v};`)
    ctx.volatile = true
    return input
  })
  let c1 = statements(loopShaderNode(carriedLet('t', 's'), 2, undefined, undefined, undefined, [{name:'t', init: node('i')}]))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v4 = s(v1);',
    '  v3 = v4;',
    '}'], c1.statements)
  assert('v1', c1.out) // The loop still hands on its carried value; the name is read separately
  assert('v3', c1.lets.t) // and the name still points at the variable, which is in scope out here
  assert('v3', c1.carried.t)

  // loop with two carried values: declared in order, each assigned where its let{} sits in the body
  let c2 = statements(loopShaderNode(composeShaderNodes(carriedLet('p', 's'), carriedLet('t', 'd')), 1,
    undefined, undefined, undefined, [{name:'p', init: node('i')}, {name:'t', init: node('j')}]))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'vec4 v4 = j(v1);',
    'vec4 v5 = v4;',
    'for (int l_i0 = 0; l_i0 < 1; l_i0++) {',
    '  vec4 v6 = s(v1);',
    '  v3 = v6;',
    '  vec4 v7 = d(v1);',
    '  v5 = v7;',
    '}'], c2.statements)

  // loop with carry and a fold: the carried values are declared first, so the fold's seed term can
  // read one, and the fold still decides what the loop hands on
  let c3 = statements(loopShaderNode(carriedLet('t', 's'), 2, undefined, {map: node('f')}, undefined, [{name:'t', init: node('i')}]))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'vec4 v4 = f(v1);',
    'vec4 v5 = v4;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v6 = s(v1);',
    '  v3 = v6;',
    '  vec4 v7 = f(v1);',
    '  v5 += v7;',
    '}'], c3.statements)
  assert('v5', c3.out)

  // loop with carry and an early exit: the condition reads the carried value the body just assigned
  let readsCarried = makeShaderNode((input, ctx) => ctx.addStatement(`c(${ctx.lets['t']})`))
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v4 = s(v1);',
    '  v3 = v4;',
    '  vec4 v5 = c(v3);',
    '  if (any(notEqual(v5, vec4(0.0)))) { break; }',
    '}'], statements(loopShaderNode(carriedLet('t', 's'), 2, undefined, undefined, {test: readsCarried},
      [{name:'t', init: node('i')}])).statements)

  // loop with carry and no iterations at all: the declaration stands, so the name still reads
  let c0 = statements(loopShaderNode(carriedLet('t', 's'), 0, undefined, undefined, undefined, [{name:'t', init: node('i')}]))
  assert(['vec4 v1 = v0;', 'vec4 v2 = i(v1);', 'vec4 v3 = v2;'], c0.statements)
  assert('v3', c0.lets.t)

  // loop with carry: one node reading the carried value, built twice from the same input either side
  // of an assignment to it, emits twice - the variable holds something else the second time, so the
  // build memo (which is keyed on node and input alone) must not hand the first result back
  let fromCarried = makeShaderNode((input, ctx) => {
    ctx.addStatement(`g(${ctx.lets['t']})`)
    ctx.volatile = true
    return input
  })
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 1; l_i0++) {',
    '  vec4 v4 = g(v3);',
    '  vec4 v5 = s(v1);',
    '  v3 = v5;',
    '  vec4 v6 = g(v3);',
    '}'], statements(loopShaderNode(composeShaderNodes(composeShaderNodes(fromCarried, carriedLet('t', 's')), fromCarried), 1,
      undefined, undefined, undefined, [{name:'t', init: node('i')}])).statements)

  // nested loops: the inner loop's carried name is declared inside the outer body, so it goes out of
  // scope with it, where the outer one is still there afterwards
  let nestedCarry = makeContext()
  let innerLoop = loopShaderNode(carriedLet('u', 'd'), 1, undefined, undefined, undefined, [{name:'u', init: node('j')}])
  loopShaderNode(innerLoop, 1, undefined, undefined, undefined, [{name:'t', init: node('i')}]).build(nestedCarry.rootInput, nestedCarry)
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = i(v1);',
    'vec4 v3 = v2;',
    'for (int l_i0 = 0; l_i0 < 1; l_i0++) {',
    '  vec4 v4 = v1;',
    '  vec4 v5 = j(v4);',
    '  vec4 v6 = v5;',
    '  for (int l_i1 = 0; l_i1 < 1; l_i1++) {',
    '    vec4 v7 = d(v4);',
    '    v6 = v7;',
    '  }',
    '  v1 = v4;',
    '}'], nestedCarry.statements)
  assert(['v3', undefined], [nestedCarry.carried.t, nestedCarry.carried.u])

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
    loopAccNode: loopAccNode,
    loopShaderNode: loopShaderNode,
  }
})
