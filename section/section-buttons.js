'use strict'
define(function(require) {
  let sections = require('section/sections')

  // The row of buttons in the top bar, one per defined section: click to queue a section as next,
  // shift-click to switch to it now. This is the one-shot way to trigger a section during a
  // performance; `set section.next=X` in the code refires on every code update, so it has to be
  // commented out again straight after use.

  // What the row should show: every defined section, which one is playing, and which is queued.
  // Kept apart from the DOM so it can be diffed (to avoid rebuilding buttons every frame) and tested.
  let buttonState = () => {
    return Object.keys(sections.instances).map(name => {
      let section = sections.instances[name]
      return {
        name: name,
        active: section === sections.active,
        // pendingActive counts as queued too, so a shift-click reads back immediately rather than
        // waiting for the next beat to apply it
        queued: section === sections.next || section === sections.pendingActive,
      }
    })
  }

  let container
  let buttons = {} // name -> element, for the currently rendered set
  let renderedNames
  let renderedKey

  let makeButton = (name) => {
    let button = document.createElement('button')
    button.innerText = name
    button.title = `Click to queue '${name}' as the next section; shift-click to switch to it now`
    button.addEventListener('mousedown', (event) => {
      event.preventDefault() // Keep focus (and the caret) in the editor
      if (event.shiftKey) {
        sections.forceActive(name, true)
      } else if (sections.next === sections.instances[name]) {
        sections.clearNext() // Clicking the queued section again unqueues it
      } else {
        sections.forceNext(name, true)
      }
      update() // Reflect the click straight away rather than waiting for the next frame
    })
    return button
  }

  // Called every frame; only touches the DOM when something actually changed
  let update = () => {
    if (!container) { container = document.getElementById('section-buttons') }
    if (!container) { return } // Not the full page (eg a test harness); nothing to render into
    let state = buttonState()
    let names = state.map(s => s.name).join(',')
    if (names !== renderedNames) {
      container.innerHTML = ''
      buttons = {}
      for (let s of state) {
        buttons[s.name] = makeButton(s.name)
        container.appendChild(buttons[s.name])
      }
      renderedNames = names
      renderedKey = undefined
      // Nothing worth showing until there is a section other than the built in default
      container.classList.toggle('closed', state.length <= 1)
    }
    let key = state.map(s => `${s.active?'*':''}${s.queued?'>':''}`).join(',')
    if (key === renderedKey) { return }
    for (let s of state) {
      buttons[s.name].classList.toggle('active', s.active)
      buttons[s.name].classList.toggle('queued', s.queued)
    }
    renderedKey = key
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    let savedInstances = sections.instances
    let savedActive = sections.active, savedNext = sections.next, savedPending = sections.pendingActive

    let a = {name:'a'}, b = {name:'b'}, c = {name:'c'}
    sections.instances = { a: a, b: b, c: c }
    sections.active = undefined
    sections.next = undefined
    sections.pendingActive = undefined

    // Every defined section gets a button, in definition order
    assert([
      {name:'a', active:false, queued:false},
      {name:'b', active:false, queued:false},
      {name:'c', active:false, queued:false},
    ], buttonState())

    // The playing section is active, the queued one is queued
    sections.active = a
    sections.next = c
    assert([
      {name:'a', active:true, queued:false},
      {name:'b', active:false, queued:false},
      {name:'c', active:false, queued:true},
    ], buttonState())

    // A forced (pending) section reads as queued straight away, before the next beat applies it
    sections.next = undefined
    sections.pendingActive = b
    assert([
      {name:'a', active:true, queued:false},
      {name:'b', active:false, queued:true},
      {name:'c', active:false, queued:false},
    ], buttonState())

    sections.instances = savedInstances
    sections.active = savedActive
    sections.next = savedNext
    sections.pendingActive = savedPending

    console.log('Section buttons tests complete')
  }

  return {
    update: update,
    buttonState: buttonState,
  }
})
