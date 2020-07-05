define(function(require) {

  let vars = require('vars')
  let evalParam = require('player/eval-param')

  let debugParse = false
  let debugEval = false

  let timeVar = (vs, ds) => {
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
    if (debugParse) { console.log('timeVar', steps) }
    return (s,b) => {
      b = b % length
      let step = steps.filter(s => (b > s.time-0.0001)&&(b < s.time+s.duration-0.0001) )[0]
      if (debugEval) { console.log('eval timeVar', steps, 'b:', b, 'step:', step) }
      return step && step.value
    }
  }

  let operator = (op, l, r) => {
    if (typeof l == 'number' && typeof (r) == 'number') {
      return op(l, r)
    }
    return (s,b) => {
      let el = evalParam(l, s,b)
      let er = evalParam(r, s,b)
      if (debugEval) { console.log('eval operator', 'l:',l,'r:',r, 'el:',el,'er:',er, 's:',s,'b:',b) }
      if (typeof(el) == 'number') {
        if (typeof(er) == 'number') {
          return op(el,er)
        } else {
          return er.map(x => op(x,el))
        }
      } else {
        if (typeof r == 'number') {
          return el.map(x => op(x,er))
        } else {
          let result = []
          for (let i = 0; i < Math.max(el.length, er.length); i++) {
            result.push(el[i % el.length] + er[i % er.length])
          }
          return result
        }      }
    }
  }

  let array = (state, open, close) => {
    let result = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == open) {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == ',') {
        state.idx += 1
        let v = expression(state)
        result.push(v)
      } else if (char == close) {
        state.idx += 1
        break
      }
    }
    if (debugParse) { console.log('array', result, state) }
    return result
  }

  let varLookup = (state) => {
    if (state.str.substring(state.idx, state.idx+5) !== 'vars.') { return undefined }
    state.idx += 5
    let key = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || (char == '_')) {
        key += char
        state.idx += 1
        continue
      }
      break
    }
    if (debugParse) { console.log('varLookup', key, state) }
    return (s,b) => {
      if (debugEval) { console.log('eval varLookup', 'key:',key, 'val:',vars[key], 's:',s,'b:',b) }
      return evalParam(vars[key] ,s,b)
    }
  }

  let number = (state) => {
    let value = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if ((char >= '0' && char <= '9') || char == '.' || char == '-' || char == 'e') {
        value += char
        state.idx += 1
        continue
      }
      break
    }
    if (value == '') { return undefined }
    if (debugParse) { console.log('number', value, state) }
    return parseFloat(value)
  }

  let expression = (state) => {
    if (debugParse) { console.log('expression', state) }
    let lhs
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (char == ' ' || char == '\t' || char == '\n' || char == '\r') { state.idx += 1; continue }
      // array
      if (char == '[') {
        let vs = array(state, '[', ']')
        if (state.str.charAt(state.idx) == 't') {
          state.idx += 1
          let n = number(state)
          if (n !== undefined) {
            lhs = timeVar(vs, n)
          } else {
            if (state.str.charAt(state.idx) == '[') {
              let ds = array(state, '[', ']')
              lhs = timeVar(vs, ds)
            } else {
              lhs = timeVar(vs, 4)
            }
          }
        } else {
          lhs = vs
        }
        continue
      }
      // tuple
      if (char == '(') {
        let v = array(state, '(', ')')
        if (v.length == 1) {
          lhs = v[0]
        } else {
          lhs = () => v
        }
        continue
      }
      // vars
      if (char == 'v') {
        lhs = varLookup(state)
        continue
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        lhs = n
        continue
      }
      // operator
      if (char == '/') {
        state.idx += 1
        let rhs  = expression(state)
        if (debugParse) { console.log('operator/', lhs, rhs, state) }
        return operator((l,r)=>l/r, lhs, rhs)
      }
      if (char == '+') {
        state.idx += 1
        let rhs  = expression(state)
        if (debugParse) { console.log('operator+', lhs, rhs, state) }
        return operator((l,r)=>l+r, lhs, rhs)
      }
      break
    }
    return lhs
  }

  let parseExpression = (v) => {
    if (debugParse) { console.log('*** parseExpression', v) }
    v = v.trim().toLowerCase()
    let state = {
      str: v,
      idx: 0,
      bracketStack: [],
    }
    return expression(state)
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

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

  p = parseExpression('[1,2,3]T[1,2]')
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
  p = parseExpression('vars.foo')
  vars.foo = 'baz'
  assert('baz', p())
  vars.foo = undefined

  vars.foo = 2
  p = parseExpression('[1,vars.foo]')
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

  p = parseExpression('2+vars.foo+2')
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

  p = parseExpression('vars.foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1')
  assert([1,3], p(0,0))
  vars.foo = undefined

  // [1,2]+(3,4) [(1,2)]+3 [1,2]+vars.foo 1+[2,3]+4+[5,6]t1+(7,8) ([1,2]+(3,4))

  console.log('Parse expression tests complete')

  return parseExpression
})
