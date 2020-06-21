define(function(require) {

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let parseParams = (paramsStr) => {
    let params = {}
    splitOnAll(paramsStr, ', ')
      .map(p => splitOnAll(p, '='))
      .forEach(([n,v]) => params[n.toLowerCase()] = v)
    return params
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert({}, parseParams(''))
  assert({dur:'1'}, parseParams('dur=1'))
  assert({dur:'1', oct:'4'}, parseParams('dur=1, oct=4'))
  assert({dur:'4', oct:'5', decay:'2', attack:'2'}, parseParams('dur=4, oct=5, decay=2, attack=2'))
  assert({dur:'1/2'}, parseParams('dur=1/2'))
  assert({dur:'[1]'}, parseParams('dur=[1]'))
  assert({dur:'[1,1]'}, parseParams('dur=[1,1]'))

  console.log("Params tests complete")

  return parseParams
});
