'use strict';
define(function(require) {
  let evalParam = require('player/eval-param').evalParamFrame

  let objectMap = (obj, fn) => {
    return Object.fromEntries(
      Object.entries(obj).map(
        ([k, v], i) => [k, fn(v, k, i)]
      )
    )
  }

  let isPrimitive = v => (typeof v == 'number' || typeof v == 'string')

  let applyOperator = (op, el, er) => {
    if (isPrimitive(el)) {
      if (isPrimitive(er)) {
        return op(el,er)
      } else if (Array.isArray(er)) {
        return er.map(x => op(el,x))
      } else if (typeof er == 'object') {
        return objectMap(er, (v)=>op(el,v))
      }
    } else if (Array.isArray(el)) {
      if (isPrimitive(er)) {
        return el.map(x => op(x,er))
      } else if (Array.isArray(er)) {
        let result = []
        for (let i = 0; i < Math.max(el.length, er.length); i++) {
          result.push(op(el[i % el.length], er[i % er.length]))
        }
        return result
      } else if (typeof er == 'object') {
        return objectMap(er, (v)=>applyOperator(op,el,v))
      }
    } else if (typeof el == 'object') {
      if (isPrimitive(er)) {
        return objectMap(el, (v)=>applyOperator(op,v,er))
      } else if (Array.isArray(er)) {
        return objectMap(el, (v)=>applyOperator(op,v,er))
      } else if (typeof er == 'object') {
        let result = {}
        for (let k in el) {
          let erv = er[k]
          result[k] = (erv !== undefined) ? applyOperator(op,el[k],erv) : el[k]
        }
        for (let k in er) {
          if (result[k] === undefined) { result[k] = er[k] }
        }
        return result
      }
    }
  }

  let operator = (op, l, r) => {
    if (typeof l == 'number' && typeof (r) == 'number') {
      return op(l, r)
    }
    let result = (s,b) => {
      let el = evalParam(l, s,b)
      let er = evalParam(r, s,b)
      // console.log('eval operator', 'l:',l,'r:',r, 'el:',el,'er:',er, 's:',s,'b:',b)
      return applyOperator(op, el, er)
    }
    result.interval = l.interval == 'frame' ? 'frame' : (r.interval == 'frame' ? 'frame' : (l.interval || r.interval))
    return result
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let ev = i => {return{idx:i}}

  let add = (a,b)=>a+b
  let mul = (a,b)=>a*b
  let div = (a,b)=>a/b
  let fn = (x)=>()=>x

  let perFrame = ()=>1
  perFrame.interval = 'frame'
  let perEvent = ()=>1
  perEvent.interval = 'event'

  assert(3, operator(add, 1, 2))
  assert(8, operator(mul, 2, 4))
  assert([4,5], operator(add, fn([1,2]), 3)(ev(0),0))
  assert([3,4], operator(add, 1, fn([2,3]))(ev(0),0))
  assert([3,8], operator(mul, fn([1,2]), fn([3,4]))(ev(0),0))
  assert([2,3], operator(mul, fn([1]), fn([2,3]))(ev(0),0))
  assert({r:2}, operator(mul, {r:1}, 2)(ev(0),0))
  assert({r:2}, operator(mul, 2, {r:1})(ev(0),0))
  assert({r:4,g:5}, operator(add, {r:1,g:2}, 3)(ev(0),0))
  assert({r:1}, operator(div, {r:[2,4]}, 2)(ev(0),0))
  assert({r:2}, operator(div, {r:[2,4]}, 2)(ev(1),1))
  assert({r:3}, operator(mul, {r:[1,2]}, [3,4])(ev(0),0))
  assert({r:8}, operator(mul, {r:[1,2]}, [3,4])(ev(1),1))
  assert({r:2}, operator(mul, {r:1}, [2,3])(ev(0),0))
  assert({r:3}, operator(mul, {r:1}, [2,3])(ev(1),1))
  assert({r:3}, operator(mul, [1,2], {r:3})(ev(0),0))
  assert({r:6}, operator(mul, [1,2], {r:3})(ev(1),1))
  assert({r:[2,3]}, operator(mul, {r:1}, fn([2,3]))(ev(0),0))
  assert({r:[3,6]}, operator(mul, {r:fn([1,2])}, 3)(ev(0),0))
  assert({r:3}, operator(add, {r:1}, {r:2})(ev(0),0))
  assert({r:1,g:6,b:4}, operator(mul, {r:1,g:2}, {g:3,b:4})(ev(0),0))
  assert({r:[3,6]}, operator(mul, fn([1,2]), {r:3})(ev(0),0))
  assert('ab', operator(add, 'a', 'b')(ev(0),0))
  assert('ab', operator(add, 'a', ['b','c'])(ev(0),0))
  assert('ac', operator(add, 'a', ['b','c'])(ev(1),1))
  assert(['ab','ac'], operator(add, 'a', fn(['b','c']))(ev(0),0))
  assert(['ac','bc'], operator(add, fn(['a','b']),'c')(ev(0),0))
  assert(undefined, operator(add, fn(1), 2).interval)
  assert('frame', operator(add, perFrame, 2).interval)
  assert('frame', operator(add, 1, perFrame).interval)
  assert('frame', operator(add, perFrame, perFrame).interval)
  assert('event', operator(add, perEvent, 2).interval)
  assert('event', operator(add, 1, perEvent).interval)
  assert('event', operator(add, perEvent, perEvent).interval)
  assert('frame', operator(add, perEvent, perFrame).interval)
  assert('frame', operator(add, perFrame, perEvent).interval)

  console.log('eval operator tests complete')

  return operator
})