'use strict';
define(function(require) {
  let combineIntervals = require('player/intervals').combine

  let objectMap = (obj, fn) => {
    obj.__evaluated = obj.__evaluated || {} // cache result object to avoid creating per-frame garbage
    for (let k in obj) {
      if (k !== '__evaluated') {
        obj.__evaluated[k] = fn(obj[k])
      }
    }
    return obj.__evaluated
  }
  let arrayMap = (arr, fn) => {
    arr.__evaluated = arr.__evaluated || [] // cache result object to avoid creating per-frame garbage
    for (let i = 0; i < arr.length; i++) {
      arr.__evaluated[i] = fn(arr[i])
    }
    return arr.__evaluated
  }

  let isPrimitive = v => (typeof v == 'number' || typeof v == 'string')

  let applyOperator = (op, el, er) => {
    if (isPrimitive(el)) {
      if (isPrimitive(er)) {
        return op(el,er)
      } else if (Array.isArray(er)) {
        return arrayMap(er, (x) => op(el,x))
      } else if (typeof er == 'object') {
        return objectMap(er, (v)=>op(el,v))
      }
    } else if (Array.isArray(el)) {
      if (isPrimitive(er)) {
        return arrayMap(el, x => op(x,er))
      } else if (Array.isArray(er)) {
        el.__evaluated = el.__evaluated || [] // cache result object to avoid creating per-frame garbage
        for (let i = 0; i < Math.max(el.length, er.length); i++) {
          el.__evaluated.push(op(el[i % el.length], er[i % er.length]))
        }
        return el.__evaluated
      } else if (typeof er == 'object') {
        return objectMap(er, (v) => applyOperator(op,el,v))
      }
    } else if (typeof el == 'object') {
      if (isPrimitive(er)) {
        return objectMap(el, (v) => applyOperator(op,v,er))
      } else if (Array.isArray(er)) {
        return objectMap(el, (v) => applyOperator(op,v,er))
      } else if (typeof er == 'object') {
        el.__evaluated = el.__evaluated || {} // cache result object to avoid creating per-frame garbage
        for (let k in el) {
          if (k !== '__evaluated') {
            let erv = er[k]
            el.__evaluated[k] = (erv !== undefined) ? applyOperator(op,el[k],erv) : el[k]
          }
        }
        for (let k in er) {
          if (k !== '__evaluated') {
            if (el.__evaluated[k] === undefined) { el.__evaluated[k] = er[k] }
          }
        }
        return el.__evaluated
      }
    }
  }

  let operator = (op, l, r) => {
    if (l === undefined || r === undefined) { return }
    if (typeof l == 'number' && typeof (r) == 'number') {
      return op(l, r)
    }
    let evalOp = (event,b,evalRecurse) => {
      let el = evalRecurse(l, event,b,evalRecurse)
      let er = evalRecurse(r, event,b,evalRecurse)
      let result = applyOperator(op, el, er)
      if (result === undefined) { return operator(op, el, er) }
      return result
    }
    evalOp.interval = combineIntervals(l.interval, r.interval)
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

  let add = (a,b)=>a+b
  let mul = (a,b)=>a*b
  let div = (a,b)=>a/b
  let fn = (x)=>()=>x

  let perFrame = ({},b)=>b
  perFrame.interval = 'frame'
  let perEvent = ({count},b)=>count
  perEvent.interval = 'event'

  assert(3, operator(add, 1, 2))
  assert(8, operator(mul, 2, 4))
  assert([4,5], operator(add, fn([1,2]), 3)(ev(0),0,evalParam))
  assert([3,4], operator(add, 1, fn([2,3]))(ev(0),0,evalParam))
  assert([3,8], operator(mul, fn([1,2]), fn([3,4]))(ev(0),0,evalParam))
  assert([2,3], operator(mul, fn([1]), fn([2,3]))(ev(0),0,evalParam))
  assert({r:2}, operator(mul, {r:1}, 2)(ev(0),0,evalParam))
  assert({r:2}, operator(mul, 2, {r:1})(ev(0),0,evalParam))
  assert({r:4,g:5}, operator(add, {r:1,g:2}, 3)(ev(0),0,evalParam))
  assert({r:[2,3]}, operator(mul, {r:1}, fn([2,3]))(ev(0),0,evalParam))
  assert({r:[3,6]}, operator(mul, {r:fn([1,2])}, 3)(ev(0),0,evalParam))
  assert({r:3}, operator(add, {r:1}, {r:2})(ev(0),0,evalParam))
  assert({r:1,g:6,b:4}, operator(mul, {r:1,g:2}, {g:3,b:4})(ev(0),0,evalParam))
  assert({r:[3,6]}, operator(mul, fn([1,2]), {r:3})(ev(0),0,evalParam))
  assert('ab', operator(add, 'a', 'b')(ev(0),0,evalParam))
  assert(['ab','ac'], operator(add, 'a', fn(['b','c']))(ev(0),0,evalParam))
  assert(['ac','bc'], operator(add, fn(['a','b']),'c')(ev(0),0,evalParam))
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
  assert(0, operator(add, perEvent, perEvent)(ev(0,0), 5, evalParam))
  assert(10, operator(add, perFrame, perFrame)(ev(0,0), 5, evalParam))
  assert(0, operator(add, perFrame, perFrame)(ev(0,5), 0, evalParam))
  assert(3, operator(add, perEvent, perFrame)(ev(0,3), 0, evalParam))
  assert(4, operator(add, perEvent, perFrame)(ev(0,0), 4, evalParam))

  console.log('eval operator tests complete')
  }
  
  return operator
})