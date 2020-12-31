'use strict'
define((require) => {
  let parseLine = require('parse-line')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')

  let parseCode = (code) =>{
    code.split('\n')
      .map((l,i) => {return{line:l.trim(), num:i}})
      .filter(({line}) => line != '')
      .map(({line,num}) => {
        try {
          parseLine(line, num)
        } catch (e) {
          let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
          consoleOut('Error on line '+(num+1)+': ' + e + st)
        }
      })
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
    assertOverrides('set p foo=2,bar=4', 'p', {foo:2,bar:4})
  
    console.log('Update code tests complete')
  }

  return updateCode
})