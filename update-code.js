'use strict'
define((require) => {
  let {parseLine,isLineStart} = require('parse-line')
  let parseString = require('expression/parse-string')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')
  let sliders = require('functions/sliders')
  let predefinedVars = require('predefined-vars')
  let vars = require('vars')
  let mainBus = require('play/main-bus')

  let parseLinesAndComments = (code) => {
    let state = {
      str: code,
      idx: 0,
      lastLineStart: 0,
      inComment: false,
      commentStart: -1,
      inLineComment: false,
      lineCommentStart: -1,
    }
    let lines = []
    let char
    while (true) {
      char = state.str.charAt(state.idx)
      if (char === '\n' || char === '') {
        let lineStart = state.lastLineStart
        let lineEnd = state.idx
        if (state.inLineComment) { // // comment end
          lineEnd = state.lineCommentStart
          state.inLineComment = false
          state.lineCommentStart = -1
        }
        if (state.inComment) {
          if (state.commentStart !== -1) { // /* comment started on this line
            lineEnd = state.commentStart
            state.commentStart = -1
          } else {
            lineStart = state.idx // Entire line is in comment
          }
        }
        let line = state.str.slice(lineStart, lineEnd).trim()+' '
        lines.push(line)
        state.idx += 1
        state.lastLineStart = state.idx
        if (char === '') { break }
      } else if (char === '\'') { // String - skip over
        state.idx += 1
        parseString(state)
      } else if (char === '/' && state.str.charAt(state.idx+1) === '/' && !state.inLineComment && !state.inComment) { // // Comment start
        state.lineCommentStart = state.idx
        state.inLineComment = true
        state.idx += 2
      } else if (char === '/' && state.str.charAt(state.idx+1) === '*' && !state.inLineComment && !state.inComment) { // /* Comment start
        state.commentStart = state.idx
        state.inComment = true
        state.idx += 2
      } else if (state.inComment && char === '*' && state.str.charAt(state.idx+1) === '/') { // /* Comment end
        state.idx += 2
        state.inComment = false
        if (state.commentStart !== -1) { // Comment started on this line
          state.str = state.str.slice(0, state.commentStart) + state.str.slice(state.idx) // Trim out commented section
          state.idx -= state.idx - state.commentStart
        } else {
          state.str = state.str.slice(0, state.lastLineStart) + state.str.slice(state.idx) // Trim out commented section on this line
          state.idx -= state.idx - state.lastLineStart
        }
        state.commentStart = -1
      } else {
        state.idx += 1
      }
    }
    return lines
  }

  let parseCommand = async (lines, i) => {
    let line = lines[i]
    if (line === '') { return i }
    if (line.startsWith('//') === '') { return i }
    while ((i+1)<lines.length && !isLineStart(lines[i+1])) {
      line = line + lines[i+1] // Accumulate all lines that aren't a new line start together into one new line
      i++
    }
    await parseLine(line, i, parseCode)
    return i
  }

  let parseCode = async (code) => {
    let lines
    lines = parseLinesAndComments(code)
    for (let i = 0; i<lines.length; i++) {
      try {
        i = await parseCommand(lines, i) // Will skip lines that were accumulated
      } catch (e) {
        reportError(e, i)
      }
    }
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
    await parseCode(mainBus())
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
    let assertThrows = async (expected, code) => {
      let got
      try {await code()}
      catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
      finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
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

    assertOverrides("set pca s=1, t=2", 'pca', {s:1,t:2})
    assertOverrides("set pcb /*s=1,*/ t=2", 'pcb', {t:2})
    assertOverrides("set pcc /* s=1 */, t=2", 'pcc', {t:2})
    assertOverrides("set pcd/* s=1*/, t=2", 'pcd', {t:2})
    assertOverrides("set pce s/*='abc'*/, ", 'pce', {s:1})
    assertOverrides("set pcf s='abc/*def*/'", 'pcf', {s:'abc/*def*/'})
    assertOverrides("set pcg s='abc/*def'", 'pcg', {s:'abc/*def'})
    assertOverrides("set pch s='abc*/def'", 'pch', {s:'abc*/def'})
    assertOverrides("set pci s=1//, /*t=2*/", 'pci', {s:1})
    assertOverrides("set pcj s=1, ///*t=2*/", 'pcj', {s:1})
    assertOverrides("set pck s=1, //*t=2*/", 'pck', {s:1})
    assertOverrides("set pcl s=1, /*t//=2*/", 'pcl', {s:1})
    assertOverrides("set pcm add=1/*+2*/+3\n//+5", 'pcm', {add:4})

    assertOverrides("set pmca \n s=1, \n t=2", 'pmca', {s:1,t:2})
    assertOverrides("set pmcb /* \n s=1, \n */ t=2", 'pmcb', {t:2})

    console.log('Update code tests complete')
  }

  return {
    parseCode:parseCode,
    updateCode:updateCode,
  }
})