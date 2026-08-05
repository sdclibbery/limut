'use strict'
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')
  let {mainParam} = require('player/sub-param')
  let {applyOverride,combineOverrides,newOverride} = require('player/override-params')

  let sections = {
    instances: {},
    overrides: {},              // section name -> params overridden by `set <name> param=value` lines
    activeOverrides: undefined, // params overridden by `set section param=value` / `set sx ...` (whichever section is active)
  }

  // The active-section keyword and its short alias `sx`, recognised in expressions
  // (section.rise / sx.rise) and in `set` (set section.next=X). Defined here so the
  // alias lives in one place.
  sections.isKeyword = (name) => name === 'section' || name === 'sx'

  // Fold this section's `set` overrides onto a base value: first those set by the section's name
  // (set drop length=4), then any set on the active-section keyword (set section length=4) when this
  // is the active section — so the keyword wins for a plain assignment and composes for a compound
  // one. applyOverride reads the base from a holder object, hence the throwaway wrapper.
  let foldOverride = (section, key, value) => {
    let holder = {}
    holder[key] = value
    let byName = sections.overrides[section.name]
    if (byName && byName[key] !== undefined) { holder[key] = applyOverride(holder, key, byName[key]) }
    if (section === sections.active && sections.activeOverrides && sections.activeOverrides[key] !== undefined) {
      holder[key] = applyOverride(holder, key, sections.activeOverrides[key])
    }
    return holder[key]
  }
  let hasOverride = (section, key) => {
    let byName = sections.overrides[section.name]
    if (byName && byName[key] !== undefined) { return true }
    return section === sections.active && !!sections.activeOverrides && sections.activeOverrides[key] !== undefined
  }

  // Read a section param with any `set` override applied. Returns the value unevaluated (params are
  // usually expressions), just like reading section[key] direct, so callers evaluate it in their
  // own context. hasParam reports a param that exists only as an override.
  sections.getParam = (section, key) => section ? foldOverride(section, key, section[key]) : undefined
  sections.hasParam = (section, key) => !!section && (section[key] !== undefined || hasOverride(section, key))

  // Evaluate an overridable numeric param (length/repeat) to a number for this beat. Overrides are
  // read live rather than resolved once at activation the way a length spec is, so editing a `set`
  // line takes effect immediately. Same validity checks as resolveActiveParams.
  let numericParam = (section, key, beatCount) => {
    let base = section[key]
    if (!hasOverride(section, key)) { return base }
    let event = { count: beatCount, idx: 0, _time: beatCount }
    let v = mainParam(evalParamFrame(foldOverride(section, key, base), event, beatCount))
    if (typeof v !== 'number' || !isFinite(v)) { return base }
    if (key === 'length' && v <= 0) { return base } // A zero or negative length would never end
    return v
  }
  sections.getLength = (section, beatCount) => numericParam(section, 'length', beatCount)
  sections.getRepeat = (section, beatCount) => numericParam(section, 'repeat', beatCount)

  // Route the `set <name> param=value` overrides that name a section onto that section, returning
  // those that stay with players. A player of the same name always wins, and the section/sx keyword
  // wins over a same-named player — both matching the lookup precedence in lookupOp. playerExists is
  // injected so this module keeps no dependency on the player registry.
  sections.extractOverrides = (playerOverrides, playerExists) => {
    let remaining = {}
    for (let id in playerOverrides) {
      if (sections.isKeyword(id)) {
        sections.activeOverrides = combineOverrides(sections.activeOverrides || {}, playerOverrides[id])
      } else if (!playerExists(id) && sections.getByName(id)) {
        let name = id.toLowerCase()
        sections.overrides[name] = combineOverrides(sections.overrides[name] || {}, playerOverrides[id])
      } else {
        remaining[id] = playerOverrides[id]
      }
    }
    return remaining
  }

  // Define the standard functions every section carries by default (active/timing/existence).
  // They close over the section object and the sections module state, and read section.length
  // dynamically so a later length override is honoured.
  sections.addStandardParams = (section) => {
    let active = () => sections.active === section
    let through = (b) => Math.max(0, b - sections.activeStartBeat) // beats elapsed (>=0; clamps the sub-beat negative transient at a section boundary)
    let length = (b) => sections.getLength(section, b)           // the live length, including any `set` override
    let frac = (b) => Math.max(0, Math.min(1, through(b) / length(b)))
    let mk = (fn) => { fn.interval = 'frame'; return fn }        // re-eval every frame, don't memoise
    section.active = mk((e,b) => active() ? 1 : 0)
    section.in     = section.active                              // alias
    section.exists = mk((e,b) => 1)
    section.time   = mk((e,b) => active() ? through(b) : 0)
    section.rtime  = mk((e,b) => active() ? length(b) - through(b) : length(b)) // inverse of .time: counts down from length to 0
    section.riser  = mk((e,b) => active() ? frac(b) : 0)
    section.rise   = section.riser                              // alias
    section.fall   = mk((e,b) => active() ? 1 - frac(b) : 1)
    section.count  = mk((e,b) => active() ? sections.activeCount : 0) // which repeat we're on (0-based)
  }

  // The default section is an ordinary registry entry named 'default' (not a phantom object)
  // so it can be referenced by name (set section.next=default, default.riser) and redefined
  // like any other section. sections.default is a getter onto the live registry object so all
  // existing reads keep resolving to it even after a redefinition swaps the instance.
  sections.makeDefault = () => {
    let d = { name: 'default', length: 8 }
    sections.addStandardParams(d)
    return d
  }
  sections.instances['default'] = sections.makeDefault()
  Object.defineProperty(sections, 'default', { get: () => sections.instances['default'] })
  // Refresh the default to a clean baseline; called per code update so a `default section`
  // redefinition applies and a removed one reverts. define() rebinds live pointers and marks it,
  // and leaves activeStartBeat untouched so timing stays continuous across the refresh.
  sections.resetDefault = () => { sections.define('default', sections.makeDefault()) }
  sections.active = undefined
  sections.next = undefined
  sections.pendingActive = undefined
  sections.activeStartBeat = 0
  sections.activeCount = 0 // Number of times the active section has finished (reaches .length); resets to 0 when a section becomes active
  sections.hasBlocks = false // True if the latest parsed code contains any section { ... } block; gates auto reruns on section change
  sections.suppressForce = false // Set during automatic section-change reruns so set section.active/next lines in the code don't refire

  // Register (or replace) a named section. Rebinds any live pointers (active/next/pendingActive)
  // from the old object to the new one, so a code update that redefines the running section keeps
  // it active with its timing intact instead of leaving those pointers on the stale object.
  sections.define = (name, section) => {
    let old = sections.instances[name]
    sections.instances[name] = section
    if (old) {
      if (sections.active === old) {
        sections.active = section
        // Redefining the *running* section (eg the section-change auto-rerun swaps the object)
        // must not lose a length/repeat that was resolved from a random/time-var spec when the
        // section became active. Carry the resolved value over so it holds for the whole run
        // instead of reverting to the default and re-rolling. Constant params carry no spec, so a
        // genuine length/repeat edit still takes effect immediately.
        if (section.lengthSpec !== undefined) { section.length = old.length }
        if (section.repeatSpec !== undefined && old.repeat !== undefined) { section.repeat = old.repeat }
      }
      if (sections.next === old) { sections.next = section }
      if (sections.pendingActive === old) { sections.pendingActive = section }
    }
    sections.gc_mark(name)
  }

  // Queue a named section to become active when the current one finishes.
  // fromUi bypasses suppressForce: a click is a deliberate one-off trigger, and the automatic
  // section-change rerun is async so suppressForce may happen to be set when the click lands.
  sections.forceNext = (name, fromUi) => {
    if (sections.suppressForce && !fromUi) { return }
    let s = sections.getByName(name)
    if (!s) { console.log(`Section '${name}' not found (set section.next)`); return }
    sections.next = s
  }
  // Force a named section to become active now (applied on the next update)
  sections.forceActive = (name, fromUi) => {
    if (sections.suppressForce && !fromUi) { return }
    let s = sections.getByName(name)
    if (!s) { console.log(`Section '${name}' not found (set section.active)`); return }
    sections.pendingActive = s
  }
  // Unqueue whatever was queued as next, so the piece falls back to the default section instead
  sections.clearNext = () => {
    sections.next = undefined
  }

  // Evaluate the length/repeat specs (non-constant expressions like length=[4,8]r) into concrete
  // numbers, held for this run. Called when a section becomes active so a random/time-var value
  // is picked once at activation and stays fixed for the whole run (including its repeats).
  // Constant params carry no spec, so this is a no-op for them.
  sections.resolveActiveParams = (section, beatCount) => {
    if (!section) { return }
    let event = { count: beatCount, idx: 0, _time: beatCount }
    if (section.lengthSpec !== undefined) {
      let v = mainParam(evalParamFrame(section.lengthSpec, event, beatCount))
      if (typeof v === 'number' && isFinite(v) && v > 0) { section.length = v }
    }
    if (section.repeatSpec !== undefined) {
      let v = mainParam(evalParamFrame(section.repeatSpec, event, beatCount))
      if (typeof v === 'number' && isFinite(v)) { section.repeat = v }
    }
  }

  // When a section becomes current, schedule its declared follow-on (its `next` param) as the next
  // section, so the piece sequences itself. Runs after sections.next has been consumed by an advance,
  // so a section that names its own successor (verse->chorus->verse...) keeps looping. A `next`
  // expression (nextSpec, eg next=(chorus,verse)r) is evaluated to a section name at activation.
  sections.applyNext = (section, beatCount) => {
    if (!section) { return }
    let name = section.nextName
    // A `set drop next=chorus` override supersedes the declared next. It has been through the normal
    // param parser, so it is an expression like next=(a,b)r rather than the bare-name literal the
    // section line special cases — a bare name evaluates to its own text, so the spec path handles it.
    let spec = hasOverride(section, 'next') ? foldOverride(section, 'next', section.nextSpec) : section.nextSpec
    if (spec !== undefined) {
      let event = { count: beatCount, idx: 0, _time: beatCount }
      let v = evalParamFrame(spec, event, beatCount)
      if (Array.isArray(v)) { v = v[0] } // A plain chord: take the first; use `r` to pick randomly
      v = mainParam(v)
      if (typeof v === 'string') { name = v.toLowerCase() }
    }
    if (!name) { return }
    let s = sections.getByName(name)
    if (s) { sections.next = s }
    else { console.log(`Section '${name}' not found (${section.name}.next)`) }
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
      sections.activeCount = 0             // Reset the repeat counter on becoming active
      sections.resolveActiveParams(sections.active, beatCount)
      sections.applyNext(sections.active, beatCount)
      return sections.active !== previous
    }
    if (!sections.active) {
      // First run — start the default section
      sections.active = sections.default
      sections.activeStartBeat = beatCount
      sections.activeCount = 0
      sections.resolveActiveParams(sections.active, beatCount)
      sections.applyNext(sections.active, beatCount)
      return true
    }
    if (beatCount >= sections.activeStartBeat + sections.getLength(sections.active, beatCount)) {
      sections.activeCount += 1 // This section just finished one play
      let repeat = sections.getRepeat(sections.active, beatCount)
      if (repeat !== undefined && sections.activeCount < repeat) {
        // Repeat the same section: replay from the top (so time/riser/fall reset) but keep the
        // queued next and don't report a change, so section-scoped block code is not re-run.
        sections.activeStartBeat = beatCount
        return false
      }
      let ended = sections.active
      let next = sections.next || sections.default
      sections.next = undefined
      sections.active = next
      sections.activeStartBeat = beatCount
      sections.activeCount = 0 // New section becomes active
      sections.resolveActiveParams(sections.active, beatCount)
      sections.applyNext(sections.active, beatCount)
      return sections.active !== ended
    }
    return false
  }

  sections.gc_reset = () => {
    sections.hasBlocks = false
    sections.overrides = {}          // `set` overrides are rebuilt from the code on every update,
    sections.activeOverrides = undefined // so a deleted `set` line stops applying (as for players)
    for (let name in sections.instances) {
      sections.instances[name].marked = false
    }
  }
  sections.gc_mark = (name) => {
    sections.instances[name].marked = true
  }
  sections.gc_sweep = () => {
    for (let name in sections.instances) {
      if (name === 'default') { continue } // The default section can never be swept
      let section = sections.instances[name]
      if (!section.marked) {
        // Fix up any live pointers that referenced the section being removed, so we never
        // leave active/next/pendingActive dangling on an orphaned object. Active falls back
        // to default (via re-init on the next update), next falls back to default too.
        if (sections.active === section) { sections.active = undefined }
        if (sections.next === section) { sections.next = undefined }
        if (sections.pendingActive === section) { sections.pendingActive = undefined }
        if (section.destroy) { section.destroy() }
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

    // isKeyword: the active-section keyword and its short alias
    assert(true, sections.isKeyword('section'))
    assert(true, sections.isKeyword('sx'))
    assert(false, sections.isKeyword('sxx'))
    assert(false, sections.isKeyword('foo'))

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

    // Sweeping a section clears any live pointers that referenced it (falls back to default)
    let gcSavedActive = sections.active, gcSavedNext = sections.next
    let gcSavedPending = sections.pendingActive, gcSavedStart = sections.activeStartBeat
    let gone = { name:'gone', length:8 }
    let keep = { name:'keep', length:8 }
    sections.instances = { gone: gone, keep: keep }
    sections.active = gone
    sections.next = gone
    sections.pendingActive = gone
    sections.gc_reset()
    sections.gc_mark('keep')
    sections.gc_sweep()
    assert(undefined, sections.instances.gone)
    assert(undefined, sections.active)          // active fell back (re-inits to default on next update)
    assert(undefined, sections.next)            // next fell back to default
    assert(undefined, sections.pendingActive)   // dangling pendingActive cleared

    // A marked section keeps its pointers intact (no false clearing)
    sections.instances = { keep: keep }
    sections.active = keep
    sections.next = keep
    sections.pendingActive = keep
    sections.gc_reset()
    sections.gc_mark('keep')
    sections.gc_sweep()
    assert(true, sections.active === keep)
    assert(true, sections.next === keep)
    assert(true, sections.pendingActive === keep)

    // After active is swept, the next update re-adopts default with a fresh start beat
    sections.instances = { default: sections.makeDefault(), gone2: {name:'gone2', length:8} }
    sections.active = sections.instances.gone2
    sections.next = undefined
    sections.pendingActive = undefined
    sections.gc_reset()
    sections.gc_mark('default')
    sections.gc_sweep()
    assert(undefined, sections.active)
    let readopted = sections.update(20)
    assert(true, readopted)                     // reports a change so section-scoped code reruns
    assert(true, sections.active === sections.default)
    assert(20, sections.activeStartBeat)        // fresh start from the current beat

    // The default section is never swept, even when left unmarked
    sections.instances = { default: sections.makeDefault() }
    sections.gc_reset()
    sections.gc_sweep()
    assert(true, !!sections.instances.default)

    sections.active = gcSavedActive
    sections.next = gcSavedNext
    sections.pendingActive = gcSavedPending
    sections.activeStartBeat = gcSavedStart
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
    assert(8, s.rtime({},4)) // inactive: full length remaining
    assert(0, s.riser({},4))
    assert(0, s.rise({},4))
    assert(1, s.fall({},4))

    // Active, started at beat 0
    sections.active = s
    sections.activeStartBeat = 0
    assert(1, s.active({},0))
    assert(1, s.in({},0))
    assert(0, s.time({},0))
    assert(8, s.rtime({},0)) // full length remaining at start
    assert(0, s.riser({},0))
    assert(1, s.fall({},0))
    assert(4, s.time({},4))
    assert(4, s.rtime({},4)) // half elapsed, half remaining
    assert(0.5, s.riser({},4))
    assert(0.5, s.rise({},4))
    assert(0.5, s.fall({},4))
    assert(8, s.time({},8))
    assert(0, s.rtime({},8)) // fully elapsed, zero remaining
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

    // A sub-beat negative time (fractional draw clock lags activeStartBeat at a boundary) clamps:
    // time stays >=0 and rtime stays <=length rather than overshooting.
    sections.activeStartBeat = 4
    assert(0, s.time({},3.9))          // not negative
    assert(s.length, s.rtime({},3.9))  // not over length
    assert(0, s.riser({},3.9))

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
    assert(16, sections.active.length)          // a constant length edit takes effect immediately

    // Redefining the running section carries a spec-resolved length/repeat over to the new object
    // (so the auto-rerun swap doesn't revert to the default and re-roll a random length)
    sections.instances = {}
    sections.active = sections.next = sections.pendingActive = undefined
    let r1 = { name:'r', length:6, repeat:2 } // resolved values from a previous activation
    sections.define('r', r1)
    sections.active = r1
    let r2 = { name:'r', length:32, repeat:undefined, lengthSpec:(e,b)=>4, repeatSpec:(e,b)=>3 } // fresh reparse: default length, specs present
    sections.define('r', r2)
    assert(true, sections.active === r2)
    assert(6, sections.active.length)           // resolved length carried over, not the default 32
    assert(2, sections.active.repeat)           // resolved repeat carried over
    sections.active = undefined

    // reported bug: redefining the active section must keep its standard functions live
    sections.next = sections.pendingActive = undefined
    let e1 = { name:'e', length:8 }; sections.addStandardParams(e1); sections.define('e', e1)
    sections.active = e1; sections.activeStartBeat = 0
    assert(1, sections.instances.e.active({},2))
    let e2 = { name:'e', length:8 }; sections.addStandardParams(e2); sections.define('e', e2)
    assert(1, sections.instances.e.active({},2)) // still active (not 0) after the redefinition
    assert(2, sections.instances.e.time({},2))   // timing intact
    sections.instances = { default: sections.makeDefault() }
    sections.active = sections.activeStartBeat = undefined

    // The default section is a real registry entry that can be redefined, keeping active live
    sections.active = sections.instances.default; sections.activeStartBeat = 0
    assert(8, sections.default.length)          // baseline
    assert(1, sections.default.active({},0))
    let d16 = sections.makeDefault(); d16.length = 16; sections.define('default', d16)
    assert(true, sections.active === d16)       // active follows the redefinition
    assert(16, sections.default.length)         // new length in effect
    assert(1, sections.default.active({},0))    // standard functions still live
    assert(2, sections.default.time({},2))      // timing intact (start beat unchanged)
    sections.resetDefault()                     // reverts to baseline, active still follows
    assert(true, sections.active === sections.instances.default)
    assert(8, sections.default.length)
    sections.instances = { default: sections.makeDefault() }
    sections.active = sections.activeStartBeat = undefined

    // Advancement / active-next-default tracking
    sections.active = undefined
    sections.next = undefined
    sections.activeStartBeat = 0

    // Init: adopts the default section; reports a change
    assert(true, sections.update(0))
    assert(true, sections.active === sections.default)
    assert(0, sections.activeStartBeat)

    // Not yet ended (default length 3); no change
    assert(false, sections.update(3))
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

    // fromUi bypasses suppressForce, so a button click always applies
    sections.suppressForce = true
    sections.forceNext('b', true)
    assert(true, sections.next === b)
    sections.pendingActive = undefined
    sections.forceActive('b', true)
    assert(true, sections.pendingActive === b)
    sections.suppressForce = false
    sections.pendingActive = undefined

    // clearNext unqueues
    sections.next = b
    sections.clearNext()
    assert(undefined, sections.next)

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

    sections.instances = { default: sections.makeDefault() } // Keep the built-in default registered

    // repeat/count: a section repeats `repeat` times (activeCount 0..repeat-1) before advancing
    let rep = { name:'rep', length:8, repeat:3 }
    let after = { name:'after', length:8 }
    sections.instances = { rep: rep, after: after, default: sections.makeDefault() }
    sections.active = undefined
    sections.next = undefined
    sections.pendingActive = rep
    sections.activeStartBeat = 0

    // Becomes active -> count resets to 0
    sections.update(0)
    assert(true, sections.active === rep)
    assert(0, sections.activeCount)
    sections.next = after // queue what follows the final repeat

    // 1st finish -> count 1, repeats (still active, next not consumed, no change reported, restart)
    assert(false, sections.update(8))
    assert(true, sections.active === rep)
    assert(1, sections.activeCount)
    assert(true, sections.next === after) // next preserved across repeats
    assert(8, sections.activeStartBeat)   // replayed from the top

    // 2nd finish -> count 2, still repeating
    assert(false, sections.update(16))
    assert(true, sections.active === rep)
    assert(2, sections.activeCount)
    assert(true, sections.next === after)

    // 3rd finish -> count reaches repeat, advances to next; counter resets for the new section
    assert(true, sections.update(24))
    assert(true, sections.active === after)
    assert(0, sections.activeCount)
    assert(undefined, sections.next)      // next consumed on the final advance

    // count standard param reads activeCount when active, 0 when inactive
    let cs = { name:'cs', length:8 }
    sections.addStandardParams(cs)
    sections.active = cs
    sections.activeCount = 2
    assert(2, cs.count({},0))
    sections.active = undefined
    assert(0, cs.count({},0))

    // A section without repeat advances after a single play (unchanged behaviour)
    let once = { name:'once', length:8 }
    sections.instances = { once: once, after: after, default: sections.makeDefault() }
    sections.active = undefined
    sections.next = after
    sections.pendingActive = once
    sections.update(0)
    assert(true, sections.active === once)
    assert(true, sections.update(8))
    assert(true, sections.active === after) // advanced after one play, no repeat

    sections.instances = { default: sections.makeDefault() } // Keep the built-in default registered

    // resolveActiveParams: length/repeat specs (non-constant expressions) resolve to concrete numbers
    let rap = { name:'rap', length:32 }
    rap.lengthSpec = (e,b) => 6
    rap.repeatSpec = (e,b) => 2
    sections.resolveActiveParams(rap, 0)
    assert(6, rap.length)   // spec evaluated into length
    assert(2, rap.repeat)   // spec evaluated into repeat
    // A section with no specs is untouched
    let noSpec = { name:'nospec', length:8 }
    sections.resolveActiveParams(noSpec, 0)
    assert(8, noSpec.length)
    assert(undefined, noSpec.repeat)

    // A length spec resolves once per activation and is held for the run (not re-evalled per repeat)
    let vary = { name:'vary', length:32, repeat:3, lengthSpec:(e,b) => b < 10 ? 4 : 8 }
    sections.instances = { vary: vary, default: sections.makeDefault() }
    sections.active = undefined; sections.next = undefined; sections.pendingActive = vary
    sections.activeStartBeat = 0; sections.activeCount = 0
    sections.update(0)                        // becomes active at beat 0 -> length resolves to 4
    assert(true, sections.active === vary)
    assert(4, vary.length)
    assert(false, sections.update(4))         // 1st finish: repeats, length unchanged (not re-resolved)
    assert(4, vary.length)
    assert(1, sections.activeCount)
    sections.pendingActive = vary             // force a fresh activation later
    sections.update(20)                       // re-resolves at beat 20 -> length 8
    assert(8, vary.length)

    // applyNext with a nextSpec evaluates to a named section
    sections.instances = { chorus: {name:'chorus', length:8}, verse: {name:'verse', length:8} }
    sections.next = undefined
    sections.applyNext({ name:'ns', nextSpec:(e,b) => 'Chorus' }, 0) // name lowercased on lookup
    assert(true, sections.next === sections.instances.chorus)

    // A nextSpec returning an array (plain chord) queues its first element
    sections.next = undefined
    sections.applyNext({ name:'na', nextSpec:(e,b) => ['verse','chorus'] }, 0)
    assert(true, sections.next === sections.instances.verse)

    // A nextSpec that varies (eg a random pick) always queues a valid section, re-chosen per activation
    let rnd = { name:'rnd', nextSpec:(e,b) => ['verse','chorus'][b % 2] }
    for (let i=0; i<8; i++) {
      sections.next = undefined
      sections.applyNext(rnd, i)
      assert(true, sections.next === sections.instances.verse || sections.next === sections.instances.chorus)
    }

    // Legacy nextName (no spec) still works
    sections.next = undefined
    sections.applyNext({ name:'legacy', nextName:'verse' }, 0)
    assert(true, sections.next === sections.instances.verse)

    sections.instances = { default: sections.makeDefault() } // Keep the built-in default registered

    // `set` overrides on sections //
    let opAdd = (l,r) => l+r
    let opMul = (l,r) => l*r

    // extractOverrides: `set <name> ...` lines naming a section are routed to it
    sections.instances = { drop: {name:'drop', length:16}, verse: {name:'verse', length:8} }
    sections.overrides = {}
    sections.activeOverrides = undefined
    let remaining = sections.extractOverrides({ drop:{length:4}, p1:{amp:2} }, id => id === 'p1')
    assert({p1:{amp:2}}, remaining)                 // player overrides pass straight through
    assert({drop:{length:4}}, sections.overrides)   // section override routed by name

    // A player of the same name wins: the override stays with the player (as in lookupOp)
    sections.overrides = {}
    remaining = sections.extractOverrides({ drop:{length:4} }, id => id === 'drop')
    assert({drop:{length:4}}, remaining)
    assert({}, sections.overrides)

    // An id that is neither a player nor a section is left alone
    sections.overrides = {}
    remaining = sections.extractOverrides({ nope:{length:4} }, () => false)
    assert({nope:{length:4}}, remaining)
    assert({}, sections.overrides)

    // The section/sx keyword targets the active section, and wins over a same-named player
    sections.overrides = {}
    sections.activeOverrides = undefined
    remaining = sections.extractOverrides({ section:{length:4}, sx:{foo:1} }, () => true)
    assert({}, remaining)
    assert({length:4, foo:1}, sections.activeOverrides)

    // Several set lines for the same section accumulate
    sections.overrides = {}
    sections.activeOverrides = undefined
    sections.extractOverrides({ drop:{length:4} }, () => false)
    sections.extractOverrides({ drop:{foo:1} }, () => false)
    assert({length:4, foo:1}, sections.overrides.drop)

    // Names are lowercased on the way in, matching getByName
    sections.overrides = {}
    sections.extractOverrides({ 'Drop':{length:4} }, () => false)
    assert({length:4}, sections.overrides.drop)

    // getParam / hasParam: the override folds onto the section's own value
    let ov = { name:'ov', length:16, foo:2 }
    sections.instances = { ov: ov }
    sections.active = undefined
    sections.overrides = { ov: { foo: 5 } }
    assert(5, sections.getParam(ov, 'foo'))
    assert(true, sections.hasParam(ov, 'foo'))
    assert(16, sections.getParam(ov, 'length'))    // an un-overridden param reads through
    assert(false, sections.hasParam(ov, 'nope'))
    assert(false, sections.hasParam(undefined, 'foo'))

    // A param the section never declared exists once it is overridden
    sections.overrides = { ov: { bar: 3 } }
    assert(true, sections.hasParam(ov, 'bar'))
    assert(3, sections.getParam(ov, 'bar'))

    // A compound override combines with the section's value, and repeated reads don't accumulate
    sections.overrides = { ov: { foo: newOverride(3, opAdd) } }
    assert(5, sections.getParam(ov, 'foo'))
    assert(5, sections.getParam(ov, 'foo'))

    // The active-section keyword applies only to the active section, and layers over a name override
    sections.overrides = { ov: { foo: 5 } }
    sections.activeOverrides = { foo: 9 }
    assert(5, sections.getParam(ov, 'foo'))        // not active: the keyword override doesn't apply
    sections.active = ov
    assert(9, sections.getParam(ov, 'foo'))        // active: a plain keyword assignment wins
    sections.activeOverrides = { foo: newOverride(1, opAdd) }
    assert(6, sections.getParam(ov, 'foo'))        // a compound one composes onto the name override
    sections.active = undefined
    sections.activeOverrides = undefined

    // getLength / getRepeat: evaluated live, with the validity checks resolveActiveParams uses
    let gl = { name:'gl', length:16, repeat:2 }
    sections.overrides = {}
    assert(16, sections.getLength(gl, 0))
    assert(2, sections.getRepeat(gl, 0))
    sections.overrides = { gl: { length: 4 } }
    assert(4, sections.getLength(gl, 0))
    sections.overrides = { gl: { length: newOverride(2, opMul) } }
    assert(32, sections.getLength(gl, 0))
    sections.overrides = { gl: { length: (e,b) => b } } // an expression is evaluated on each read
    assert(8, sections.getLength(gl, 8))
    sections.overrides = { gl: { length: 0 } }          // a zero/negative length would never end
    assert(16, sections.getLength(gl, 0))
    sections.overrides = { gl: { length: 'nope' } }
    assert(16, sections.getLength(gl, 0))
    sections.overrides = { gl: { repeat: 4 } }
    assert(4, sections.getRepeat(gl, 0))

    // An override layers over a length that a spec resolved at activation
    let sp = { name:'sp', length:32, lengthSpec:(e,b)=>6 }
    sections.resolveActiveParams(sp, 0)
    assert(6, sp.length)
    sections.overrides = { sp: { length: newOverride(2, opMul) } }
    assert(12, sections.getLength(sp, 0))

    // The active section advances on its overridden length, not its declared one
    let ol = { name:'ol', length:16 }
    sections.instances = { ol: ol, default: sections.makeDefault() }
    sections.active = undefined; sections.next = undefined; sections.pendingActive = ol
    sections.activeStartBeat = 0; sections.activeCount = 0
    sections.overrides = { ol: { length: 4 } }
    sections.update(0)
    assert(true, sections.active === ol)
    assert(false, sections.update(3))   // not yet at the overridden length
    assert(true, sections.update(4))    // ends at 4, not 16
    assert(true, sections.active === sections.default)

    // Standard params read the overridden length live
    let sl = { name:'sl', length:16 }
    sections.addStandardParams(sl)
    sections.instances = { sl: sl }
    sections.active = sl
    sections.next = undefined; sections.pendingActive = undefined
    sections.activeStartBeat = 0
    sections.overrides = {}
    assert(0.25, sl.riser({},4))
    sections.overrides = { sl: { length: 8 } }
    assert(0.5, sl.riser({},4))
    assert(4, sl.rtime({},4))
    assert(0.5, sl.fall({},4))
    sections.active = undefined

    // A `next` override supersedes the declared next
    let verseN = {name:'versen', length:8}, chorusN = {name:'chorusn', length:8}
    sections.instances = { versen: verseN, chorusn: chorusN }
    sections.overrides = { na: { next: (e,b) => 'chorusn' } }
    sections.next = undefined
    sections.applyNext({ name:'na', nextName:'versen' }, 0)
    assert(true, sections.next === chorusN)
    sections.overrides = {} // with no override the declared next still applies
    sections.next = undefined
    sections.applyNext({ name:'na', nextName:'versen' }, 0)
    assert(true, sections.next === verseN)

    // gc_reset clears the overrides, so a deleted set line stops applying
    sections.overrides = { a: {length:4} }
    sections.activeOverrides = { length: 4 }
    sections.instances = {}
    sections.gc_reset()
    assert({}, sections.overrides)
    assert(undefined, sections.activeOverrides)

    sections.instances = { default: sections.makeDefault() } // Keep the built-in default registered

    // Restore so it doesn't leak into the running app
    sections.active = undefined
    sections.next = undefined
    sections.pendingActive = undefined
    sections.activeStartBeat = 0
    sections.activeCount = 0

    console.log('Sections tests complete')
  }

  return sections
})
