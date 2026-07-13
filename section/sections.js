'use strict'
define(function(require) {

  let sections = {
    instances: {},
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

    console.log('Sections tests complete')
  }

  return sections
})
