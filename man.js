'use strict';
define(function (require) {
  let consoleOut = require('console')

  let entryName = (codeText) => {
    let m = codeText.trim().match(/^[\w.!]+/)
    return m ? m[0].toLowerCase() : undefined
  }

  let entries = () => [...document.querySelectorAll('.info p:not(.sub):not(.subsub)')]
    .filter(p => p.firstElementChild && p.firstElementChild.tagName === 'CODE' && p.textContent.trim().startsWith(p.firstElementChild.textContent.trim()))
    .map(p => ({ p, name: entryName(p.firstElementChild.textContent) }))
    .filter(e => e.name)

  let sectionTitle = (p) => {
    let div = p.closest('div[id^=accordion-]')
    let h = div && div.previousElementSibling
    return h ? h.textContent.trim() : ''
  }

  let show = (p) => {
    consoleOut('[' + sectionTitle(p) + ']\n' + p.textContent.trim())
    for (let s = p.nextElementSibling; s; s = s.nextElementSibling) {
      if (s.tagName === 'DIV' || s.matches('p.sub.accordion')) { continue }
      if (!s.matches('p.sub')) { break }
      consoleOut('  ' + s.textContent.trim())
    }
  }

  consoleOut.addCommand('man', (args) => {
    let name = (args[0] || '').toLowerCase()
    if (!name) { consoleOut('Usage: man <name>, eg man fog'); return }
    let all = entries()
    let found = all.filter(e => e.name === name)
    if (found.length > 0) { found.forEach(e => show(e.p)); return }
    consoleOut(`No docs for '${name}'`)
    let similar = [...new Set(all.map(e => e.name).filter(n => n.includes(name)))].slice(0, 10)
    if (similar.length > 0) { consoleOut('See: ' + similar.join(', ')) }
  })

  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    assert('fog', entryName('fog{in, amount:1/2}'))
    assert('bpf1', entryName('bpf1'))
    assert('wavetable', entryName("wavetable={'sample/wt64/SUPERSAW.WAV'}"))
    assert('beat.readouts', entryName('beat.readouts'))
    assert('add', entryName('Add=2'))
    assert('!', entryName('! / stop / none'))
    assert(undefined, entryName('{x}->x'))
    console.log('Man tests complete')
  }
})
