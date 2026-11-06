'use strict'
define(function(require) {

  let skipString = (str, i) => { // i is just past the opening quote; returns index just past the closing quote
    while (i < str.length && str.charAt(i) !== '\'') { i++ }
    return i + 1
  }

  let findClose = (str, i) => { // i is just past the opening {; returns index of the matching }
    let depth = 0
    while (i < str.length) {
      let c = str.charAt(i)
      if (c === '\'') { i = skipString(str, i+1); continue }
      if (c === '{' || c === '(' || c === '[') { depth++ }
      else if (c === ')' || c === ']') { depth-- }
      else if (c === '}') {
        if (depth === 0) { return i }
        depth--
      }
      i++
    }
    return -1
  }

  let firstEntryEnd = (str, from, to) => {
    let depth = 0
    for (let i = from; i < to; i++) {
      let c = str.charAt(i)
      if (c === '\'') { i = skipString(str, i+1) - 1; continue }
      if (c === '{' || c === '(' || c === '[') { depth++ }
      else if (c === '}' || c === ')' || c === ']') { depth-- }
      else if (c === ',' && depth === 0) { return i }
    }
    return to
  }

  let isWordChar = (c) => /\w/.test(c)

  // Every slider{...} call site outside comments and strings, as character offsets into code.
  // valueFrom/valueTo span the positional value; equal (just past the {) when there is none.
  let findSliders = (code) => {
    let result = []
    let i = 0
    while (i < code.length) {
      let c = code.charAt(i)
      if (c === '\'') { i = skipString(code, i+1); continue }
      if (c === '/' && code.charAt(i+1) === '/') {
        while (i < code.length && code.charAt(i) !== '\n') { i++ }
        continue
      }
      if (c === '/' && code.charAt(i+1) === '*') {
        let e = code.indexOf('*/', i+2)
        i = e < 0 ? code.length : e + 2
        continue
      }
      if (code.startsWith('slider', i) && !isWordChar(code.charAt(i-1) || ' ')) {
        let j = i + 6
        while (code.charAt(j) === ' ' || code.charAt(j) === '\t') { j++ }
        if (code.charAt(j) === '{') {
          let open = j
          let close = findClose(code, open+1)
          if (close < 0) { break }
          let entryEnd = firstEntryEnd(code, open+1, close)
          let entry = code.slice(open+1, entryEnd)
          let isKeyed = /^\s*('[^']*'|[\w#./]+)\s*:/.test(entry)
          let empty = code.slice(open+1, close).trim() === ''
          let valueFrom = open+1, valueTo = open+1
          if (!isKeyed && entry.trim() !== '') {
            valueFrom = open+1 + (entry.length - entry.trimStart().length)
            valueTo = valueFrom + entry.trim().length
          }
          result.push({ open: open, close: close, valueFrom: valueFrom, valueTo: valueTo, hasValue: valueTo > valueFrom, empty: empty })
          i = open + 1
          continue
        }
      }
      i++
    }
    return result
  }

  // Tag each call site with its index so the runtime slider can be linked back to its place in the editor
  let injectInlineIds = (code, sites) => {
    let out = code
    for (let n = sites.length-1; n >= 0; n--) {
      let s = sites[n]
      let tag = (s.empty ? '' : ', ') + 'inline:' + n
      out = out.slice(0, s.close) + tag + out.slice(s.close)
    }
    return out
  }

  let formatValue = (v) => {
    if (Math.abs(v) < 1e-6) { return 0 } // String() of anything smaller uses exponent notation, which the DSL can't parse
    return parseFloat(v.toPrecision(3))
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      if (x !== a) { console.trace(`Assertion failed${msg?' '+msg:''}.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let values = (code) => findSliders(code).map(s => code.slice(s.valueFrom, s.valueTo))

    assert([], findSliders(''))
    assert([], findSliders('p1 play x, amp=1'))
    assert(['0.5'], values('p1 play x, amp=slider{0.5}'))
    assert([''], values('p1 play x, amp=slider{}'))
    assert([''], values('p1 play x, amp=slider{min:-5, max:5}'))
    assert(['-2'], values('p1 play x, amp=slider{ -2 , min:-5, max:5}'))
    assert(['1/2'], values('p1 play x, amp=slider{1/2}'))
    assert([''], values("p1 play x, amp=slider{'name':1}"))
    assert(['0.1','0.2'], values('p1 play x, amp=slider{0.1}, lpf=slider{0.2,max:2}'))
    assert(['0.1'], values('p1 play x, amp=slider {0.1}'))
    assert([], values('p1 play x, amp=myslider{0.1}'))
    assert([], values('p1 play x, amp=slider'))
    assert([], values('p1 play x//, amp=slider{0.1}'))
    assert([], values('p1 play x /* amp=slider{0.1} */'))
    assert(['0.3'], values('/* slider{0.1}\n */ p1 play x, amp=slider{0.3}'))
    assert([], values("p1 text 'slider{0.1}'"))
    assert(['(1,2)'], values('p1 play x, amp=slider{(1,2), max:{a:1}}'))
    assert(['0.4'], values('p1 play x,\n  amp=slider{0.4,\n  max:2}'))
    assert([true,false], findSliders('a=slider{}, b=slider{1}').map(s => s.empty))

    let inj = (code) => injectInlineIds(code, findSliders(code))
    assert('p1 play x, amp=slider{0.5, inline:0}', inj('p1 play x, amp=slider{0.5}'))
    assert('p1 play x, amp=slider{inline:0}', inj('p1 play x, amp=slider{}'))
    assert('a=slider{inline:0}, b=slider{1,max:{a:1}, inline:1}', inj('a=slider{}, b=slider{1,max:{a:1}}'))
    assert('// slider{1}\na=slider{2, inline:0}', inj('// slider{1}\na=slider{2}'))

    assert('0.5', String(formatValue(0.5004)))
    assert('0.123', String(formatValue(0.12345)))
    assert('1230', String(formatValue(1234.4)))
    assert('12.3', String(formatValue(12.3456)))
    assert('-2.5', String(formatValue(-2.5)))
    assert('0.00123', String(formatValue(0.0012345)))
    assert('0', String(formatValue(1e-9)))
    assert('123000', String(formatValue(123456)))

    console.log('Inline sliders tests complete')
  }

  return {
    findSliders: findSliders,
    injectInlineIds: injectInlineIds,
    formatValue: formatValue,
  }
})
