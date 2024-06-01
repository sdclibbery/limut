'use strict';
define(function(require) {
  let consoleOut = require('console')
  let {combineIntervalsFrom} = require('expression/intervals')
  let {evalFunctionWithModifiers} = require('player/eval-param')

  let objectMap = (obj, fn) => {
    if (obj.hasOwnProperty('value')) { // 'value' field implies this is an object with subparams instead of a normal object
      if (obj.__evaluated === undefined) {
        obj.__evaluated = Object.assign({}, obj) // Must still make a copy of the object to avoid memoisation problems
      }
      obj.__evaluated.value = fn(obj.value)
      return obj.__evaluated
    }
    obj.__evaluated = obj.__evaluated || {} // cache result object to avoid creating per-frame garbage
    for (let k in obj) {
      if (k !== '__evaluated') {
        obj.__evaluated[k] = fn(obj[k])
      }
    }
    return obj.__evaluated
  }
  let isPrimitive = v => (typeof v == 'number' || typeof v == 'string' || v === undefined)

  let applyOperator = (op, el, er) => {
    if (isPrimitive(el)) {
      if (isPrimitive(er)) {
        return op(el,er)
      } else if (Array.isArray(er)) {
        return er.map(r => operator(op, el, r))
      } else if (typeof er == 'object') {
        return objectMap(er, (v)=>op(el,v))
      }
    } else if (Array.isArray(el)) {
      if (isPrimitive(er)) {
        return el.map(l => operator(op, l, er))
      } else if (Array.isArray(er)) {
        let len = Math.max(el.length, er.length)
        return (Array.from(Array(len).keys()))
          .map(i => operator(op, el[i%el.length], er[i%er.length]))
      } else if (typeof er == 'object') {
        return el.map(l => operator(op, l, er))
      }
    } else if (typeof el == 'object') {
      if (isPrimitive(er)) {
        return objectMap(el, (v) => operator(op,v,er))
      } else if (Array.isArray(er)) {
        return er.map(r => operator(op, el, r))
      } else if (typeof er == 'object') {
        let result = {}
        for (let k in el) {
          if (k === '_units') { // should do clever stuff if there are units, but just pick one for now
            if (el[k] !== er[k]) { consoleOut(`🔴 Error: Mismatched units in operator '${el[k]}' '${er[k]}'. Conversion is not implemented yet.`) }
            result[k] = el[k]
          } else if (k === '_nextSegment') {
            result[k] = Math.min(el[k], er[k]||Infinity)
          } else if (k === '_segmentPower') {
            result[k] = Math.max(el[k], er[k]||0)
          } else {
            let erv = er[k]
            if (erv === undefined) {
              result[k] = el[k]
            } else {
              result[k] = operator(op,el[k],erv)
            } 
          }
        }
        for (let k in er) {
          if (result[k] === undefined) { result[k] = er[k] }
        }
        return result
      }
    }
  }

  let evalOperand = (v, event,b, evalRecurse, doNotEvalDeferred) => {
    v = evalRecurse(v, event,b)
    if (typeof v === 'function' && v.isDeferredVarFunc && !doNotEvalDeferred) {
      v = evalFunctionWithModifiers(v,event,b, evalRecurse) // Will apply modifiers but not eval a deferred function
    }
    return v
}

  let operator = (op, l, r) => {
    if (isPrimitive(l) && isPrimitive(r)) {
      return op(l, r)
    }
    let evalOp = (event,b,evalRecurse) => {
      let el = evalOperand(l, event,b, evalRecurse, op.doNotEvalDeferred)
      let er = evalOperand(r, event,b, evalRecurse, op.doNotEvalDeferred)
      if (op.raw) {
        return op(el, er, event,b,evalRecurse)
      } else {
        return applyOperator(op, el, er)
      }
    }
    evalOp.interval = combineIntervalsFrom(l, r)
    return evalOp
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let evalParam = require('player/eval-param').evalParamFrame

  let ev = (i,c) => {return{idx:i,count:c}}

  let add = (l,r)=>l+r
  let mul = (l,r)=>l*r
  let cat = (l,r)=>[l].concat(r)
  let fn = (x)=>()=>x

  let perFrame = ({},b)=>b
  perFrame.interval = 'frame'
  let perEvent = ({count},b)=>count
  perEvent.interval = 'event'

  assert(3, operator(add, 1, 2))
  assert(8, operator(mul, 2, 4))
  assert({r:2}, evalParam(operator(mul, {r:1}, 2), ev(0),0))
  assert({r:2}, evalParam(operator(mul, 2, {r:1}), ev(0),0))
  assert({r:4,g:5}, evalParam(operator(add, {r:1,g:2}, 3), ev(0),0))
  assert({r:3}, evalParam(operator(add, {r:1}, {r:2}), ev(0),0))
  assert({r:1,g:6,b:4}, evalParam(operator(mul, {r:1,g:2}, {g:3,b:4}), ev(0),0))
  assert('ab', operator(add, 'a', 'b'))
  assert('a3', operator(add, 'a', 3))
  assert(undefined, operator(add, fn(1), 2).interval)
  assert('frame', operator(add, perFrame, 2).interval)
  assert('frame', operator(add, 1, perFrame).interval)
  assert('frame', operator(add, perFrame, perFrame).interval)
  assert('event', operator(add, perEvent, 2).interval)
  assert('event', operator(add, 1, perEvent).interval)
  assert('event', operator(add, perEvent, perEvent).interval)
  assert('frame', operator(add, perEvent, perFrame).interval)
  assert('frame', operator(add, perFrame, perEvent).interval)

  assert(10, operator(add, perEvent, perEvent)(ev(0,5), 0, evalParam))
  delete perEvent.interval_memo
  assert(0, operator(add, perEvent, perEvent)(ev(0,0), 5, evalParam))
  assert(10, operator(add, perFrame, perFrame)(ev(0,0), 5, evalParam))
  assert(0, operator(add, perFrame, perFrame)(ev(0,5), 0, evalParam))
  delete perEvent.interval_memo
  assert(3, operator(add, perEvent, perFrame)(ev(0,3), 0, evalParam))
  delete perEvent.interval_memo
  assert(4, operator(add, perEvent, perFrame)(ev(0,0), 4, evalParam))

  assert([3,4], operator(add, 1, [2,3])(ev(0),0,evalParam))
  assert([4,5], operator(add, [1,2], 3)(ev(0),0,evalParam))
  assert([4,6], operator(add, [1,2], [3,4])(ev(0),0,evalParam))
  assert([4,5], operator(add, [1], [3,4])(ev(0),0,evalParam))
  assert([4,5], operator(add, [1,2], [3])(ev(0),0,evalParam))
  assert([4,5], operator(add, [1,2], fn(3))(ev(0),0,evalParam))
  assert([4,5], operator(add, [1,fn(2)], 3)(ev(0),0,evalParam))
  assert([4,5], operator(add, fn([1,2]), [3])(ev(0),0,evalParam))
  assert([3,4], operator(add, 1, [fn(2),3])(ev(0),0,evalParam))
  assert([4,5], operator(add, [fn(1),2], 3)(ev(0),0,evalParam))

  assert([{r:3},{r:4}], evalParam(operator(add, {r:1}, [{r:2},{r:3}]),ev(0),0))
  assert([{r:3},{r:1,g:1}], evalParam(operator(add, {r:1}, [{r:2},{g:1}]),ev(0),0))

  assert([{r:3},{r:4}], evalParam(operator(add, [{r:2},{r:3}], {r:1}),ev(0),0))
  assert([{r:3},{g:1,r:1}], evalParam(operator(add, [{r:2},{g:1}], {r:1}),ev(0),0))

  assert([{r:4},{r:6}], evalParam(operator(add, [{r:1},{r:2}], [{r:3},{r:4}]),ev(0),0))
  assert([{r:1,g:3},{g:2,r:4}], evalParam(operator(add, [{r:1},{g:2}], [{g:3},{r:4}]),ev(0),0))

  assert({value:4,mix:2}, evalParam(operator(add, {value:1,mix:2}, 3),ev(0),0))
  assert({value:4,mix:2}, evalParam(operator(add, 3, {value:1,mix:2}),ev(0),0))

  assert([1,3,2,4], evalParam(operator(cat, [1,2], [3,4]),ev(0),0))
  assert([1,2], evalParam(operator(cat, 1, 2),ev(0),0))

  let segment = (v, n, p) => { return {value:v, _nextSegment:n, _segmentPower:p} }
  assert(segment(10,6,7), evalParam(operator(mul, 2, segment(5,6,7)),ev(0),0))
  assert(segment(4,3,4), evalParam(operator(mul, segment(2,3,4), 2),ev(0),0))
  assert([segment(5,6,7),segment(10,6,7)], evalParam(operator(mul, [1,2], segment(5,6,7)),ev(0),0))
  assert([segment(2,3,4),segment(4,3,4)], evalParam(operator(mul, segment(2,3,4), [1,2]),ev(0),0))
  assert(segment(10,6,7), evalParam(operator(mul, {value:2}, segment(5,6,7)),ev(0),0))
  assert(segment(4,3,4), evalParam(operator(mul, segment(2,3,4), {value:2}),ev(0),0))
  assert(segment(10,3,7), evalParam(operator(mul, segment(2,3,4), segment(5,6,7)),ev(0),0))

  console.log('eval operator tests complete')
  }
  
  return operator
})