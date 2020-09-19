'use strict';
define(function(require) {
  let param = require('player/default-param')
  let evalParam = require('player/eval-param').evalParamFrame
  let operator = require('player/eval-operator')
  let varLookup = require('player/parse-var')

  let debugParse = false
  let debugEval = false
  if (debugEval) { let original = evalParam; evalParam = (v,s,b) => { console.log('eval',v,s,b); return original(v,s,b)} }

  let timeVarSteps = (vs, ds) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    let steps = []
    let length = 0
    let step = 0
    vs.forEach(v => {
      let dur = ds[step % ds.length]
      steps.push({ value:v, time:length, duration:dur })
      length += dur
      step += 1
    })
    steps.totalDuration = length
    if (debugParse) { console.log('timeVar steps', steps) }
    return steps
  }
  let isInTimeVarStep  = (st, b, l) => {
    return (b > st.time-0.0001)&&(b < st.time+st.duration-0.0001)
  }
  let timeVar = (vs, ds) => {
    if (Array.isArray(ds)) { ds = expandColon(ds) }
    let steps = timeVarSteps(vs, ds)
    return (s,b) => {
      b = (b+0.0001) % steps.totalDuration
      let step = steps.filter(st => isInTimeVarStep(st, b) )[0]
      if (debugEval) { console.log('eval timeVar', steps, 'b:', b, 'step:', step) }
      return (step !== undefined) && step.value
    }
  }
  let linearTimeVar = (vs, ds) => {
    let steps = timeVarSteps(vs, ds)
    return (s,b) => {
      b = b % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, b)) {
          let post = steps[(idx+1) % steps.length]
          let lerp = (b - pre.time) / pre.duration
          if (debugEval) { console.log('eval linear timeVar', steps, 'b:', b, 'pre:', pre, 'post:', post, 'lerp:', lerp) }
          return (1-lerp)*pre.value + lerp*post.value
        }
      }
      if (debugEval) { console.log('eval linear timeVar FAILED', steps, 'b:', b) }
    }
  }
  let sTimeVar = (vs, ds) => {
    let steps = timeVarSteps(vs, ds)
    return (s,b) => {
      b = b % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, b)) {
          let post = steps[(idx+1) % steps.length]
          let lerp = (b - pre.time) / pre.duration
          if (debugEval) { console.log('eval s timeVar', steps, 'b:', b, 'pre:', pre, 'post:', post, 'lerp:', lerp) }
          lerp = lerp*lerp*(3 - 2*lerp) // bezier ease in/out
          return (1-lerp)*pre.value + lerp*post.value
        }
      }
      if (debugEval) { console.log('eval s timeVar FAILED', steps, 'b:', b) }
    }
  }

  let doArray = (state, open, close, seperator) => {
    let result = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == open) {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == seperator) {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == close) {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    if (debugParse) { console.log('doArray', result, state) }
    return result
  }
  let array = (state, open, close) => {
    let tryState = Object.assign({}, state)
    let commaArray = doArray(tryState, open, close, ',')
    if (commaArray != undefined) {
      Object.assign(state, tryState)
      commaArray.seperator = ','
      if (debugParse) { console.log('array', commaArray.seperator, commaArray, state) }
      return commaArray
    }
    let colonArray = doArray(state, open, close, ':')
    if (colonArray == undefined) { return [] }
    colonArray.seperator = ':'
    if (debugParse) { console.log('array', colonArray.seperator, colonArray, state) }
    return colonArray
  }
  let expandColon = (vs) => {
    if (vs.seperator == ':') {
      let lo = 0
      let hi = 1
      if (vs.length == 1) {
        hi = vs[0]
      } else if (vs.length == 2) {
        lo = vs[0]
        hi = vs[1]
      }
      if (Number.isInteger(lo) && Number.isInteger(hi)) {
        return [...Array(hi-lo+1).keys()].map(x => x+lo)
      }
    }
    return vs
  }

  let numberOrArrayOrFour = (state) => {
    let n = number(state)
    if (n !== undefined) {
      return n
    } else {
      if (state.str.charAt(state.idx) == '[') {
        let ds = array(state, '[', ']')
        return ds
      } else {
        return 4
      }
    }
  }

  let evalRandomRanged = (lo, hi) => {
    if (debugEval) { console.log('eval evalRandomRanged', lo, hi) }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      return lo + Math.random() * (hi-lo)
    } else {
      return lo + Math.floor(Math.random() * (hi-lo+0.9999))
    }
  }
  let evalRandomSet = (vs, s,b) => {
    let idx = Math.floor(Math.random()*vs.length*0.9999)
    if (debugEval) { console.log('eval evalRandomRanged', vs.length, idx, s,b) }
    return evalParam(vs[idx], s,b)
  }
  let periodicRandom = (getter, period) => {
    let lastBeat, lastValue
    return (s,b) => {
      if (lastValue === undefined || period === undefined || b >= lastBeat+period-0.0001) {
        lastBeat = b
        lastValue = getter(s,b)
      }
      return lastValue
    }
  }

  let numberValue = (state) => {
    let value = ''
    let char
    let sign = true
    let fraction = false
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (sign && char == '-') {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      if ((char >= '0' && char <= '9') || char == '.' || char == 'e') {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      break
    }
    if (value == '') { return undefined }
    return parseFloat(value)
  }
  let number = (state) => {
    let numerator = numberValue(state)
    if (numerator === undefined) { return undefined }
    let denominator = 1
    if (state.str.charAt(state.idx) == '/') {
      state.idx += 1
      denominator = numberValue(state)
      if (denominator === undefined) {
        state.idx -= 1
        denominator = 1
      }
    }
    if (debugParse) { console.log('number', numerator/denominator, state) }
    return numerator/denominator
  }

  let eatWhitespace = (state) => {
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      break
    }
  }
  let identifier = (state) => {
    let char
    let result = ''
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_') {
        result += char
        state.idx += 1
        continue
      }
      break
    }
    return result
  }
  let parseMapEntry = (state) => {
    eatWhitespace(state)
    let k = identifier(state)
    if (k === '') { return }
    eatWhitespace(state)
    if (state.str.charAt(state.idx) !== ':') { return }
    state.idx += 1
    eatWhitespace(state)
    let v = expression(state)
    eatWhitespace(state)
    if (debugParse) { console.log('map entry', k, v, state) }
    return {k:k,v:v}
  }
  let parseMap = (state) => {
    let result = {}
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      if (char == '{' || char == ',') {
        state.idx += 1
        let e = parseMapEntry(state)
        if (e) { result[e.k] = e.v }
      } else if (char == '}') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    if (debugParse) { console.log('map', result, state) }
    return result
  }

  let parseString = (state) => {
    let result = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '\'') {
        state.idx += 1
        break
      }
      result += char
      state.idx += 1
    }
    if (debugParse) { console.log('string', result, state) }
    return result
  }

  let parseInterval = (state) => {
    eatWhitespace(state)
    let result
    if (state.str.charAt(state.idx) == '@') {
      state.idx += 1
      if (state.str.charAt(state.idx) == 'f') {
        state.idx += 1
        result = 'frame'
        if (debugParse) { console.log('interval', result, state) }
      }
    }
    return result
  }

  let parseColour = (state) => {
    let str = ''
    let char
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
        str += char
        state.idx += 1
        continue
      }
      break
    }
    let result = {}
    if (str.length == 4) {
      let hex1 = (c) => parseInt(c,16)*0x11/255
      result.r = hex1(str.substr(0,1))
      result.g = hex1(str.substr(1,1))
      result.b = hex1(str.substr(2,1))
      result.a = hex1(str.substr(3,1))
    } else if (str.length == 8) {
      let hex2 = (c) => parseInt(c,16)/255
      result.r = hex2(str.substr(0,2))
      result.g = hex2(str.substr(2,2))
      result.b = hex2(str.substr(4,2))
      result.a = hex2(str.substr(6,2))
    }
    if (debugParse) { console.log('colour', result, state) }
    return result
  }

  let expression = (state) => {
    if (debugParse) { console.log('expression', state) }
    let lhs = undefined
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      if (char === '/' && state.str.charAt(state.idx+1) === '/') {
        // comment
        state.idx = state.str.length
        state.commented = true
        break
      }
      // array / time var / random
      if (char == '[') {
        let vs = array(state, '[', ']')
        if (state.str.charAt(state.idx).toLowerCase() == 't') {
          state.idx += 1
          vs = expandColon(vs)
          let ds = numberOrArrayOrFour(state)
          if (debugParse) { console.log('array t', vs, ds) }
          lhs = timeVar(vs, ds)
          lhs.interval = 'frame'
        } else if (state.str.charAt(state.idx).toLowerCase() == 'l') {
          state.idx += 1
          let ds = numberOrArrayOrFour(state)
          if (debugParse) { console.log('array l', vs, ds) }
          lhs = linearTimeVar(vs, ds)
          lhs.interval = 'frame'
        } else if (state.str.charAt(state.idx).toLowerCase() == 's') {
          state.idx += 1
          let ds = numberOrArrayOrFour(state)
          if (debugParse) { console.log('array s', vs, ds) }
          lhs = sTimeVar(vs, ds)
          lhs.interval = 'frame'
        } else if (state.str.charAt(state.idx).toLowerCase() == 'r') {
          state.idx += 1
          let period = number(state)
          let interval = parseInterval(state)
          let rand
          if (vs.seperator == ':') {
            let lo = param(vs[0], 0)
            let hi = param(vs[1], 1)
            if (debugParse) { console.log('array r:', vs, lo, hi) }
            rand = (s,b) => evalRandomRanged(evalParam(lo,s,b), evalParam(hi,s,b))
          } else {
            if (debugParse) { console.log('array r,', vs) }
            rand = (s,b) => evalRandomSet(vs, s,b)
          }
          lhs = periodicRandom(rand, period)
          lhs.interval = interval ? interval : (period ? 'frame' : undefined)
        } else {
          vs = expandColon(vs)
          if (debugParse) { console.log('array', vs) }
          lhs = vs
        }
        continue
      }
      // tuple
      if (char == '(') {
        let v = array(state, '(', ')')
        v = expandColon(v)
        if (v.length == 1) {
          lhs = v[0]
        } else {
          lhs = (s,b) => v.map(x => evalParam(x,s,b))
        }
        continue
      }
      // map
      if (char == '{') {
        lhs = parseMap(state)
        continue
      }
      // operator
      if (lhs !== undefined) {
        if (char == '+') {
          state.idx += 1
          let rhs  = expression(state)
          if (debugParse) { console.log('operator+', lhs, rhs, state) }
          return operator((l,r)=>l+r, lhs, rhs)
        }
        if (char == '-') {
          state.idx += 1
          let rhs  = expression(state)
          if (debugParse) { console.log('operator-', lhs, rhs, state) }
          return operator((l,r)=>l-r, lhs, rhs)
        }
        if (char == '*') {
          state.idx += 1
          let rhs  = expression(state)
          if (debugParse) { console.log('operator*', lhs, rhs, state) }
          return operator((l,r)=>l*r, lhs, rhs)
        }
        if (char == '/') {
          state.idx += 1
          let rhs  = expression(state)
          if (debugParse) { console.log('operator/', lhs, rhs, state) }
          return operator((l,r)=>l/r, lhs, rhs)
        }
        if (char == '%') {
          state.idx += 1
          let rhs  = expression(state)
          if (debugParse) { console.log('operator%', lhs, rhs, state) }
          return operator((l,r)=>l%r, lhs, rhs)
        }
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        lhs = n
        if (debugParse) { console.log('number', lhs, state) }
        continue
      }
      // string
      if (char == '\'') {
        state.idx += 1
        lhs = parseString(state)
        continue
      }
      // colour
      if (char == '#') {
        state.idx += 1
        lhs = parseColour(state)
        continue
      }
      // vars
      let v = varLookup(state)
      if (v !== undefined) {
        lhs = v
        if (debugParse) { console.log('var', lhs, state) }
        continue
      }
      break
    }
    return lhs
  }

  let parseExpression = (v, commented) => {
    if (v == '' || v == undefined) { return }
    if (debugParse || debugEval) { console.log('*** parseExpression', v) }
    v = v.trim()
    let state = {
      str: v,
      idx: 0,
    }
    let result =  expression(state)
    if (commented && state.commented) { commented() }
    return result
  }

  // TESTS //

  let vars = require('vars')
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertIn = (lo, hi, actual) => {
    if (actual < lo-0.0001 || actual > hi+0.0001) { console.trace(`Assertion failed.\n>>Expected ${lo} - ${hi}\n>>Actual: ${actual}`) }
  }
  let assertInteger = (v) => {
    if (!Number.isInteger(v)) { console.trace(`Assertion failed.\n>>Expected ${v} to be an Integer`) }
  }
  let assertNotInteger = (v) => {
    if (Number.isInteger(v)) { console.trace(`Assertion failed.\n>>Expected ${v} not to be an Integer`) }
  }
  let assertOneOf = (vs, actual) => {
    if (!vs.includes(actual)) { console.trace(`Assertion failed.\n>>Expected one of ${vs}\n>>Actual: ${actual}`) }
  }

  assert(undefined, parseExpression())
  assert(undefined, parseExpression(''))
  assert(1, parseExpression('1'))
  assert(123, parseExpression('123'))
  assert(1.1, parseExpression('1.1'))
  assert(.123, parseExpression('.123'))
  assert(-1, parseExpression('-1'))
  assert(1e9, parseExpression('1e9'))
  assert([1,2], parseExpression('[1,2]'))
  assert([1,[2,3]], parseExpression('[1,[2,3]]'))
  assert([1,[2,3]], parseExpression(' [ 1 , [ 2  , 3 ] ] '))
  assert(1, parseExpression('(1)'))
  assert([0,1,2,3], parseExpression('[:3]'))
  assert([2,3], parseExpression('[2:3]'))
  assert([2.25,3.5], parseExpression('[2.25:3.5]'))

  let p
  p = parseExpression('(1,2)')
  assert([1,2], p(0,0))
  assert([1,2], p(1,1))

  p = parseExpression('[1,(2,3)]')
  assert(1, p[0])
  assert([2,3], p[1](0,0))

  assert(6, parseExpression('1+2+3'))

  p = parseExpression('[1,2]T1')
  assert(1, p(0,0))
  assert(1, p(0,1/2))
  assert(2, p(0,1))
  assert(2, p(0,3/2))
  assert(1, p(0,2))

  p = parseExpression('[1,2]T')
  assert(1, p(0,0))
  assert(1, p(0,3.9))
  assert(2, p(0,4))

  p = parseExpression('[1,2,3]t[1,2]')
  assert(1, p(0,0))
  assert(2, p(0,1))
  assert(2, p(0,2))
  assert(3, p(0,3))
  assert(1, p(0,4))

  p = parseExpression('[(0,2),(1,3)]')
  assert([0,2], p[0]())
  assert([1,3], p[1]())

  p = parseExpression('[(0,2),(1,3)]T')
  assert([0,2], p(0,0)())
  assert([1,3], p(4,4)())

  vars.foo = 'bar'
  p = parseExpression('foo')
  vars.foo = 'baz'
  assert('baz', p())
  vars.foo = undefined

  vars['foo.woo'] = 'bar'
  p = parseExpression('foo.woo')
  assert('bar', p())
  vars['foo.woo'] = undefined

  vars['foo'] = 'bar'
  p = parseExpression('FoO')
  assert('bar', p())
  vars['foo'] = undefined

  vars.foo = 2
  p = parseExpression('[1,foo]')
  vars.foo = 3
  assert(1, p[0])
  assert(3, p[1]())
  vars.foo = undefined

  p = parseExpression('[1,2]+[3,4] ')
  assert(4, p(0,0))
  assert(6, p(1,1))
  assert(4, p(2,2))

  p = parseExpression(' [ 1 , 2 ] + 3 ')
  assert(4, p(0,0))
  assert(5, p(1,1))
  assert(4, p(2,2))

  p = parseExpression('1+[2,3]')
  assert(3, p(0,0))
  assert(4, p(1,1))
  assert(3, p(2,2))

  p = parseExpression('[1,2,3]+[4,5] ')
  assert(5, p(0,0))
  assert(7, p(1,1))
  assert(7, p(2,2))
  assert(6, p(3,3))

  p = parseExpression('[1,2]t1+3 ')
  assert(4, p(0,0))
  assert(5, p(0,1))
  assert(4, p(0,2))

  p = parseExpression('3+[1,2]t1 ')
  assert(4, p(0,0))
  assert(5, p(0,1))
  assert(4, p(0,2))

  p = parseExpression('[1,2]t1+[3,4]t1')
  assert(4, p(0,0))
  assert(6, p(0,1))
  assert(4, p(0,2))

  p = parseExpression('2+foo+2')
  vars.foo = parseExpression('[1,2]t1')
  assert(5, p(0,0))
  assert(6, p(0,1))
  assert(5, p(0,2))
  vars.foo = parseExpression('5')
  assert(9, p(0,3))
  vars.foo = undefined

  assert([4,5], parseExpression('(1,2)+3')())
  assert([4,5], parseExpression('3+(1,2)')())
  assert([8,9], parseExpression('(1,2)+3+4 ')())
  assert([4,6], parseExpression('(1,2)+(3,4) ')())
  assert([5,7,7], parseExpression('(1,2,3)+(4,5) ')())
  assert(3, parseExpression('(1)+2'))
  assert(3, parseExpression('(1+2)'))
  assert(6, parseExpression('(1+2)+3'))

  p = parseExpression('[1,2]t1+(3,4) ')
  assert([4,5], p(0,0))
  assert([5,6], p(0,1))
  assert([4,5], p(0,2))

  p = parseExpression('foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1')
  assert([1,3], p(0,0))
  vars.foo = undefined

  p = parseExpression('(foo,[3,4]t1)')
  vars.foo = parseExpression('[1,2]t1')
  assert([1,3], p(0,0))
  assert([2,4], p(1,1))
  vars.foo = undefined

  p = parseExpression('[1,2]+(3,4) ')
  assert([4,5], p(0,0))
  assert([5,6], p(1,1))
  assert([4,5], p(2,2))

  assert([4,5], parseExpression('[(1,2)]+3')(0,0))

  assert(1/2, parseExpression('1/2'))
  assert(1/2, parseExpression('(1/2)'))
  assert([1,2], parseExpression('(2,4)/2')(0,0))
  assert(1, parseExpression('[2,4]/2')(0,0))
  assert(2, parseExpression('[2,4]/2')(1,1))

  assert(4, parseExpression('2+4/2'))
  assert(3, parseExpression('(2+4)/2'))
  assert(4, parseExpression('4/2+2'))
  assert(1, parseExpression('4/(2+2)'))

  assert(10, parseExpression('2+4*2'))
  assert(12, parseExpression('(2+4)*2'))
//  assert(10, parseExpression('4*2+2'))
  assert(16, parseExpression('4*(2+2)'))

  assert(4, parseExpression('2*2'))
  assert([2,4], parseExpression('(1,2)*2')(0,0))
  assert(100, parseExpression('[1,2]*100')(0,0))
  assert(200, parseExpression('[1,2]*100')(1,1))

  assert(1, parseExpression('3%2'))
  assert([1,0], parseExpression('(5,6)%2')(0,0))
  assert(2, parseExpression('[5,6]%3')(0,0))
  assert(0, parseExpression('[5,6]%3')(1,1))

  p = parseExpression('[1,5,7]r')
  for (let i = 0; i<20; i+=1) {
    let v = p()
    assertOneOf([1,5,7], v)
    assertInteger(v, 'v:'+v)
  }

  p = parseExpression('[0:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, p())
    assertInteger(p())
  }

  p = parseExpression('[[0,10]:[9,19]]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, p(0,0))
    assertInteger(p(0,0))
  }
  for (let i = 0; i<20; i+=1) {
    assertIn(10, 19, p(1,1))
    assertInteger(p(1,1))
  }

  p = parseExpression('[:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, p())
    assertInteger(p())
  }

  p = parseExpression('[9]r')
  for (let i = 0; i<20; i+=1) {
    assert(9, p())
  }

  p = parseExpression('[0.1:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, p())
    assertNotInteger(p())
  }

  assert(1, parseExpression('2-1'))

  p = parseExpression('[0,2]l2')
  assert(0, p(0,0))
  assert(1/2, p(1/2,1/2))
  assert(1, p(1,1))
  assert(2, p(2,2))
  assert(1, p(3,3))
  assert(0, p(4,4))

  p = parseExpression('[0:2]l2')
  assert(0, p(0,0))
  assert(1, p(1,1))
  assert(2, p(2,2))
  assert(1, p(3,3))
  assert(0, p(4,4))

  p = parseExpression('[0,1]s1')
  assert(0, p(0,0))
  assertIn(0.1, 0.4, p(1/4,1/4))
  assert(1/2, p(1/2,1/2))
  assertIn(0.6, 0.9, p(3/4,3/4))
  assert(1, p(1,1))
  assertIn(0.6, 0.9, p(5/4,5/4))
  assert(1/2, p(3/2,3/2))
  assertIn(0.1, 0.4, p(7/4,7/4))
  assert(0, p(2,2))

  p = parseExpression('[1,2]T0.5')
  assert(1, p(0,0))
  assert(2, p(1/2,1/2))
  assert(1, p(1,1))

  p = parseExpression('[1,2]T1/2')
  assert(1, p(0,0))
  assert(2, p(1/2,1/2))
  assert(1, p(1,1))

  assert({x:0}, parseExpression('{x:0}'))
  assert({x:0}, parseExpression(' { x : 0 } '))
  assert({x:0}, parseExpression('{X:0}'))
  assert({x:1,y:2}, parseExpression('{x:1,y:2}'))
  assert({x:1/2}, parseExpression('{x:1/2}'))
  assert({x:2}, parseExpression('{x:1+1}'))

  p = parseExpression('{x:[1,2]}')
  assert(1, p.x[0])
  assert(2, p.x[1])
  assert(undefined, p.x[2])

  assert('a', parseExpression("'a'"))
  assert(' a B c ', parseExpression("' a B c '"))

  assert({r:0,g:0.26666666666666666,b:0.5333333333333333,a:1}, parseExpression("#048f"))
  assert({r:0,g:0.25098039215686274,b:0.03137254901960784,a:1}, parseExpression("#004008ff"))

  assert({r:2}, parseExpression("{r:1}*2")(0,0))

  p = parseExpression("[1,2]t2/2")
  assert(1, p(0,0))
  assert(2, p(1,1))
  assert(1, p(2,2))

  p = parseExpression("[1,2]t2*2")
  assert(2, p(0,0))
  assert(2, p(1,1))
  assert(4, p(2,2))
  assert(4, p(3,3))
  assert(2, p(4,4))

  assert('http://a.com/Bc.mp3', parseExpression("'http://a.com/Bc.mp3'"))

  assert(2, parseExpression("[1]+1")(0,0))
  assert([1], parseExpression("[1]//+1"))

  p = parseExpression("[#f00f,#00ff]t1")
  assert({r:1,g:0,b:0,a:1}, p(0,0))
  assert({r:0,g:0,b:1,a:1}, p(1,1))

  p = parseExpression('[1,2]r1')
  let v0 = p(0,0)
  for (let i = 0; i<20; i+=1) { assert(v0, p(0,0)) }
  let v1 = p(1,1)
  for (let i = 0; i<20; i+=1) { assert(v1, p(1,1)) }

  assert('ab', parseExpression("'a'+'b'")(0,0))

  assert(undefined, parseExpression("[0,1]r").interval)
  assert(undefined, parseExpression("[0:1]r").interval)
  assert('frame', parseExpression("[0,1]r4").interval)
  assert('frame', parseExpression("[0,1]r@f").interval)
  assert('frame', parseExpression("[0,1]r @f").interval)

  assert(undefined, parseExpression("[0,1]").interval)
  assert('frame', parseExpression("[0,1]t4").interval)
  assert('frame', parseExpression("[0,1]t4@f").interval)

  assert(undefined, parseExpression("[0,1]").interval)
  assert('frame', parseExpression("[0,1]l4").interval)
  assert('frame', parseExpression("[0,1]l4@f").interval)

  assert(undefined, parseExpression("[0,1]").interval)
  assert('frame', parseExpression("[0,1]s4").interval)
  assert('frame', parseExpression("[0,1]s4@f").interval)

  console.log('Parse expression tests complete')

  return parseExpression
})
