'use strict';
define(function(require) {
  let players = require('player/players')
  let evalParam = require('player/eval-param')

  let multiplyEvents = (event) => {
    for (let k in event) {
      let v = event[k]
      if (Array.isArray(v)) {
        return v.flatMap(x => {
          let e = Object.assign({}, event)
          e[k] = x
          return multiplyEvents(e)
        })
      }
    }
    return [event]
  }

  let combineEvents = (events, params) => {
    return events.flatMap(sourceEvent => {
      let event = Object.assign({}, sourceEvent)
      for (let k in params) {
        if (k != 'time' && k != 'delay' && k != 'value' && k != 'add') {
          event[k] = evalParam(params[k], sourceEvent.idx, sourceEvent.count)
        }
      }
      if (params.add) {
        let add = evalParam(params.add, sourceEvent.idx, sourceEvent.count)
        if (event.add == undefined) {
          event.add = add
        } else {
          if (Array.isArray(add)) {
            let b = event.add
            event.add = add.map(v => b+v)
          } else {
            event.add += add
          }
        }
      }
      return multiplyEvents(event)
    })
  }

  let followPlayer = (playerName, params) => {
    return (beat) => {
      let p = players.instances[playerName.toLowerCase()]
      if (p === undefined) { throw 'Follow player not found: '+playerName }
      let events = p.getEventsForBeat(beat)
      return combineEvents(events, params)
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert([{idx:0, count:0, value:'1'}], combineEvents([{idx:0, count:0, value:'1'}], {}));
  assert([{idx:0, count:0, value:'1'}], combineEvents([{idx:0, count:0, value:'1'}], {value:'9', delay:8, time:7}));
  assert([{idx:0, count:0, value:'1', oct:3},{idx:0, count:0, value:'1', oct:4}], combineEvents([{idx:0, count:0, value:'1'}], {oct:()=>[3,4]}));
  assert([{idx:0, count:0, value:'1', add:2}], combineEvents([{idx:0, count:0, value:'1', add:2}], {}));
  assert([{idx:0, count:0, value:'1', add:3}], combineEvents([{idx:0, count:0, value:'1'}], {add:3}));
  assert([{idx:0, count:0, value:'1', add:5}], combineEvents([{idx:0, count:0, value:'1', add:2}], {add:3}));
  assert([{idx:0, count:0, value:'1', add:6}], combineEvents([{idx:0, count:0, value:'1', add:2}], {add:() => 4}));
  assert([{idx:0, count:0, value:'1', add:5},{idx:0, count:0, value:'1', add:6}], combineEvents([{idx:0, count:0, value:'1', add:2}], {add:()=>[3,4]}));

  console.log('follow player tests complete')

  return followPlayer;
});
