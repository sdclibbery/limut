'use strict'
define(function(require) {

  let sections = {
    instances: {},
  }

  sections.default = { name: 'default', length: 32 }
  sections.active = undefined
  sections.next = undefined
  sections.activeStartBeat = 0

  sections.update = (beatCount) => {
    if (!sections.active) {
      // First run — start the default section
      sections.active = sections.default
      sections.activeStartBeat = beatCount
      console.log(`Section '${sections.active.name}' starting (beat ${beatCount})`)
      return
    }
    if (beatCount >= sections.activeStartBeat + sections.active.length) {
      let ended = sections.active
      let next = sections.next || sections.default
      sections.next = undefined
      sections.active = next
      sections.activeStartBeat = beatCount
      console.log(`Section '${ended.name}' ended, section '${next.name}' starting (beat ${beatCount})`)
    }
  }

  sections.gc_reset = () => {
    for (let name in sections.instances) {
      sections.instances[name].marked = false
    }
  }
  sections.gc_mark = (name) => {
    sections.instances[name].marked = true
  }
  sections.gc_sweep = () => {
    for (let name in sections.instances) {
      if (!sections.instances[name].marked) {
        if (sections.instances[name].destroy) { sections.instances[name].destroy() }
        delete sections.instances[name]
      }
    }
  }

  sections.getByName = (name) => {
    if (!name) { return }
    return sections.instances[name.toLowerCase()]
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    sections.instances = { foo: {name:'foo'}, bar: {name:'bar'} }
    sections.gc_reset()
    sections.gc_mark('foo')
    sections.gc_sweep()
    assert(['foo'], Object.keys(sections.instances))
    sections.instances = {}

    let destroyed = false
    sections.instances = { foo: {name:'foo', destroy:()=>destroyed=true} }
    sections.gc_reset()
    sections.gc_sweep()
    assert(true, destroyed)
    assert([], Object.keys(sections.instances))
    sections.instances = {}

    sections.instances = { foo: {name:'foo', bar:2} }
    assert(2, sections.getByName('foo').bar)
    assert(2, sections.getByName('FOO').bar)
    assert(undefined, sections.getByName('fo'))
    assert(undefined, sections.getByName(''))
    assert(undefined, sections.getByName())
    sections.instances = {}

    // Advancement / active-next-default tracking
    sections.active = undefined
    sections.next = undefined
    sections.activeStartBeat = 0

    // Init: adopts the default section
    sections.update(0)
    assert(true, sections.active === sections.default)
    assert(0, sections.activeStartBeat)

    // Not yet ended (default length 32)
    sections.update(31)
    assert(true, sections.active === sections.default)
    assert(0, sections.activeStartBeat)

    // End -> fallback to default (no next set); logs even for same section
    let logged = false
    let realLog = console.log
    console.log = () => { logged = true }
    sections.update(32)
    console.log = realLog
    assert(true, logged)
    assert(true, sections.active === sections.default)
    assert(32, sections.activeStartBeat)

    // Switch to next, next consumed
    let b = { name: 'b', length: 8 }
    sections.next = b
    sections.update(64)
    assert('b', sections.active.name)
    assert(undefined, sections.next)
    assert(64, sections.activeStartBeat)

    // Next ends -> back to default
    sections.update(72)
    assert(true, sections.active === sections.default)
    assert(72, sections.activeStartBeat)

    // Restore so it doesn't leak into the running app
    sections.active = undefined
    sections.next = undefined
    sections.activeStartBeat = 0

    console.log('Sections tests complete')
  }

  return sections
})
