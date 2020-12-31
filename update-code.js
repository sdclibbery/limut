'use strict'
define((require) => {
  let parseLine = require('parse-line')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')

  let parseCode = (code) => {
    let lines = code.split('\n')
      .map(l => l.trim())
      .filter(l => l!='')
    for (let i = 0; i<lines.length; i++) {
      try {
        let line = lines[i]
        parseLine(line, i)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Error on line '+(i+1)+': ' + e + st)
      }
    }
  }

  let updateCode = (code) => {
    system.resume()
    players.instances = {}
    mainVars.reset()
    players.overrides = {}
    consoleOut('> Update code')
    parseCode(code)
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

    assertVars('//foo=1+1', {foo:undefined})

    assertVars('foo=1+1', {foo:2})
    assertVars(' \n//yo \nfoo=1+1 \n \n \n\n bar = 2 + 2 \n ', {foo:2,bar:4})

    assertOverrides('set p amp=2', 'p', {amp:2})
    assertOverrides('set p foo=2, bar=4', 'p', {foo:2,bar:4})

    //test for backslash with no preceding space
    // assertOverrides('set \\\np foo=2,bar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p  \\\nfoo=2,bar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo \\\n=2,bar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo= \\\n2,bar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo=2 \\\n,bar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo=2, \\\nbar=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo=2,bar \\\n=4', 'p', {foo:2,bar:4})
    // assertOverrides('set p foo=2,bar= \\\n4', 'p', {foo:2,bar:4})
  
    // assertOverrides(' set  \\\n p foo = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p  \\\n foo = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo  \\\n = 2 , bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo =  \\\n 2 , bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo = 2  \\\n , bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo = 2 ,  \\\n bar = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo = 2 , bar  \\\n = 4 ', 'p', {foo:2,bar:4})
    // assertOverrides(' set p foo = 2 , bar =  \\\n 4 ', 'p', {foo:2,bar:4})

    // more tests with actual player syntax, and mixtures of player/set/var syntaxes

    console.log('Update code tests complete')
  }

  return updateCode
})