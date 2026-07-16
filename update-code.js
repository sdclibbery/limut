'use strict'
define((require) => {
  let {parseLine,isLineStart} = require('parse-line')
  let parseString = require('expression/parse-string')
  let system = require('play/system')
  let players = require('player/players')
  let sections = require('section/sections')
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
      } else if (char === '\'' && !state.inLineComment && !state.inComment) { // String - skip over
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

  let sectionBlockStartRegex = /^\s*([_a-zA-Z]\w*)\s+section\s*\{\s*$/i
  let sectionBlockEndRegex = /^\s*\}/

  let parseCommand = async (lines, i, url) => {
    let line = lines[i]
    if (line === '') { return i }
    if (line.startsWith('//') === '') { return i }
    let blockMatch = line.match(sectionBlockStartRegex)
    if (blockMatch) {
      // Section block: accumulate raw lines up to the closing `}` line, preserving newlines so
      // parse-line can treat each body line as its own command
      let acc = [line]
      let closed = false
      while ((i+1)<lines.length) {
        i++
        acc.push(lines[i])
        if (sectionBlockEndRegex.test(lines[i])) { closed = true; break }
      }
      if (!closed) { // Report and consume the lines; throwing would leave the body lines to be parsed as normal commands
        consoleOut(`🔴 Parse error: Missing } to close section block '${blockMatch[1]}'`)
        return i
      }
      while ((i+1)<lines.length && !isLineStart(lines[i+1])) { // Params after the closing `}` may span lines like any command
        acc[acc.length-1] += lines[i+1]
        i++
      }
      line = acc.join('\n')
    } else {
      let acc = [line]
      while ((i+1)<lines.length && !isLineStart(lines[i+1])) {
        acc.push(lines[i+1])
        i++
      }
      line = acc.join('')
    }
    await parseLine(line, i, parseCode, undefined, url)
    return i
  }

  let parseCode = async (code, url) => {
    let lines
    lines = parseLinesAndComments(code)
    for (let i = 0; i<lines.length; i++) {
      try {
        i = await parseCommand(lines, i, url) // Will skip lines that were accumulated
      } catch (e) {
        consoleOut('🔴 Parse error: ' + e)
        console.log(e)
      }
    }
  }

  let latestCode
  let updateCode = async (code, options = {}) => {
    system.resume()
    if (!options.auto) { latestCode = code } // Remember for automatic reruns on section change
    players.gc_reset()
    sections.gc_reset()
    sections.resetDefault() // Baseline default each update; a `default section` line then redefines it
    mainVars.reset()
    players.overrides = {}
    sliders.gc_reset()
    vars.clear()
    predefinedVars.apply(vars.all())
    if (options.auto) {
      consoleOut(`> Section '${sections.active ? sections.active.name : '?'}': update code`)
    } else {
      consoleOut('> Update code')
    }
    sections.suppressForce = !!options.auto // set section.active/next lines must not refire on automatic reruns
    try {
      await parseCode(mainBus())
      await parseCode(code)
    } finally {
      sections.suppressForce = false
    }
    players.gc_sweep()
    sections.gc_sweep()
    sliders.gc_sweep()
    players.expandOverrides()
  }

  // Rerun the last code after the active section changed, so section-scoped lines
  // (section blocks) take effect for the newly active section
  let rerunForSectionChange = async () => {
    if (latestCode === undefined) { return }
    await updateCode(latestCode, {auto: true})
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
    assertVars("set foom= //Cm'nt\n 1", {foom:1})

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

    // Sections and section blocks. All async tests that touch the shared sections state
    // (active, instances, hasBlocks) must be sequenced in this one IIFE — separate async
    // test blocks interleave at the awaits and clobber each other's section state.
    ;(async () => {
      let savedActive = sections.active

      // Sections are swept on code update if no longer present
      await parseCode('sca section, a=1')
      assert(1, sections.instances.sca.a)
      sections.gc_reset()
      await parseCode('scb section')
      sections.gc_sweep()
      assert(undefined, sections.instances.sca)
      assert('scb', sections.instances.scb.name)
      delete sections.instances.scb

      // Inactive section: block params parse, body lines skipped, hasBlocks flagged
      sections.active = undefined
      sections.hasBlocks = false
      await parseCode('sba section {\nset sbax=1+1\n}, length=16, bar=3')
      assert(16, sections.instances.sba.length)
      assert(3, sections.instances.sba.bar)
      assert(true, sections.hasBlocks)
      assert(undefined, vars.sbax)

      // Active section: body lines parsed
      sections.active = sections.instances.sba
      await parseCode('sba section {\nset sbax=1+1\n}, length=16')
      assert(2, vars.sbax)
      delete vars.sbax

      // No params after the closing brace
      await parseCode('sba section {\nset sbaw=5\n}')
      assert(5, vars.sbaw)
      assert(32, sections.instances.sba.length)
      delete vars.sbaw

      // Comments and continuations inside the body; params after } may span lines
      await parseCode('sba section {\nset sbay=( //cmt\n1,\n2)\n}, length=8,\nfoo=3')
      assert([1,2], vars.sbay)
      assert(8, sections.instances.sba.length)
      assert(3, sections.instances.sba.foo)
      delete vars.sbay

      // Player overrides in the body
      await parseCode('sba section {\nset sbap amp=2\n}')
      assert(2, players.overrides.sbap && players.overrides.sbap.amp)
      delete players.overrides.sbap

      // Multiple body commands
      await parseCode('sba section {\nset sbad=1\nset sbae=2\n}')
      assert(1, vars.sbad)
      assert(2, vars.sbae)
      delete vars.sbad
      delete vars.sbae

      // next param after the closing brace stays a raw name
      await parseCode('sba section {\n}, next=sbb')
      assert('sbb', sections.instances.sba.nextName)

      // Nested section definitions are not allowed (parseLine throws; parseCode would swallow it)
      await assertThrows('inside a section block', () => parseLine('sba section {\nsbb section, length=8\n}'))

      // The built-in default section matches by name. (Restore default first: the gc tests above
      // call gc_sweep directly without resetDefault; real updateCode calls resetDefault so it survives.)
      sections.resetDefault()
      sections.active = sections.default
      await parseCode('default section {\nset sbdf=7\n}')
      assert(7, vars.sbdf)
      delete vars.sbdf

      // The default section can be redefined (length + body); resetDefault reverts to baseline
      sections.active = sections.instances.default
      await parseCode('default section {\nset dfx=1\n}, length=8')
      assert(8, sections.instances.default.length)
      assert(1, vars.dfx)
      delete vars.dfx
      sections.resetDefault() // What updateCode runs each update; removing the block reverts default
      assert(4, sections.instances.default.length)

      // Unterminated block is a parse error; nothing is defined and the body lines don't leak out as commands
      sections.active = undefined
      let errored = false
      let realLog = console.log
      let consEl = document.getElementById('console')
      let savedConsVal = consEl.value // Suppress the expected parse error output in the on-page console too
      console.log = () => { errored = true } // Suppress the expected parse error output
      await parseCode('sbz section {\nset sbzz=9')
      console.log = realLog
      consEl.value = savedConsVal
      assert(true, errored)
      assert(undefined, sections.instances.sbz)
      assert(undefined, vars.sbzz)
      delete sections.instances.sba

      // Section-scoped overrides swap when the code is re-parsed after a section change
      let code = 'sca2 section {\nset scaa amp=1\n}, next=scb2\nscb2 section {\nset scaa amp=2\n}'
      sections.active = undefined
      await parseCode(code)
      assert('scb2', sections.instances.sca2.nextName)
      assert(undefined, players.overrides.scaa) // Neither section active; no overrides applied
      sections.active = sections.instances.sca2
      await parseCode(code)
      assert(1, players.overrides.scaa && players.overrides.scaa.amp)
      sections.active = sections.instances.scb2
      delete players.overrides.scaa // Cleared by updateCode in real use
      await parseCode(code)
      assert(2, players.overrides.scaa && players.overrides.scaa.amp)
      delete players.overrides.scaa
      delete sections.instances.sca2
      delete sections.instances.scb2

      sections.active = savedActive
      sections.hasBlocks = false
    })().catch(e => console.trace('Assertion failed.\n>>Section block test error: ' + e))

    console.log('Update code tests complete')
  }

  return {
    parseCode:parseCode,
    updateCode:updateCode,
    rerunForSectionChange:rerunForSectionChange,
  }
})