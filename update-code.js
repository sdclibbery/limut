'use strict'
define((require) => {
  let {parseLine,isLineStart} = require('parse-line')
  let parseString = require('player/parse-string')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')
  let sliders = require('sliders')
  let predefinedVars = require('predefined-vars')
  let vars = require('vars')

  let parseCode = async (code) => {
    let lines = code.split('\n')
    for (let i = 0; i<lines.length; i++) {
      try {
        let line = lines[i]
        if (line === '') { continue }
        line = preParseLine(line)
        while ((i+1)<lines.length && !isLineStart(lines[i+1])) {
          let nextLine = preParseLine(lines[i+1])
          line = line + nextLine
          i++
        }
        await parseLine(line, i, parseCode)
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
        return result
      } else {
        state.idx += 1
      }
    }
    return line.trimStart()
  }

  let updateCode = async (code) => {
    system.resume()
    players.gc_reset()
    mainVars.reset()
    players.overrides = {}
    sliders.gc_reset()
    vars.clear()
    predefinedVars.apply(vars.all())
    consoleOut('> Update code')
    await parseCode(code)
    players.gc_sweep()
    sliders.gc_sweep()
    players.expandOverrides()
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let vars = require('vars').all()

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let assertVars = async (code, expected) => {
      await parseCode(code)
      Object.keys(expected).forEach(k => {
        assert(expected[k], vars[k])
        delete vars[k]
      })
    }
    let assertOverrides = async (code, playerId, expected) => {
      await parseCode(code)
      Object.keys(expected).forEach(k => {
        assert(expected[k], players.overrides[playerId][k])
      })
      delete players.overrides[playerId]
    }
  
    assertVars('', {})
    assertVars(' \n \t\n ', {})

    assertVars('//set fooa=1+1', {fooa:undefined})

    assertVars('set foob=1+1', {foob:2})
    assertVars(' \n//yo \nset fooc=1+1 \n \n \n\n set barc = 2 + 2 \n ', {fooc:2,barc:4})

    assertOverrides('set pa amp=2', 'pa', {amp:2})
    assertOverrides('set pb foo=2, bar=4', 'pb', {foo:2,bar:4})

    assertOverrides('set pc foo=2,\n,bar=4', 'pc', {foo:2,bar:4})
    assertOverrides('set pd foo=2 , \n , bar=4', 'pd', {foo:2,bar:4})

    assertOverrides('set pe \nfoo=2,bar=4', 'pe', {foo:2,bar:4})
    assertOverrides('set pf foo\n=2,bar=4', 'pf', {foo:2,bar:4})
    assertOverrides('set pg foo=\n2,bar=4', 'pg', {foo:2,bar:4})
    assertOverrides('set ph foo=2\n,bar=4', 'ph', {foo:2,bar:4})
    assertOverrides('set pi foo=2,\nbar=4', 'pi', {foo:2,bar:4})
    assertOverrides('set pj foo=2,bar\n=4', 'pj', {foo:2,bar:4})
    assertOverrides('set pk foo=2,bar=\n4', 'pk', {foo:2,bar:4})

    assertOverrides(' set pl \n foo = 2 , bar = 4 ', 'pl', {foo:2,bar:4})
    assertOverrides(' set pm foo \n = 2 , bar = 4 ', 'pm', {foo:2,bar:4})
    assertOverrides(' set pn foo = \n 2 , bar = 4 ', 'pn', {foo:2,bar:4})
    assertOverrides(' set po foo = 2 \n , bar = 4 ', 'po', {foo:2,bar:4})
    assertOverrides(' set pp foo = 2 , \n bar = 4 ', 'pp', {foo:2,bar:4})
    assertOverrides(' set pq foo = 2 , bar \n = 4 ', 'pq', {foo:2,bar:4})
    assertOverrides(' set pr foo = 2 , bar = \n 4 ', 'pr', {foo:2,bar:4})

    assertOverrides('set ps foo=2,\\\nbar=4', 'ps', {foo:2,bar:undefined})
    assert(undefined, vars.bar)

    assertOverrides('set pt foo=2, HELLO\nbar=4', 'pt', {foo:2,bar:undefined})
    assert(undefined, vars.bar)

    assertVars('set food=(\n1,\n2,\n3)', {food:[1,2,3]})
    assertVars('set fooe=(\n1,\n//2,\n3)', {fooe:[1,3]})

    assertVars("set foof='http://a.com/Bc.mp3'", {foof:'http://a.com/Bc.mp3'})
    assertVars("set foog='http://a.com/B\\c.mp3'", {foog:'http://a.com/Bc.mp3'})
    assertVars("set fooh='http://a.com/Bc.mp3'//FOO", {fooh:'http://a.com/Bc.mp3'})
    assertOverrides("set pu foo=//'http://a.com/Bc.mp3'", 'pu', {foo:undefined})

    assertVars('set fooi=\n 1', {fooi:1})
    assertVars('set fooj= \n 1', {fooj:1})
    assertVars('set fook= //Cmnt \n 1', {fook:1})
    assertVars('set fool= //Cmnt\n 1', {fool:1})

    assertOverrides("set pv //s='abc'", 'pv', {})
    assertOverrides("set pw s//='abc'", 'pw', {s:1})
    assertOverrides("set px s=//'abc'", 'px', {})
    assertOverrides("set py a=1//,s='abc'", 'py', {a:1})
    assertOverrides("set pz a=1//1,s='abc'", 'pz', {a:1})
    assertOverrides("set paa a=1,//s='abc'", 'paa', {a:1})
    assertOverrides("set pab a=1, //s='abc'", 'pab', {a:1})
    assertOverrides("set pac str='http://', amp=0.1, rate=10", 'pac', {str:'http://', amp:0.1, rate:10})
    assertOverrides("set pad window//, rate=2", 'pad', {window:1})
    assertOverrides("set pae add//+=2", 'pae', {add:1})
    assertOverrides("set paf add+//=2", 'paf', {'add+':1})

    assertOverrides('set pag foo=2,bar=\'FOO\n\'', 'pag', {foo:2,bar:'FOO'})

    console.log('Update code tests complete')
  }

  return {
    parseCode:parseCode,
    updateCode:updateCode,
  }
})