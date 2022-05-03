'use strict'
define((require) => {
  let {parseLine} = require('parse-line')
  let parseString = require('player/parse-string')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')
  let sliders = require('sliders')

  let parseCode = (code) => {
    let lines = code.split('\n').map(l => l.trim())
    for (let i = 0; i<lines.length; i++) {
      try {
        let line = lines[i]
        if (line === '') { continue }
        if (line.startsWith('//')) { continue }
        line = preParseLine(line)
        while ((i+1)<lines.length && line.endsWith(' \\')) {
          if (!lines[i+1].startsWith('//')) {
            line = line.slice(0, -2) + ' ' + preParseLine(lines[i+1])
          }
          i++
        }
        parseLine(line, i)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Error on line '+(i+1)+': ' + e + st)
        console.log(e)
      }
    }
  }

  let preParseLine = (line) => {
    let state = {
      str: line,
      idx: 0,
    }
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '\'') { // String - skip over
        state.idx += 1
        parseString(state)
      } else if (char == '/' && state.str.charAt(state.idx+1) == '/') { // Comment
        let result = line.slice(0, state.idx).trim()
        if (line.endsWith(' \\')) {
          result += ' \\'
        }
        return result
      } else {
        state.idx += 1
      }
    }
    return line
  }

  let updateCode = (code) => {
    system.resume()
    players.gc_reset()
    mainVars.reset()
    players.overrides = {}
    sliders.gc_reset()
    consoleOut('> Update code')
    parseCode(code)
    players.gc_sweep()
    sliders.gc_sweep()
    players.expandOverrides()
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let vars = require('vars')

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let assertVars = (code, expected) => {
      parseCode(code)
      Object.keys(expected).forEach(k => {
        assert(expected[k], vars[k])
        delete vars[k]
      })
    }
    let assertOverrides = (code, playerId, expected) => {
      parseCode(code)
      Object.keys(expected).forEach(k => {
        assert(expected[k], players.overrides[playerId][k])
      })
      delete players.overrides[playerId]
    }
  
    assertVars('', {})
    assertVars(' \n \n ', {})

    assertVars('//set foo=1+1', {foo:undefined})

    assertVars('set foo=1+1', {foo:2})
    assertVars(' \n//yo \nset foo=1+1 \n \n \n\n set bar = 2 + 2 \n ', {foo:2,bar:4})

    assertOverrides('set p amp=2', 'p', {amp:2})
    assertOverrides('set p foo=2, bar=4', 'p', {foo:2,bar:4})

    assertOverrides('set \\\np foo=2,bar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p  \\\nfoo=2,bar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo \\\n=2,bar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo= \\\n2,bar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo=2 \\\n,bar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo=2, \\\nbar=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo=2,bar \\\n=4', 'p', {foo:2,bar:4})
    assertOverrides('set p foo=2,bar= \\\n4', 'p', {foo:2,bar:4})
  
    assertOverrides(' set  \\\n p foo = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p  \\\n foo = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo  \\\n = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo =  \\\n 2 , bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo = 2  \\\n , bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo = 2 ,  \\\n bar = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo = 2 , bar  \\\n = 4 ', 'p', {foo:2,bar:4})
    assertOverrides(' set p foo = 2 , bar =  \\\n 4 ', 'p', {foo:2,bar:4})

    // assertOverrides('set p foo=2,\\\nbar=4', 'p', {foo:2,bar:undefined})
    // assert(undefined, vars.bar)

    // assertOverrides('set p foo=2, \\ HELLO\nbar=4', 'p', {foo:2,bar:undefined})
    // assert(undefined, vars.bar)

    assertVars('set foo=( \\\n1, \\\n2, \\\n3)', {foo:[1,2,3]})
    assertVars('set foo=( \\\n1, \\\n//2, \\\n3)', {foo:[1,3]})

    assertVars("set foo='http://a.com/Bc.mp3'", {foo:'http://a.com/Bc.mp3'})
    assertVars("set foo='http://a.com/B \\\\c.mp3'", {foo:'http://a.com/B \\c.mp3'})
    assertVars("set foo='http://a.com/Bc.mp3'//FOO", {foo:'http://a.com/Bc.mp3'})
    assertOverrides("set p foo=//'http://a.com/Bc.mp3'", 'p', {foo:undefined})

    assertVars('set foo= \\\n 1', {foo:1})
    assertVars('set foo= \\ \n 1', {foo:1})
    assertVars('set foo= \\ //Cmnt \n 1', {foo:1})
    assertVars('set foo= //Cmnt \\\n 1', {foo:1})

    assertOverrides("set p //s='abc'", 'p', {})
    assertOverrides("set p s//='abc'", 'p', {s:1})
    assertOverrides("set p s=//'abc'", 'p', {})
    assertOverrides("set p a=1//,s='abc'", 'p', {a:1})
    assertOverrides("set p a=1//1,s='abc'", 'p', {a:1})
    assertOverrides("set p a=1,//s='abc'", 'p', {a:1})
    assertOverrides("set p a=1, //s='abc'", 'p', {a:1})
    assertOverrides("set p str='http://', amp=0.1, rate=10", 'p', {str:'http://', amp:0.1, rate:10})
    assertOverrides("set p window//, rate=2", 'p', {window:1})
    assertOverrides("set p add//+=2", 'p', {add:1})
    assertOverrides("set p add+//=2", 'p', {'add+':1})

    // assertOverrides('set p foo=2,bar=\'FOO \\\n\'', 'p', {foo:2,bar:'FOO'}) // !!! tricky; should not add a space into a string split over multiple lines...

    console.log('Update code tests complete')
  }

  return updateCode
})