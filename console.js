'use strict';
define(function (require) {
  let cons = document.getElementById('console')
  let input = document.getElementById('console-input')
  cons.value = ''
  let lastStr
  let consoleOut = (str) => {
    console.log(str)
    if (str === lastStr) { return }
    lastStr = str
    cons.value += '\n'+str
    cons.scrollTop = cons.scrollHeight
  }
  consoleOut('\n Welcome to Limut\n')

  let makeHistory = (max, entries) => {
    entries = entries || []
    let pos = entries.length
    let draft = ''
    return {
      entries: () => entries,
      add: (line) => {
        pos = entries.length
        if (!line.trim() || line === entries[entries.length-1]) { return }
        entries.push(line)
        if (entries.length > max) { entries.splice(0, entries.length - max) }
        pos = entries.length
      },
      up: (current) => {
        if (pos === entries.length) { draft = current }
        if (pos > 0) { pos-- }
        return pos < entries.length ? entries[pos] : draft
      },
      down: () => {
        if (pos < entries.length) { pos++ }
        return pos < entries.length ? entries[pos] : draft
      },
    }
  }

  const storageKey = 'limut-console-history'
  let stored = []
  try { stored = JSON.parse(localStorage.getItem(storageKey)) || [] } catch (e) {}
  if (!Array.isArray(stored)) { stored = [] }
  let history = makeHistory(100, stored.filter(s => typeof s === 'string'))
  let saveHistory = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(history.entries())) } catch (e) {}
  }

  let setInput = (str) => {
    input.value = str
    input.setSelectionRange(str.length, str.length)
  }

  let commands = {}
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      let line = input.value.trim()
      input.value = ''
      history.add(line)
      if (!line) { return }
      saveHistory()
      consoleOut('> ' + line)
      let args = line.split(' ')
      let cmd = (args[0] || '').toLowerCase()
      if (commands[cmd]) {
        console.log('Console Command: ' + line)
        commands[cmd](args.slice(1), line)
      } else {
        consoleOut('Unknown command: ' + cmd)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setInput(history.up(input.value))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setInput(history.down())
    }
  })
  cons.addEventListener('mouseup', () => {
    if (!window.getSelection().toString()) { input.focus() }
  })
  consoleOut.addCommand = (name, func) => { commands[name] = func }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected), a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let h = makeHistory(3)
    assert('d', h.up('d'))
    assert('d', h.down())
    h.add('a'); h.add('b'); h.add(''); h.add('  '); h.add('b'); h.add('c')
    assert(['a','b','c'], h.entries())
    assert('c', h.up('draft'))
    assert('b', h.up('ignored'))
    assert('a', h.up('ignored'))
    assert('a', h.up('ignored'))
    assert('b', h.down())
    assert('c', h.down())
    assert('draft', h.down())
    assert('draft', h.down())
    h.up('x'); h.up('x')
    h.add('d')
    assert(['b','c','d'], h.entries())
    assert('d', h.up(''))
    assert('', h.down())
    h = makeHistory(3, ['p', 'q'])
    assert('q', h.up(''))
    console.log('Console tests complete')
  }

return consoleOut
})
