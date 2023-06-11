'use strict';
define(function(require) {
  let {combineIntervalsFrom} = require('expression/intervals')

  let objectMap = (obj, fn) => {
    if (obj.hasOwnProperty('value')) { // 'value' field implies this is an object with subparams instead of a normal object
      obj.value = fn(obj.value)
      return obj
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
          let erv = er[k]
          result[k] = (erv !== undefined) ? operator(op,el[k],erv) : el[k]
        }
        for (let k in er) {
          if (result[k] === undefined) { result[k] = er[k] }
        }
        return result
      }
    }
  }

  let operator = (op, l, r) => {
    if (isPrimitive(l) && isPrimitive(r)) {
      return op(l, r)
    }
    let evalOp = (event,b,evalRecurse) => {
      let el = evalRecurse(l, event,b)
      let er = evalRecurse(r, event,b)
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
  assert({r:2}, operator(mul, {r:1}, 2)(ev(0),0,evalParam))
  assert({r:2}, operator(mul, 2, {r:1})(ev(0),0,evalParam))
  assert({r:4,g:5}, operator(add, {r:1,g:2}, 3)(ev(0),0,evalParam))
  assert({r:3}, operator(add, {r:1}, {r:2})(ev(0),0,evalParam))
  assert({r:1,g:6,b:4}, operator(mul, {r:1,g:2}, {g:3,b:4})(ev(0),0,evalParam))
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

  console.log('eval operator tests complete')
  }
  
  return operator
})