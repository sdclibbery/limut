'use strict';
define(function(require) {
  let evalParam = require('player/eval-param')

  let debug = false

  let objectMap = (obj, fn) => {
    return Object.fromEntries(
      Object.entries(obj).map(
        ([k, v], i) => [k, fn(v, k, i)]
      )
    )
  }

  let applyOperator = (op, el, er) => {
    if (typeof(el) == 'number') {
      if (typeof(er) == 'number') {
        return op(el,er)
      } else if (Array.isArray(er)) {
        return er.map(x => op(el,x))
      } else if (typeof er == 'object') {
        return objectMap(er, (v)=>op(el,v))
      }
    } else if (Array.isArray(el)) {
      if (typeof er == 'number') {
        return el.map(x => op(x,er))
      } else if (Array.isArray(er)) {
        let result = []
        for (let i = 0; i < Math.max(el.length, er.length); i++) {
          result.push(op(el[i % el.length], er[i % er.length]))
        }
        return result
      }
    } else if (typeof el == 'object') {
      if (typeof(er) == 'number') {
        return objectMap(el, (v)=>applyOperator(op,v,er))
      } else if (Array.isArray(er)) {
        return objectMap(el, (v)=>applyOperator(op,v,er))
      }
    }
  }

  let operator = (op, l, r) => {
    if (typeof l == 'number' && typeof (r) == 'number') {
      return op(l, r)
    }
    return (s,b) => {
      let el = evalParam(l, s,b)
      let er = evalParam(r, s,b)
      if (debug) { console.log('eval operator', 'l:',l,'r:',r, 'el:',el,'er:',er, 's:',s,'b:',b) }
      return applyOperator(op, el, er)
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let add = (a,b)=>a+b
  let mul = (a,b)=>a*b
  let div = (a,b)=>a/b
  let fn = (x)=>()=>x

  assert(3, operator(add, 1, 2))
  assert(8, operator(mul, 2, 4))
  assert([4,5], operator(add, fn([1,2]), 3)(0,0))
  assert([3,4], operator(add, 1, fn([2,3]))(0,0))
  assert([3,8], operator(mul, fn([1,2]), fn([3,4]))(0,0))
  assert([2,3], operator(mul, fn([1]), fn([2,3]))(0,0))
  assert({r:2}, operator(mul, {r:1}, 2)(0,0))
  assert({r:2}, operator(mul, 2, {r:1})(0,0))
  assert({r:4,g:5}, operator(add, {r:1,g:2}, 3)(0,0))
  assert({r:1}, operator(div, {r:[2,4]}, 2)(0,0))
  assert({r:2}, operator(div, {r:[2,4]}, 2)(1,1))
  assert({r:3}, operator(mul, {r:[1,2]}, [3,4])(0,0))
  assert({r:8}, operator(mul, {r:[1,2]}, [3,4])(1,1))
  assert({r:2}, operator(mul, {r:1}, [2,3])(0,0))
  assert({r:3}, operator(mul, {r:1}, [2,3])(1,1))
  assert({r:3}, operator(mul, [1,2], {r:3})(0,0))
  assert({r:6}, operator(mul, [1,2], {r:3})(1,1))
  assert({r:[2,3]}, operator(mul, {r:1}, fn([2,3]))(0,0))
  assert({r:[3,6]}, operator(mul, {r:fn([1,2])}, 3)(0,0))

  // {r:1}+{r:2}
  // {r:1,g:2}*{g:3,b:4}

  console.log('eval operator tests complete')

  return operator
})