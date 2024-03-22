'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')
  let consoleOut = require('console')
  let evalOperator = require('expression/eval-operator')

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

  let piecewise = (vs, is, ss, p) => { // values, interpolators, sizes, piece parameter
    if (vs.length === 0) { return () => 0 }
    if (is.length !== vs.length) { throw `is.length ${is} !== vs.length ${vs}` }
    if (ss.length !== vs.length) { throw `ss.length ${ss} !== vs.length ${vs}` }
    let totalSize = ss.reduce((a, x) => a + x, 0)
    if (!Number.isFinite(totalSize)) { throw `invalid piecewise totalSize: ${totalSize}` }
    return (e,b) => {
      let piecePos = evalParamFrame(p, e, b)
      if (!Number.isFinite(piecePos)) { consoleOut(`🟠 Warning invalid piecewise piece param: ${piecePos}`); return 0; }
      let piece = findPieceIdxWithFractional(ss, (piecePos%totalSize + totalSize) % totalSize)
      let idx = Math.floor(piece)
      let l = vs[idx % vs.length]
      let r = vs[(idx+1) % vs.length]
      let interp = is[idx % is.length](piece%1)
      let result = lerpValue(interp, l, r)
      return result
    }
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual) => {
      if (typeof expected !== typeof actual) { console.trace(`Assertion failed.\n>>Expected type:\n  ${typeof expected}\n>>Actual type:\n  ${typeof actual}`); return }
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
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
    assert(0, pw())

    assertThrows('is.length', ()=>piecewise([0],[],[1],getb))
    assertThrows('ss.length', ()=>piecewise([0],[lin],[],getb))
    assertThrows('invalid piecewise totalSize', ()=>piecewise([0],[lin],['foo'],getb))

    pw = piecewise([2], [step], [1], 1)
    assert(2, pw())

    pw = piecewise([0,2], [step,step], [1,1], getx)
    x = 0; assert(0, pw())
    x = 1/2; assert(0, pw())
    x = 1; assert(2, pw())
    x = 3/2; assert(2, pw())
    x = 2; assert(0, pw())

    pw = piecewise([0,2], [lin,lin], [1,1], getx)
    x = 0; assert(0, pw())
    x = 1/2; assert(1, pw())
    x = 1; assert(2, pw())
    x = 3/2; assert(1, pw())
    x = 2; assert(0, pw())

    pw = piecewise([0,2], [sqr,sqr], [2,2], getx)
    x = 0; assert(0, pw())
    x = 1; assert(1/2, pw())
    x = 2; assert(2, pw())
    x = 3; assert(3/2, pw())
    x = 4; assert(0, pw())

    pw = piecewise([0,2], [lin,lin], [2,2], getb)
    assert(0, pw(ev(),-4))
    assert(1, pw(ev(),-3))
    assert(2, pw(ev(),-2))
    assert(1, pw(ev(),-1))
    assert(0, pw(ev(),0))
    assert(1, pw(ev(),1))
    assert(2, pw(ev(),2))
    assert(1, pw(ev(),3))
    assert(0, pw(ev(),4))
    assert(1, pw(ev(),5))
    assert(2, pw(ev(),6))
    assert(1, pw(ev(),7))
    assert(0, pw(ev(),8))
    assert(1, pw(ev(),9))
    assert(2, pw(ev(),10))
    assert(1, pw(ev(),11))
    assert(0, pw(ev(),12))

    pw = piecewise([0,2], [lin,lin], [2,4], getx)
    x = 0; assert(0, pw())
    x = 1; assert(1, pw())
    x = 2; assert(2, pw())
    x = 3; assert(3/2, pw())
    x = 4; assert(1, pw())
    x = 5; assert(1/2, pw())
    x = 6; assert(0, pw())

    pw = piecewise([0,2], [lin,lin], [2,0], getx)
    x = 0; assert(0, pw())
    x = 1; assert(1, pw())
    x = 2; assert(0, pw())
    x = 3; assert(1, pw())
    x = 4; assert(0, pw())
    x = 5; assert(1, pw())

    pw = piecewise([0,2], [step,lin], [2,2], getx)
    x = 0; assert(0, pw())
    x = 1; assert(0, pw())
    x = 2; assert(2, pw())
    x = 3; assert(1, pw())
    x = 4; assert(0, pw())

    pw = piecewise([()=>0,()=>2], [lin,lin], [2,2], getx)
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    console.log('Piecewise tests complete')
  }

  return {
    piecewise: piecewise,
  }
})