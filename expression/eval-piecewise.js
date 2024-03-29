'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')
  let consoleOut = require('console')
  let evalOperator = require('expression/eval-operator')
  let {mainParam} = require('player/sub-param')

  let findPieceIdxWithFractional = (ss, p) => {
    let pos = 0
    for (let i=0; i<ss.length; i++) {
      let s = ss[i]
      if (p < pos+s) {
        return i + (p - pos)/s
      }
      pos += s
    }
    return 0
  }

  let add = (a,b) => a+b
  let mul = (a,b) => (typeof b === 'string') ? (a === 0 ? '' : b) : a*b
  let lerpValue = (lerp, pre, post) => {
    return evalOperator(add,
      evalOperator(mul, 1-lerp, pre),
      evalOperator(mul, lerp, post)
    )
  }

  let piecewise = (vs, is, ss, p) => { // values, interpolators, sizes
    if (vs.length === 0) { return () => 0 }
    if (is.length !== vs.length) { throw `is.length ${is} !== vs.length ${vs}` }
    if (ss.length !== vs.length) { throw `ss.length ${ss} !== vs.length ${vs}` }
    let totalSize = ss.reduce((a, x) => a + x, 0)
    if (!Number.isFinite(totalSize)) { throw `invalid piecewise totalSize: ${totalSize}` }
    let result = (e,b, evalRecurse, modifiers) => {
      if (modifiers && modifiers.seed !== undefined) {
        if (!p.modifiers) { p.modifiers = {} }
        p.modifiers.seed = modifiers.seed
      }
      let piecePos = evalParamFrame(p, e,b) || 0
      if (!Number.isFinite(piecePos)) { consoleOut(`🟠 Warning invalid piecewise piece param: ${piecePos}`); return 0; }
      let piece = findPieceIdxWithFractional(ss, (piecePos%totalSize + totalSize) % totalSize)
      let idx = Math.floor(piece)
      let l = vs[idx % vs.length]
      let r = vs[(idx+1) % vs.length]
      let interp = is[idx % is.length](piece%1)
      let result = lerpValue(interp, l, r)
      return result
    }
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
    }
    let assertThrows = async (expected, code) => {
      let got
      try {code()}
      catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
      finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
    }
    let ev = (i,c,d) => {return{idx:i, count:c, dur:d, _time:c, endTime:c+d, countToTime:x=>x}}
    let step = (i) => 0
    let lin = (i) => i
    let sqr = (i) => i*i
    let x = 0
    let getx = (e,b) => x
    let getb = (e,b) => b
    let pw

    pw = piecewise([], [], [], 1)
    assert(0, evalParamFrame(pw,ev(0),0))

    assertThrows('is.length', ()=>piecewise([0],[],[1]))
    assertThrows('ss.length', ()=>piecewise([0],[lin],[]))
    assertThrows('invalid piecewise totalSize', ()=>piecewise([0],[lin],['foo']))

    pw = piecewise([2], [step], [1], 1)
    assert(2, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,step], [1,1], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1/2; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3/2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [1,1], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1/2; assert(1, evalParamFrame(pw,ev(0),0))
    x = 1; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3/2; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [sqr,sqr], [2,2], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1/2, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(3/2, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [2,2], getb)
    assert(0, evalParamFrame(pw,ev(0),-4))
    assert(1, evalParamFrame(pw,ev(0),-3))
    assert(2, evalParamFrame(pw,ev(0),-2))
    assert(1, evalParamFrame(pw,ev(0),-1))
    assert(0, evalParamFrame(pw,ev(0),0))
    assert(1, evalParamFrame(pw,ev(0),1))
    assert(2, evalParamFrame(pw,ev(0),2))
    assert(1, evalParamFrame(pw,ev(0),3))
    assert(0, evalParamFrame(pw,ev(0),4))
    assert(1, evalParamFrame(pw,ev(0),5))
    assert(2, evalParamFrame(pw,ev(0),6))
    assert(1, evalParamFrame(pw,ev(0),7))
    assert(0, evalParamFrame(pw,ev(0),8))
    assert(1, evalParamFrame(pw,ev(0),9))
    assert(2, evalParamFrame(pw,ev(0),10))
    assert(1, evalParamFrame(pw,ev(0),11))
    assert(0, evalParamFrame(pw,ev(0),12))

    pw = piecewise([0,2], [lin,lin], [2,4], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(3/2, evalParamFrame(pw,ev(0),0))
    x = 4; assert(1, evalParamFrame(pw,ev(0),0))
    x = 5; assert(1/2, evalParamFrame(pw,ev(0),0))
    x = 6; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [2,0], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))
    x = 5; assert(1, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,lin], [2,2], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(0, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([()=>0,()=>2], [lin,lin], [2,2], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2,3], [lin,step,lin], [2,0,2], getb) // step discontinuity using zero size step
    assert(0, evalParamFrame(pw,ev(),0))
    assert(1, evalParamFrame(pw,ev(),1))
    assert(3, evalParamFrame(pw,ev(),2))
    assert(3/2, evalParamFrame(pw,ev(),3))
    assert(0, evalParamFrame(pw,ev(),4))

    pw = piecewise([0,2], [step,lin], [2,2], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(0, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,lin], [2,2], (e,b) => e.idx)
    assert(0, evalParamFrame(pw,ev(0),0))
    assert(0, evalParamFrame(pw,ev(1),0))
    assert(2, evalParamFrame(pw,ev(2),0))
    assert(1, evalParamFrame(pw,ev(3),0))
    assert(0, evalParamFrame(pw,ev(4),0))

    console.log('Piecewise tests complete')
  }

  return {
    piecewise: piecewise,
  }
})