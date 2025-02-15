'use strict';
define(function(require) {
  let {evalParamFrame,evalFunctionWithModifiers} = require('player/eval-param')
  let consoleOut = require('console')
  let evalOperator = require('expression/eval-operator')
  let {units} = require('units')
  let {mainParam} = require('player/sub-param')

  let add = (a,b) => a+b
  let mul = (a,b) => (typeof b === 'string') ? (a === 0 ? '' : b) : a*b
  let lerpValue = (lerp, pre, post) => {
    return evalOperator(add,
      evalOperator(mul, 1-lerp, pre),
      evalOperator(mul, lerp, post)
    )
  }

  let indexer = (ss, {clamp, normalise}, pieceParam, e,b) => {
    let ess = ss.map(s => units(evalParamFrame(s, e,b), 'b'))
    let totalSize = ess.reduce((a,x) => a+x, 0)
    if (normalise) {
      ess = ess.map(s => s/totalSize)
      totalSize = 1
    }
    if (!Number.isFinite(totalSize)) { throw `invalid piecewise totalSize: ${totalSize}` }
    if (clamp) {
      if (pieceParam < 0) { return { piece: 0, next: ess[0] } }
      if (pieceParam >= totalSize) { return { piece: ess.length-1 } }
    }
    let repeatStart = Math.floor(pieceParam/totalSize) * totalSize
    let pMod = (pieceParam%totalSize + totalSize) % totalSize
    let pos = 0
    for (let i=0; i<ess.length; i++) {
      let s = ess[i]
      if (pMod < pos+s) {
        return {
          piece: i + (pMod - pos)/s,
          next: repeatStart + pos + s
        }
      }
      pos += s
    }
    return { piece: 0, next: ess[0] }
  }

  let setSegment = (v, segmentWrapper, is, idx, next, nextSegmentMapper,e,b) => {
    let p = is[idx % is.length].segmentPower
    let power = p!==undefined ? p : 1 // Default to power 1 for linear if not specified
    if (nextSegmentMapper) {
      next = nextSegmentMapper(next, e,b)
    }
    next = Math.min(next, v._nextSegment||Infinity)
    power = Math.max(power, v._segmentPower||0)
    if (typeof v === 'object' && !(v instanceof AudioNode) && !Array.isArray(v)) {
      v = Object.assign({}, v) // Cannot use v or segmentWrapper here because we'd be leaving _nextSegment etc set on them which would fail next frame
      v._nextSegment = next
      v._segmentPower = power
    } else {
      segmentWrapper.value = v
      segmentWrapper._nextSegment = next
      segmentWrapper._segmentPower = power
      v = segmentWrapper
    }
    return v
  }

  let emptyOptions = {}
  let piecewise = (vs, is, ss, p, options) => { // values, interpolators, sizes
    if (vs.length === 0) { return () => 0 }
    if (is.length !== vs.length) { throw `is.length ${is} !== vs.length ${vs}` }
    if (ss.length !== vs.length) { throw `ss.length ${ss} !== vs.length ${vs}` }
    if (options === undefined) { options = emptyOptions }
    let segmentWrapper = {}
    let piecewiseResult = (e,b, evalRecurse, modifiers) => {
      if (modifiers && modifiers.seed !== undefined) {
        if (!p.modifiers) { p.modifiers = {} }
        p.modifiers.seed = modifiers.seed
      }
      p = mainParam(p) || 0
      let pieceParam = typeof p !== 'function' ? p : evalFunctionWithModifiers(p, e,b,evalRecurse)
      if (!Number.isFinite(pieceParam)) {
        consoleOut(`🟠 Warning invalid piecewise piece param: ${p} ${b} ${pieceParam}`)
        return 0
      }
      let {piece,next} = indexer(ss, options, pieceParam, e,b) // "piece" integer part is an index into the segments; fractional part is the interpolator between segments
      let idx = Math.floor(piece)
      let l = vs[idx % vs.length]
      let r = vs[(idx+1) % vs.length]
      let interp = is[idx % is.length](piece%1)
      let v
      if (interp <= 0) { v = l }
      else if (interp >= 1) { v = r }
      else { v = lerpValue(interp, l, r) }
      if (options.addSegmentData && next !== undefined) {
        if (typeof v === 'function') {
          let func = v
          v = (e,b, evalRecurse) => {
            let ev = evalRecurse(func, e,b) // Have to eval before setting the segment data
            return setSegment(ev, segmentWrapper, is, idx, next, options.nextSegmentMapper,e,b)
          }
        } else {
          v = setSegment(v, segmentWrapper, is, idx, next, options.nextSegmentMapper,e,b)
        }
      }
      return v
    }
    let result = piecewiseResult
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.000001).toFixed(4) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.000001).toFixed(4) : v)
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
    step.segmentPower = 0
    let lin = (i) => i
    lin.segmentPower = 1
    let sqr = (i) => i*i
    sqr.segmentPower = 2
    let x = 0
    let getx = (e,b) => x
    let getb = (e,b) => b
    let pw

    pw = piecewise([], [], [], 1, {})
    assert(0, evalParamFrame(pw,ev(0),0))

    assertThrows('is.length', ()=>piecewise([0], [], [1], 0, {}))
    assertThrows('ss.length', ()=>piecewise([0], [lin], [], 0, {}))
    assertThrows('invalid piecewise totalSize', ()=>piecewise([0], [lin], [Infinity], 0, {})({},0,v=>v))

    pw = piecewise([2], [step], [1], 1, {})
    assert(2, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,step], [1,1], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1/2; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3/2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [1,1], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1/2; assert(1, evalParamFrame(pw,ev(0),0))
    x = 1; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3/2; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [sqr,sqr], [2,2], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1/2, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(3/2, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [2,2], getb, {})
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

    pw = piecewise([0,2], [lin,lin], [2,4], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(3/2, evalParamFrame(pw,ev(0),0))
    x = 4; assert(1, evalParamFrame(pw,ev(0),0))
    x = 5; assert(1/2, evalParamFrame(pw,ev(0),0))
    x = 6; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [lin,lin], [2,0], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(0, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))
    x = 5; assert(1, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,lin], [2,2], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(0, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([()=>0,()=>2], [lin,lin], [2,2], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(1, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2,3], [lin,step,lin], [2,0,2], getb, {}) // step discontinuity using zero size step
    assert(0, evalParamFrame(pw,ev(),0))
    assert(1, evalParamFrame(pw,ev(),1))
    assert(3, evalParamFrame(pw,ev(),2))
    assert(3/2, evalParamFrame(pw,ev(),3))
    assert(0, evalParamFrame(pw,ev(),4))

    pw = piecewise([0,2], [step,lin], [2,2], getx, {})
    x = 0; assert(0, evalParamFrame(pw,ev(0),0))
    x = 1; assert(0, evalParamFrame(pw,ev(0),0))
    x = 2; assert(2, evalParamFrame(pw,ev(0),0))
    x = 3; assert(1, evalParamFrame(pw,ev(0),0))
    x = 4; assert(0, evalParamFrame(pw,ev(0),0))

    pw = piecewise([0,2], [step,lin], [2,2], (e,b) => e.idx, {})
    assert(0, evalParamFrame(pw,ev(0),0))
    assert(0, evalParamFrame(pw,ev(1),0))
    assert(2, evalParamFrame(pw,ev(2),0))
    assert(1, evalParamFrame(pw,ev(3),0))
    assert(0, evalParamFrame(pw,ev(4),0))

    pw = piecewise([0,2], [step,step], [1,1], getb, {clamp:true})
    assert(0, evalParamFrame(pw,ev(0),-1))
    assert(0, evalParamFrame(pw,ev(0),0))
    assert(0, evalParamFrame(pw,ev(0),1/2))
    assert(2, evalParamFrame(pw,ev(0),1))
    assert(2, evalParamFrame(pw,ev(0),3/2))
    assert(2, evalParamFrame(pw,ev(0),2))
    assert(2, evalParamFrame(pw,ev(0),3))

    pw = piecewise([0,2], [lin,step], [(e,b)=>1+b%2,(e,b)=>1], getb, {clamp:true})
    assert(0, evalParamFrame(pw,ev(0,0,2),-1))
    assert(0, evalParamFrame(pw,ev(0,0,2),0))
    assert(1, evalParamFrame(pw,ev(0,0,2),1))
    assert(2, evalParamFrame(pw,ev(0,0,2),2))
    assert(2, evalParamFrame(pw,ev(0,0,2),3))

    pw = piecewise([1,2], [step,step], [1,2], getb, {normalise:true})
    assert(1, evalParamFrame(pw,ev(0,0,2),0))
    assert(2, evalParamFrame(pw,ev(0,0,2),1/2))
    assert(1, evalParamFrame(pw,ev(0,0,2),1))

    pw = piecewise([0,2], [step,step], [(e,b)=>1+b%3,(e,b)=>1], getb, {})
    assert(0, evalParamFrame(pw,ev(0,0,1),0))
    assert(0, evalParamFrame(pw,ev(0,0,1),1))
    assert(0, evalParamFrame(pw,ev(0,0,1),2))
    assert(2, evalParamFrame(pw,ev(0,0,1),3))
    assert(0, evalParamFrame(pw,ev(0,0,1),4))
    assert(0, evalParamFrame(pw,ev(0,0,1),5))
    assert(0, evalParamFrame(pw,ev(0,0,1),6))
    assert(0, evalParamFrame(pw,ev(0,0,1),7))
    assert(0, evalParamFrame(pw,ev(0,0,1),8))
    assert(2, evalParamFrame(pw,ev(0,0,1),9))
    assert(0, evalParamFrame(pw,ev(0,0,1),10))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:1,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))
    assert({value:1,_nextSegment:4,_segmentPower:0}, evalParamFrame(pw,ev(3,3,2),3))
    assert({value:2,_nextSegment:6,_segmentPower:0}, evalParamFrame(pw,ev(3,3,2),4))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true,nextSegmentMapper: x=>x*10})
    assert({value:1,_nextSegment:10,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:2,_nextSegment:30,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))
    assert({value:1,_nextSegment:40,_segmentPower:0}, evalParamFrame(pw,ev(3,3,2),3))
    assert({value:2,_nextSegment:60,_segmentPower:0}, evalParamFrame(pw,ev(3,3,2),4))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true,clamp:true})
    assert({value:1,_nextSegment:1,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))
    assert(2, evalParamFrame(pw,ev(3,3,2),3))
    assert(2, evalParamFrame(pw,ev(3,3,2),4))

    pw = piecewise([{value:1,_units:'hz'},2], [step,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_units:'hz',_nextSegment:1,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))

    let a = () => 1
    let b = () => 2
    pw = piecewise([a,b], [lin,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:3/2,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),1/2))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))

    a = () => { return {r:1,g:0} }
    b = () => { return {r:0,g:1} }
    pw = piecewise([a,b], [lin,step], [1,2], getb, {addSegmentData:true})
    assert({r:1,g:0,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),0))
    assert({r:1/2,g:1/2,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),1/2))
    assert({r:0,g:1,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))

    pw = piecewise([{r:1,g:0},{r:0,g:1}], [lin,step], [1,2], getb, {addSegmentData:true})
    assert({r:1,g:0,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),0))
    assert({r:1/2,g:1/2,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),1/2))
    assert({r:0,g:1,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,2),1))

    pw = piecewise([1,2], [lin,sqr], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),0))
    assert({value:2,_nextSegment:3,_segmentPower:2}, evalParamFrame(pw,ev(0,0,2),1))

    pw = piecewise([{value:1,_nextSegment:2,_segmentPower:0},2], [lin,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:1,_segmentPower:1}, evalParamFrame(pw,ev(0,0,2),0))

    pw = piecewise([{value:1,_nextSegment:1/2,_segmentPower:3},2], [step,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:1/2,_segmentPower:3}, evalParamFrame(pw,ev(0,0,2),0))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true})
    assert({value:1,_nextSegment:4,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),3))
    assert({value:2,_nextSegment:6,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),4))
    assert({value:2,_nextSegment:6,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),5))
    assert({value:1,_nextSegment:7,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),6))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true})
    assert({value:2,_nextSegment:6,_segmentPower:0}, evalParamFrame(pw,ev(0,4,10),4))

    pw = piecewise([1,2], [step,step], [1,2], getb, {addSegmentData:true, clamp:true})
    assert({value:1,_nextSegment:1,_segmentPower:0}, evalParamFrame(pw,ev(0,0,10),0))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,10),1))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,0,10),2))
    assert(2, evalParamFrame(pw,ev(0,0,10),3))

    let getec = (e,b) => b - e.count
    pw = piecewise([1,2], [step,step], [1,2], getec, {addSegmentData:true, clamp:true})
    assert({value:1,_nextSegment:1,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),3))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),4))
    assert({value:2,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(0,3,10),5))
    assert(2, evalParamFrame(pw,ev(0,3,10),6))

    pw = piecewise([[1,2],3], [step,step], [1,2], getb, {addSegmentData:true})
    assert([{value:1,_nextSegment:1,_segmentPower:0},{value:2,_nextSegment:1,_segmentPower:0}], evalParamFrame(pw,ev(0,0,1),0))
    assert({value:3,_nextSegment:3,_segmentPower:0}, evalParamFrame(pw,ev(1,1,1),1))

    console.log('Piecewise tests complete')
  }

  return {
    piecewise: piecewise,
  }
})