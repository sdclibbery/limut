'use strict'
define(function(require) {
  // Always-present buses, re-parsed before every code update. `main` is the final mix to the
  // system output; `silent` is an inaudible bus (amp=0) that still carries its summed signal on
  // its `.pre` tap, for using a player purely as a modulator (route it with bus=silent).
  return () => 'main bus 0, amp=2\nsilent bus 0, amp=0'
})
