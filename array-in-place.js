'use strict'
define((require) => {

  let move = (from, to, predicate) => {
    let fromIdx = 0
    from.forEach((e, i) => { 
      if (!predicate(e, i, from)) {
        if (i!==fromIdx) { from[fromIdx] = e }
        fromIdx++
      } else {
        to.push(e)
      }
    })
    from.length = fromIdx
  }

  let filterInPlace = (arr, predicate) => {
    let j = 0
    arr.forEach((e, i) => { 
      if (predicate(e, i, arr)) {
        if (i!==j) { arr[j] = e }
        j++
      }
    })
    arr.length = j
    return arr
  }

  //----- Tests
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    let testMove = (expectedFrom, expectedTo, from, to, predicate) => {
      move(from, to, predicate)
      assert(expectedFrom, from)
      assert(expectedTo, to)
    }
    testMove([], [], [], [], (x) => x==2)
    testMove([1], [1], [1], [1], (x) => x==2)
    testMove([1], [2], [1], [2], (x) => x==2)
    testMove([1], [2,2], [1,2], [2], (x) => x==2)
    testMove([1], [3,2,2], [1,2,2], [3], (x) => x==2)

    assert([], filterInPlace([], (x) => x==2))
    assert([], filterInPlace([1], (x) => x==2))
    assert([2], filterInPlace([1,2], (x) => x==2))
    assert([2], filterInPlace([1,1,2], (x) => x==2))
    assert([2,2], filterInPlace([1,2,2], (x) => x==2))
  }  
  
  return {
    move:move,
    filterInPlace:filterInPlace,
  }
})