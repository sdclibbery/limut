'use strict'
define(function(require) {

  let sections = {
    instances: {},
  }

  // Define the standard functions every section carries by default (active/timing/existence).
  // They close over the section object and the sections module state, and read section.length
  // dynamically so a later length override is honoured.
  sections.addStandardParams = (section) => {
    let active = () => sections.active === section
    let through = (b) => b - sections.activeStartBeat            // beats elapsed through this section
    let frac = (b) => Math.max(0, Math.min(1, through(b) / section.length))
    let mk = (fn) => { fn.interval = 'frame'; return fn }        // re-eval every frame, don't memoise
    section.active = mk((e,b) => active() ? 1 : 0)
    section.in     = section.active                              // alias
    section.exists = mk((e,b) => 1)
    section.time   = mk((e,b) => active() ? through(b) : 0)
    section.riser  = mk((e,b) => active() ? frac(b) : 0)
    section.rise   = section.riser                              // alias
    section.fall   = mk((e,b) => active() ? 1 - frac(b) : 1)
  }

  sections.default = { name: 'default', length: 32 }
  sections.addStandardParams(sections.default)
  sections.active = undefined
  sections.next = undefined
  sections.pendingActive = undefined
  sections.activeStartBeat = 0
  sections.hasBlocks = false // True if the latest parsed code contains any section { ... } block; gates auto reruns on section change
  sections.suppressForce = false // Set during automatic section-change reruns so set section.active/next lines in the code don't refire

  // Register (or replace) a named section. Rebinds any live pointers (active/next/pendingActive)
  // from the old object to the new one, so a code update that redefines the running section keeps
  // it active with its timing intact instead of leaving those pointers on the stale object.
  sections.define = (name, section) => {
    let old = sections.instances[name]
    sections.instances[name] = section
    if (old) {
      if (sections.active === old) { sections.active = section }
      if (sections.next === old) { sections.next = section }
      if (sections.pendingActive === old) { sections.pendingActive = section }
    }
    sections.gc_mark(name)
  }

  // Queue a named section to become active when the current one finishes
  sections.forceNext = (name) => {
    if (sections.suppressForce) { return }
    let s = sections.getByName(name)
    if (!s) { console.log(`Section '${name}' not found (set section.next)`); return }
    sections.next = s
  }
  // Force a named section to become active now (applied on the next update)
  sections.forceActive = (name) => {
    if (sections.suppressForce) { return }
    let s = sections.getByName(name)
    if (!s) { console.log(`Section '${name}' not found (set section.active)`); return }
    sections.pendingActive = s
  }

  // When a section becomes current, schedule its declared follow-on (its `next` param) as the next
  // section, so the piece sequences itself. Runs after sections.next has been consumed by an advance,
  // so a section that names its own successor (verse->chorus->verse...) keeps looping.
  sections.applyNext = (section) => {
    if (!section || !section.nextName) { return }
    let s = sections.getByName(section.nextName)
    if (s) { sections.next = s }
    else { console.log(`Section '${section.nextName}' not found (${section.name}.next)`) }
  }

  // Advance/switch the active section for this beat. Returns true if the active section
  // changed to a different section (so callers can react, eg rerun section-scoped code).
  sections.update = (beatCount) => {
    if (sections.pendingActive) {
      // A forced section switch takes precedence over normal advancement
      let previous = sections.active
      sections.active = sections.pendingActive
      sections.pendingActive = undefined
      sections.activeStartBeat = beatCount // Always restart from now
      sections.applyNext(sections.active)
      return sections.active !== previous
    }
    if (!sections.active) {
      // First run — start the default section
      sections.active = sections.default
      sections.activeStartBeat = beatCount
      sections.applyNext(sections.active)
      return true
    }
    if (beatCount >= sections.activeStartBeat + sections.active.length) {
      let ended = sections.active
      let next = sections.next || sections.default
      sections.next = undefined
      sections.active = next
      sections.activeStartBeat = beatCount
      sections.applyNext(sections.active)
      return sections.active !== ended
    }
    return false
  }

  sections.gc_reset = () => {
    sections.hasBlocks = false
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

    // Standard params: active/timing/existence
    let savedActive = sections.active, savedStart = sections.activeStartBeat
    let s = { name:'s', length:8 }
    sections.addStandardParams(s)

    // Inactive
    sections.active = undefined
    sections.activeStartBeat = 0
    assert(0, s.active({},4))
    assert(0, s.in({},4))
    assert(1, s.exists({},4))
    assert(0, s.time({},4))
    assert(0, s.riser({},4))
    assert(0, s.rise({},4))
    assert(1, s.fall({},4))

    // Active, started at beat 0
    sections.active = s
    sections.activeStartBeat = 0
    assert(1, s.active({},0))
    assert(1, s.in({},0))
    assert(0, s.time({},0))
    assert(0, s.riser({},0))
    assert(1, s.fall({},0))
    assert(4, s.time({},4))
    assert(0.5, s.riser({},4))
    assert(0.5, s.rise({},4))
    assert(0.5, s.fall({},4))
    assert(8, s.time({},8))
    assert(1, s.riser({},8))
    assert(0, s.fall({},8))
    assert(1, s.riser({},12)) // Clamped past the end
    assert(0, s.fall({},12))

    // length override is read live
    s.length = 4
    assert(1, s.riser({},4))
    assert(0.5, s.riser({},2))

    // interval flag set for per-frame re-evaluation
    assert('frame', s.riser.interval)
    assert('frame', s.time.interval)

    sections.active = savedActive
    sections.activeStartBeat = savedStart

    // define() rebinds live pointers when the running section is redefined (eg on code update)
    sections.instances = {}
    sections.active = sections.next = sections.pendingActive = undefined
    let d1 = { name:'drop', length:8 }
    sections.define('drop', d1)
    assert(true, sections.instances.drop === d1)
    assert(true, d1.marked)
    sections.active = d1; sections.next = d1; sections.pendingActive = d1
    let d2 = { name:'drop', length:16 }
    sections.define('drop', d2)
    assert(true, sections.instances.drop === d2)
    assert(true, sections.active === d2)        // active pointer follows the redefinition
    assert(true, sections.next === d2)
    assert(true, sections.pendingActive === d2)

    // reported bug: redefining the active section must keep its standard functions live
    sections.next = sections.pendingActive = undefined
    let e1 = { name:'e', length:8 }; sections.addStandardParams(e1); sections.define('e', e1)
    sections.active = e1; sections.activeStartBeat = 0
    assert(1, sections.instances.e.active({},2))
    let e2 = { name:'e', length:8 }; sections.addStandardParams(e2); sections.define('e', e2)
    assert(1, sections.instances.e.active({},2)) // still active (not 0) after the redefinition
    assert(2, sections.instances.e.time({},2))   // timing intact
    sections.instances = {}
    sections.active = sections.activeStartBeat = undefined

    // Advancement / active-next-default tracking
    sections.active = undefined
    sections.next = undefined
    sections.activeStartBeat = 0

    // Init: adopts the default section; reports a change
    assert(true, sections.update(0))
    assert(true, sections.active === sections.default)
    assert(0, sections.activeStartBeat)

    // Not yet ended (default length 32); no change
    assert(false, sections.update(31))
    assert(true, sections.active === sections.default)
    assert(0, sections.activeStartBeat)

    // End -> fallback to default (no next set); reports no change for same section
    let selfAdvanceChanged = sections.update(32)
    assert(false, selfAdvanceChanged) // default -> default is not a change
    assert(true, sections.active === sections.default)
    assert(32, sections.activeStartBeat)

    // Switch to next, next consumed; reports a change
    let b = { name: 'b', length: 8 }
    sections.next = b
    assert(true, sections.update(64))
    assert('b', sections.active.name)
    assert(undefined, sections.next)
    assert(64, sections.activeStartBeat)

    // Next ends -> back to default; reports a change
    assert(true, sections.update(72))
    assert(true, sections.active === sections.default)
    assert(72, sections.activeStartBeat)

    // forceNext queues a named section; unknown name leaves next unchanged
    sections.instances = { b: b }
    sections.next = undefined
    sections.forceNext('b')
    assert(true, sections.next === b)
    sections.forceNext('nope')
    assert(true, sections.next === b) // Unchanged, no throw

    // forceActive queues pendingActive; next update switches and restarts from now
    sections.pendingActive = undefined
    sections.forceActive('b')
    assert(true, sections.pendingActive === b)
    assert(true, sections.update(80))
    assert(true, sections.active === b)
    assert(80, sections.activeStartBeat)
    assert(undefined, sections.pendingActive)

    // Pending force wins over the boundary-advance path
    sections.forceActive('b') // Already active, but still restarts
    let forceSameChanged = sections.update(200) // Well past b's length (8), yet pending force applies, not advancement
    assert(true, sections.active === b)
    assert(200, sections.activeStartBeat) // Restarted from now, not advanced away
    assert(false, forceSameChanged) // Forcing the already-active section is not a change

    // suppressForce no-ops forceActive/forceNext (used during automatic section-change reruns)
    sections.next = undefined
    sections.pendingActive = undefined
    sections.suppressForce = true
    sections.forceNext('b')
    assert(undefined, sections.next)
    sections.forceActive('b')
    assert(undefined, sections.pendingActive)
    sections.suppressForce = false
    sections.forceNext('b')
    assert(true, sections.next === b)
    sections.next = undefined

    // gc_reset clears hasBlocks
    sections.hasBlocks = true
    sections.gc_reset()
    assert(false, sections.hasBlocks)

    sections.instances = {}

    // `next` param: when a section becomes current it queues its declared follow-on
    let verse = { name:'verse', length:8, nextName:'chorus' }
    let chorus = { name:'chorus', length:8, nextName:'verse' }
    sections.instances = { verse: verse, chorus: chorus }
    sections.active = undefined
    sections.next = undefined
    sections.pendingActive = undefined
    sections.activeStartBeat = 0

    // Force verse active -> it queues chorus as next
    sections.forceActive('verse')
    sections.update(0)
    assert(true, sections.active === verse)
    assert(true, sections.next === chorus)   // verse.next queued

    // verse ends -> chorus becomes active and queues verse (the loop continues)
    sections.update(8)
    assert(true, sections.active === chorus)
    assert(true, sections.next === verse)    // chorus.next queued, not left as the just-consumed value

    // chorus ends -> back to verse, which re-queues chorus
    sections.update(16)
    assert(true, sections.active === verse)
    assert(true, sections.next === chorus)

    // A section with no next param leaves next unset -> falls back to default
    let solo = { name:'solo', length:8 }
    sections.instances = { solo: solo }
    sections.next = undefined
    sections.pendingActive = solo
    sections.update(24)
    assert(true, sections.active === solo)
    assert(undefined, sections.next)         // no next declared
    sections.update(32)
    assert(true, sections.active === sections.default)

    // Unknown next name is reported and leaves next unset (no throw)
    let dangling = { name:'dangling', length:8, nextName:'ghost' }
    sections.instances = { dangling: dangling }
    sections.next = undefined
    sections.pendingActive = dangling
    let realLog3 = console.log
    console.log = () => {}
    sections.update(40)
    console.log = realLog3
    assert(true, sections.active === dangling)
    assert(undefined, sections.next)

    sections.instances = {}

    // Restore so it doesn't leak into the running app
    sections.active = undefined
    sections.next = undefined
    sections.pendingActive = undefined
    sections.activeStartBeat = 0

    console.log('Sections tests complete')
  }

  return sections
})
