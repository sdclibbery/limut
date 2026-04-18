---
name: write-music
description: write limut DSL code to produce music in a style requested by the user
---

Write limut DSL code to produce music. Read the CLAUDE.md in the project root for full DSL reference. Below are practical patterns learned from examples.limut and the full index.html documentation.

## Structure of a Piece

A piece typically has:
1. `set bpm=N` (common: 80-150)
2. `set scale=NAME` (minor, phrygian, dorian, mixolydian, lydian, penta, major, etc.)
3. Optional `set root=N` to transpose
4. Drum/percussion players
5. Bass player
6. Harmonic/pad players
7. Lead/melody players
8. Optional visuals (v lines)
9. Optional `set ch=...` for shared chord progressions

Each line defines one player: `ID TYPE PATTERN, param=value, param=value`

Limut is case insensitive; `piano`, `Piano`, and `PIANO` are all treated the same.

## Basic Syntax

### Comments
- `//` line comment
- `/* ... */` block comment

### Commands
- `id synth pattern, params` - define a player
- `set id params` - override player params
- `set var=value` - set global var
- `preset name synth, params` - create a synth preset
- `include 'url'` - include a limut source file

### Multi-line commands
Commands can span multiple lines. A new command starts when the beginning of a line matches `set `, `preset `, or `id type pattern`.

## Drum Patterns

Use `play` type with letter patterns. Each character is a 1-beat hit; `.` is rest.

### Play Samples (full list)
Each letter maps to a sample folder. Multiple samples exist per letter (selected via `sample=N`).

| Char | Sound | Char | Sound |
|---|---|---|---|
| `x` | Bass drum | `X` | Heavy kick |
| `v` | Soft kick | `V` | Hard kick |
| `o` | Snare drum | `O` | Heavy snare |
| `u` | Soft snare | `i` | Jungle snare |
| `I` | Rock snare | `D` | Dirty snare |
| `-` | Hi hat closed | `=` | Hi hat open |
| `:` | Hi-hats | `+` | Clicks |
| `*` | Clap | `H` | Clap |
| `h` | Finger snaps | `#` | Crash |
| `~` | Ride cymbal | `s` | Shaker |
| `S` | Tambourine | `t` | Rimshot |
| `T` | Cowbell | `e` | Electronic Cowbell |
| `k` | Wood shaker | `K` | Percussive hits |
| `l` | Robot noise | `L` | Noisy percussive hits |
| `m` | 808 toms | `M` | Acoustic toms |
| `r` | Metal | `R` | Metallic |
| `p` | Tabla | `P` | Tabla long |
| `d` | Woodblock | `n` | Noise |
| `a` | Gameboy hihat | `A` | Gameboy kick drum |
| `b` | Noisy beep | `B` | Short saw |
| `c` | Voice/string | `C` | Choral |
| `E` | Ringing percussion | `f` | Pops |
| `F` | Trumpet stabs | `g` | Ominous |
| `G` | Ambient stabs | `J` | Ambient stabs |
| `N` | Gameboy SFX | `w` | Dub hits |
| `W` | Distorted | `y` | Percussive hits |
| `Y` | High buzz | `z` | Scratch |
| `Z` | Loud stabs | `q` | Ambient stabs |
| `Q` | Electronic stabs | `U` | Misc. Fx |
| `\|` | Hangdrum | `/` | Reverse sounds |
| `\` | Lazer | `%` | Noise bursts |
| `$` | Beatbox | `@` | Gameboy noise |
| `&` | Chime | `!` | Yeah! |
| `1` | Vocals (One) | `2` | Vocals (Two) |
| `3` | Vocals (Three) | `4` | Vocals (Four) |

### Typical drum patterns

```
kd play X., room=0.1                           // four-on-floor kick
kd play (Xv)., room=0.1                        // kick with ghost note chord
kd play X..X.X.., room=0.1                     // syncopated kick
sd play ..O., room=0.1                         // backbeat snare
sd play ..(OH*)., room=0.2                     // snare with clap layer
hh play -, echo=1/4, amp=2                     // 8th note hats
hh play -[--]-[.-], fold, amp=2               // breakbeat-style hats
hh play .[::], echo=1/8                       // hat pattern with tight hats
```

## Pattern Syntax

### Brackets in patterns
- `(...)` = chord (play all simultaneously)
- `[...]` = subsequence (fit multiple events into one `dur`)
- `<...>` = supersequence (cycle through alternatives each pattern repeat)

Examples:
- `X<...[.v]>` = first time X then ..., second time X then .v
- `[XX]` = two kicks in one beat (double time)
- `(OH)` = snare and clap together

### Pattern modifiers
- `.` = rest (silence)
- `_` = continuation/tie (extends previous note, NOT rest)
- `0#` = sharp
- `0b` = flat
- `0=` = extend duration by 50%
- `0!` = shorten duration by 33%
- `0^` = 50% louder
- `0v` = 33% quieter
- `x^` = 50% louder (non-numeric, for play synth)
- `0a` = other chars after digits become params; eg `t tri 01g23, glide=this.g/2`

### Pattern literal
`` `01 23` `` = backtick pattern literal; whitespace is ignored, contents treated as literal

### Pattern operators
- `01 loop 2` = play pattern only N times then stop
- `0123 crop 2` = crop pattern to N steps (repeats if needed)
- `1 + 2` = concatenate two patterns
- `1 * 2` = repeat pattern N times
- `now 01` = play starting on next beat instead of from beat 0
- `follow p1` = follow another player's pattern
- `gamepad` = generate notes from gamepad controller
- `midi` = generate notes from MIDI controller

## Audio Synth Types

### Basic oscillators
- `play` - sample player (letters/symbols for samples). Duration defaults to 1/2
- `perc` - sampled percussion. Duration defaults to 1/4, has choke group
- `saw` - sawtooth wave, oct=4
- `sine` - sine wave, oct=4
- `square` - square wave, oct=4
- `tri` - triangle wave, oct=4
- `pulse` - pulse wave, oct=3
- `wave` - waveform specified by `wave` param
- `ping` - sine wave ping, oct=5, simple envelope
- `noise` - white noise pad (AudioWorklet)

### Detuned variants (thicker sound)
- `dsaw` - detuned sawtooth, oct=4
- `dsine` - detuned sine pad, oct=4
- `dsquare` - detuned square, oct=4
- `dtri` - detuned triangle, oct=4
- `dbass` - detuned sawtooth bass, oct=2
- `dpulse` - detuned pulse, oct=3
- `dwave` - detuned waveform specified by `wave` param
- `swell` - detuned triangle pad, oct=4

### FM synthesis
- `fm` - FM base synth; configure operators with `op1` to `op6` params
  - `op1={ratio:5.19,target:3,wave:'saw',depth:0.8,att:0.01,rel:0.1}`
- `fmbass` - FM bass, oct=2
- `bell` - FM bell
- `glock` - FM glockenspiel, oct=4
- `glass` - FM glass/chime, oct=5
- `xylo` - FM xylophone, oct=4
- `ethereal` - FM pad, oct=5
- `epiano` - DX7-style electric piano

### Complex synths
- `audiosynth` - base type; use `play` param for custom audio node graph
- `piano` - sampled piano
- `pwm` - pulse width modulation (AudioWorklet). `pwm=1/2` for pulse width
- `prophet` - PWM with LFO pulse-width (AudioWorklet)
- `supersaw` - 7-oscillator supersaw lead, oct=4
- `ambi` - ambient drone, multiple sines
- `multiwave` - multiple oscillators: `wave1={'saw',amp:[0:1]n,detune:wow}`
- `pitchedperc` - synthesised percussion (click/hit/body/rattle components)
  - `click={1}`, `hit={0,sample:'^',index:1,rate:3/2}`
  - `body={1,att:5ms,dec:400ms,freq:55hz,boost:150hz,wave:'sine',saturation:0}`
  - `rattle={1,att:0ms,dec:30ms,rate:1,filter:'lowpass',freq:55hz,boost:205hz,q:18}`
- `bd` - preset kick drum based on pitchedperc. Params: `accent`, `tone`, `tune=55`
- `io808` - TR-808 simulation. `type='bd'` selects sound. Params: `level`, `tone`, `decay`, `snappy`, `tuning`
- `impulse` - single pulse
- `sample` - pitched sample player. Use `sample` param for URL, `start` for playback offset
- `external` - microphone/line input. `track=1`, `channel=1`
- `crackle` - crackly sounds
- `noisefloor` - slowly varying noise floor
- `bus` - audio mix bus (plays continuously, all params per-frame). Implicit `main` bus exists

### Special synths
- `! / stop / none` - stop/remove a player

## Melodic Patterns

Scale degrees (0-indexed): `0` = root, `1` = 2nd, `2` = 3rd, etc. Negative numbers go down.

```
// Melodic bass line
db dbass 0[.0][10]_, dur=1/2, lpf=[200:2000]s8, att=0, oct=(1,2)

// Arpeggio
arp dsaw 02435167, dur=1/2, sus=1/4, echo=3/4, lpf={[500:1500]l7,q:22}, att=0

// Chord stab
stab dsaw (0246), dur=[3,3,2]/4, att=0, sus=1/4, echo=3/4, lpf={[500:1700]l5,q:20}

// Pad
pad ethereal (024)(035), dur=4, room=0.7, oct=4
```

## Value Syntax

Basic structure: `value{modifiers}@interval`

### Numeric values
- `1` - constant number
- `0dB` - decibel value (converted to gain; 0dB=1, +6dB~2, -6dB~0.5, -20dB~0.1)
- `100ms` - milliseconds; `1s` - seconds; `1Hz`/`1cps` - Hertz; `1kHz` = 1000Hz
- `1b` - beats; `1cpb` - cycles per beat; `1kcpb` = 1000cpb; `1cpm` - cycles per minute
- Missing value on param = `1` (eg `monochrome` same as `monochrome=1`)

### Sequences and timevars
- `[1,2]` - sequence, one per event
- `[]` - equivalent to `[0,1]`
- `[1,2]t3` - timed sequence, each value lasts 3 beats
- `[1:12,2:4]t` - timed sequence with variable timing per value
- `[0:3]t1` - expanded timed sequence = `[0,1,2,3]t1`
- `[1,2]l3` - linear interpolated sequence over 3 beats
- `[1:12,2:4]l` - linear interpolated with variable timing
- `[1,2]s3` - smooth (S-curve) interpolated sequence over 3 beats
- `[1,2]e` - interpolated over event duration
- `[1,2]e1` - interpolated starting at event start, 1 beat per value
- `[0:!300ms,1:_[1/4b:1/2b]r,0]e` - piecewise envelope with mixed timing
- `[1:!200ms,0]e@s` - segment-based (more accurate timing for envelopes)

### Random and noise
- `[]r` - random 0 to 1 each event
- `[1,4,7]r` - random choice from list
- `[:9]r` or `[0:9]r` - random float from range
- `[0,1:7]r` - weighted random (1 is 7x more likely than 0)
- `[1,2]r4` - random, hold for 4 beats
- `[1:3]r{seed:1,per:4}` - deterministic seeded random
- `[]n` - smooth Perlin noise 0 to 1
- `[1:2]n4` - noise between 1-2, period ~4 beats
- `[]n{seed:1,per:4}` - deterministic noise

### Piecewise series
`[v1:i1t1, v2:i2t2, ...]{p, repeat:0}` - interpolate between values with custom control parameter
- Interpolation operators: `:/` `:\` linear, `:_` const/step, `:~` smooth bezier, `:!` exponential, `:^4:` power curve

### Arithmetic
`+`, `-`, `*`, `/`, `%`, `^` (power), `-` (unary minus)

### Chords
- `(1,2,4)` - play simultaneously
- `|` - concatenate chords: `1|2` = `(1,2)`, `(1,2)|(3,4)` = `(1,2,3,4)`

### Conditionals
- `??` - "if then": `this.foo??5` returns 5 if foo is truthy, nothing if not (short circuits)
- `?:` - "or else": `this.foo?:5` returns foo if present, else 5 (short circuits)
- Ternary: `this.foo>1 ?? 2 ?: 3`

### Comparisons
`==`, `!=`, `<`, `>`, `<=`, `>=`

### Maps
- `{x:0,y:1}` - map with key-value pairs
- `{2,y:1}` - map with main value plus subparams (eg `chop={2,wave:'tri'}`)
- Colours: `{r:0,g:1,b:0,a:1}` (RGBA), `{h:1,s:1,v:1,a:1}` (HSV), `{labh:1,c:1,l:1}` (LabLCH)
- Hex colours: `#f00f` (RGBA short), `#ff0000ff` (RGBA long), `#f00` / `#ff0000` (RGB, alpha=1)
- `'abc'` - string value (single line; use `\n` for line breaks)

### Lookups (dot operator)
- `p1.amp` - player param lookup (returns chord of all playing events)
- `p1.amp.0` - chord index (wraps around)
- `p1.pulse.max` - chord aggregator: `max`, `min`, `first`, `last`, `rand`, `count`, `sum`, `avg`
- `this.value` - current event param
- `this.freq` - current note frequency
- `{foo:2}.foo` - map field lookup
- `([0,1]t1@f).accum` - smoothly accumulate values

### Modifiers
- `{time:time*2+8}` - modify the time expression
- `{per:8}` - repeat sequence every 8 beats
- `{per:8,0:7,2:3}` - force values at specific beat positions within repeat
- `{step:1/2}` - advance time in discrete steps
- Note: modifier and interval order can be swapped: `[]r@f{seed:1}` = `[]r{seed:1}@f`

### Intervals
- `@e` - evaluate once per event
- `@f` - evaluate per frame (~60fps) for smooth animation
- Interval applies to nearest value: `this.foo@e` applies `@e` to `foo` only; use `(this.foo)@e` for the whole lookup

### Variable lookup
- `foo` - lookup global var named `foo`; returns string `'foo'` if no var exists
- `foo{x:2}` - call var as function with named params

## Common Event Params

### Timing
- `dur=N` - duration in beats (1/4=16th, 1/2=8th, 1=quarter, 2=half, 4=whole)
- `dur=[3,3,2]/4` - common shuffle/swing pattern
- `delay=N` - event start time offset in beats
- `delay={1/2,add:2}` - delay with param overrides on delayed events
- `stutter=N` - split event into N evenly-spaced sub-events
- `swing=N` - swing amount (50=straight, 58-66=swung, 75=max dotted)
- `swing={66,period:1/2}` - swing with custom period (default 1/4)

### Volume
- `amp` - player amplitude (defaults to event `vel`)
- `vel` - event velocity (default 3/4; controls amp and usually brightness)

### READ ONLY params
- `voice` - voice index within a chord
- `time` - current time in beats this event has been playing
- `idx` - pattern index of this event
- `exists` - 1 if player is defined
- `playing` - 1 if player is currently sounding
- `pulse` - rise/fall value as note plays (pre-multiplied by vel)
- `player` - name of current player
- `freq` - note frequency in Hz (set by tonal synths)

### Other
- `rate` - playback rate for samples, animation rate for visuals

## Audio Params

### Envelope
- `att` - attack time (default unit: beats). `att=0` for sharp attack
- `dec` - decay time
- `sus` - sustain time. `sus={level:0.5}` for sustain level (default 0.8)
- `rel` - release time
- `envelope` - type: `'full'` (ADSR), `'simple'` (ADR), `'organ'` (ASR), `'pad'` (cosine crossfade), `'linpad'` (linear crossfade), `'percussion'` (R only). Or custom expression: `envelope=[1:!300ms,0]e@s`

### Pitch & Tuning
- `oct=N` - octave (1=sub bass, 2=bass, 3=low, 4=mid, 5=high)
- `oct=(2,3)` - chord across octaves
- `add=N` - add scale degrees to pitch (per-event only)
- `add={0,#:1}` - sharpen; `add={0,b:1}` - flatten
- `addc=N` - add continuous semitones (per-frame, fractional). `addc=wow` for pitch drift
- `detune=N` - oscillator detuning in semitones
- `vib=RATE` - vibrato rate (default unit: cpb)
- `vib={2,depth:1}` - vibrato depth in semitones (default 0.4)
- `vib={2,delay:1}` - delay before vibrato starts (default 1/2 beat)
- `glide=N` - portamento time in beats. `glide={1/3,curve:4}` for curve shape (default curve:1)
- `root=N` - override root for this player only
- `scale=NAME` - override scale for this player

### Filter
- `lpf=FREQ` - low pass filter. `lpf={400,q:20}` for resonance (default q:5). `lpf={400,poles:4}` for 24dB/oct
- `hpf=FREQ` - high pass filter. Same subparams as lpf
- `bpf={FREQ,q:20}` - band pass filter (default q:1). Multiple parallel: `bpf1`, `bpf2` etc
- `nf={FREQ,q:20}` - notch filter (default q:1)
- `apf1={FREQ,q:2}` - allpass filter. Multiple `apf1`, `apf2` etc (parallel, allowing phase cancellation)
- `psf={f1:300,f2:2300,q:0.7}` - phaser stage filter. Multiple `psf1`, `psf2` etc (series)
- `low=-6dB` - low shelf EQ. `low={-8db,freq:400}` (default freq:200Hz)
- `mid=-6dB` - mid EQ. `mid={-8db,freq:400,q:10}` (default freq:600Hz, q:5)
- `high=-6dB` - high shelf EQ. `high={-8db,freq:400}` (default freq:1100Hz)
- Filter sweep: `lpf={[200:2000]l8,q:15}`

### Effects
- `room=N` - freeverb (0.1-2). `room={2,hpf:300,mix:1/4}` (default mix:1/2)
- `reverb=N` - convolution reverb duration in beats. `reverb={2,curve:3,hpf:300,mix:1/4}` (default mix:1/2, curve:5)
- `echo=TIME` - echo delay. `echo={1,feedback:0.8}` (default feedback:0.35). Bus echo: `echo={1,max:2}`
- `chorus=N` - stereo chorus. `chorus={1,mix:1/4}`
- `phaser=RATE` - phaser (default unit: cpb). `phaser={1/3,mix:1/4}`
- `flanger=RATE` - flanger (default unit: cpb). `flanger={1/3,mix:1/4}`
- `chop=N` - tremolo/gating (default unit: cpb). `chop={2,wave:'triangle',mix:1/4}` (waves: sine, square, triangle, saw)
- `ring=FREQ` - ring modulation (default unit: Hz). `ring={32,wave:'saw',mix:1/4}` (default wave: triangle)
- `drive=N` - overdrive/soft clip (1/32=gentle, 1/4=distortion, 1=fuzz). `drive={1,gain:2,mix:1/4}`
- `fold=N` - wavefolder. `fold={1,gain:2,mix:1/4}`
- `clip=N` - hard clipping. `clip={1,gain:2,mix:1/4}`
- `noisify=N` - distort into noise. `noisify={1,gain:2,mix:1/4}`
- `bits=N` - bitcrusher (1=very distorted, 32=clean, 0=off). `bits={4,gain:2,mix:1/4}`
- `suck=N` - scale down small amplitudes (gated tail effect). `suck={1,gain:2,mix:1/4}`
- `compress=RATIO` - compression. `compress={12,gain:2,threshold:-40dB,knee:10dB,att:0.1,rel:0.2}`

### Spatial
- `pan=N` - stereo position (-1 to 1)
- `pan=(-1,1)` - hard pan left and right
- `mono` - force signal to mono

### Other audio params
- `choke=GROUP` - choke group (string); notes cut off others in same group across players
- `sample=N` - with `play`: choose sample set. With `sample` synth: URL of audio file
- `sample={32,pitch:261.6}` - specify original sample pitch (default 261.6Hz = C4)
- `start=N` - sample playback start time (default unit: seconds)
- `wave=NAME` - waveform: `sine`, `square`, `sawtooth`/`saw`, `triangle`/`tri`, `pulse`, plus many more: `ah`, `bass`, `brass`, `buzzy`, `celeste`, `ethnic`, `organ`, `piano`, `trombone`, `wurlitzer`, etc. (hyphenated names need quotes)
- `bus=ID` - mix to specified bus player (default: `main`)
- `cutoff` - filter cutoff 0-1 (for presets that support it)
- `resonance` - filter resonance (for presets that support it)

## Visual Synths

- `blank` - solid colour
- `clouds` - moving clouds
- `kal` - kaleidoscope
- `swirl` - psychedelic swirl
- `julia` - Julia set fractal
- `lines` - twisting lines
- `blob` - morphing 3D blob
- `streetlight` - passing streetlights
- `grid` - square grid
- `glow` - additive glow
- `stars` - exploding stars
- `bits` - bitwise fractal patterns
- `xor` - bitwise xor patterns
- `gradient` - simple y gradient
- `shadertoy` - shadertoy shader (use `id` param; must be public+api)
- `image` - online image (use `url` param; must support CORS)
- `webcam` - webcam feed. `device` param for device index/label. `width`/`height` for resolution
- `text` - text display. `text={'Hello',font:'times',size:'144',linesize:0.7,y:1/4,x:2/3,style:'bold italic'}`
- `buffer` - render target. Other synths render into it with `buffer=ID`
- `scope` - audio waveform display
- `scopefft` - frequency spectrum display
- `readout` - digital value display
- `dmx` - DMX lighting output. `channel`, `set`, `lights`, `addl`, `mul`, `min`, `max` params

## Visual Params

- `add` - add to pattern value
- `zorder` - draw order (default: line number / 1000)
- `fade` - brightness fadeout
- `time` - override shader time (default unit: beats; overrides `rate` and `sway`)
- `rate` - shader time progression rate
- `pulse` - audio signal effect on visual value
- `sway` - audio signal effect on visual time
- `loc` - position/size: `{x:0,y:0,w:2,h:2}` for fullscreen. Coords: (-1,-1) bottom-left to (1,1) top-right
- `window` - display only portion matching screen position
- `scroll` - scroll shader: `{x:0,y:0}`
- `repeat` - repeat shader section. `repeat={1/2,x:0.1,y:-0.05}`
- `zoom` - zoom: `{x:1,y:1}`
- `rotate` - rotation in full turns (1/2 = 180 degrees)
- `mirror=N` - number of mirror planes. `mirror={10,rotate:1/4,fan:1}`
- `fore` - foreground colour
- `mid` - middleground colour (defaults to midway between fore and back)
- `back` - background colour
- `pixellate=N` - pixellate to N pixels in x. `pixellate={10,y:20}`
- `perspective=N` - perspective warp (negative to invert). `perspective={-1,shade:1/2}`
- `tunnel` - tunnel/slitscan warp
- `ripple` - ripple distortion. `ripple={1,scale:1/4}`
- `additive` - additive blend
- `blend` - blend mode: `additive`, `subtractive`, `average`, `multiply`, `invert`, `min`, `max`
- `monochrome` - 0=normal, 1=monochrome
- `vignette` - edge fadeout. `vignette={1/2,aspect:4/3,cutoff:0.95}`
- `vhs` - VHS tape effect
- `recol` - recolour: `oil`, `hue`, `fire`, `sunset`, `neon`, `titanium`
- `contrast` - power contrast curve (0=none)
- `buffer=ID` - render to a buffer synth
- `rez=N` - buffer render target resolution scale (default 1/2)
- `feedback` - buffer video feedback. `feedback={zoom:1.01,ripple:1/32,contrast:0.005}`

## Main Vars (set, not readable)

- `bpm` - beats per minute (resets unless set every update)
- `scale` - scale name (resets unless set every update)
- `root` - root pitch offset in semitones (fractional OK for tuning nudges)
- `beat.readouts` - beat counter display: `beat.readouts=(3,12)` (default: (12,16,32), max 3)

## Predefined Vars

- `time` - current time in beats
- `wow` - smooth random pitch drift for analog feel; eg `addc=wow`
- `tg` - trance gate signal (flips on/off every quarter beat)
- `drop6_2` through `drop63_1` - predefined on/off drop patterns (eg `[1,0]t[6,2]`)
- `tile_full`, `tile_tl`/`tr`/`bl`/`br`/`m`, `tile_h1`-`h5`, `tile_v1`-`v5` - visual locations
- `fullscreen` - full screen tile
- `tile_random`/`tile_rand` - random location tile
- `sparkle` - small random location tile
- `droplet` - small tile falling down screen
- `spark` - small tile flying outwards
- `gravity` - accelerating downward motion (combine: `spark+gravity`)
- `firefly` - random insect-like motion
- Colours: `transparent`, `black`, `darkgray`, `gray`, `lightgray`, `white`, `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `violet`, `neonpink`, `neongreen`
- `random` - random colour
- `rainbow` - colour cycling through rainbow

## Functions

- `abs{-1}` - absolute value
- `sign{-1}` / `sgn` - sign (-1, 0, 1)
- `pitch{1}` - frequency for scale degree. `pitch{4#}` sharp. `pitch{0,oct:3,scale:minor,root:2}`
- `eventpitch{}` - frequency based on current event params
- `floor{1.5}` / `ceil{1.2}` / `round{1.7}` - rounding. `floor{1.7,to:1/2}` rounds to precision
- `accum{1}` - accumulate value over time (only rises)
- `smooth{[]r@f}` - smooth a value. `smooth{x,att:4,dec:4}` or `smooth{x,2}` combined rate
- `rate{[0:1]l1@f}` - rate of change in units per beat
- `first{3,1,2}` / `last{3,1,2}` - first/last argument
- `min{3,1,2}` / `max{3,1,2}` - min/max of arguments
- `count{3,1,2}` / `sum{3,1,2}` / `avg{3,1,2}` - count/sum/average
- `rand{3,1,2}` - random choice from arguments
- `rand` - pseudo-random 0-1 (time-hashed; respects `step`/`per` modifiers)
- `euclid{3,from:8}` - Euclidean rhythm generator. `euclid{3,from:8,offset:1}` for rotation
- `sin{x}` / `cos{x}` / `tan{x}` - trig functions (radians)
- `time` - current time in beats (respects modifiers)

## Node Functions

For building custom audio graphs with `>>` connect operator and `audiosynth`:

- `osc{'sawtooth',freq:440,phase:0}` - oscillator node
- `const{1}` - constant value node
- `gain{1}` - gain node
- `delay{1/4b,feedback:...,max:1b}` - delay node
- `panner{0}` - stereo panner (-1 to 1)
- `sample{sample:'url',start:0s,rate:1}` - sample player. Also: `sample{sample:{x}->...,length:0.2s}` function-generated
- `sample{sample:'url',loopstart:1,looplen:2}` - looping sample
- `biquad{'lowpass',freq:440Hz,q:5}` - biquad filter (lowpass/highpass/bandpass/notch/lowshelf/highshelf/peaking)
- `compress{ratio:0,threshold:1/316,knee:100,attack:0.01s,release:0.25s}` - compressor
- `convolver{env:{x}->...,length:1s}` - convolver reverb. Stereo: `convolver{env:{l:{x}->...,r:{x}->...},length:1s}`
- `shaper{{x}->...,samples:2,oversample:'2x'}` - wave shaper ('2x', '4x', 'none')
- `series{...,count:2}` - repeat chain in series
- `loop{...,feedback:...}` - audio feedback loop (must contain delay)
- `mix{...,mix:1/2}` - dry/wet mix. Also `mix3` through `mix8` for fixed ratios
- `stereo{l:...,r:...}` - split/process/join stereo channels
- `flipper` - swap L/R channels
- `idnode` / `dry` / `thru` - pass-through node

## Nodes Library (`include 'lib/nodes.limut'`)

Helper functions wrapping node functions (all args can be positional):

- `lpf{freq,q:5}` / `hpf{freq,q:5}` / `bpf{freq,q:5}` / `nf{freq,q:5}` / `apf{freq,q:5}` - filters
- `lpf4{freq,q:5}` - 4-pole low pass
- `lsf{gain,freq:1100Hz}` / `hsf{gain,freq:1100Hz}` / `pkf{gain,freq:1100Hz}` - shelf/peak EQ
- `lfo{freq,wave:'triangle',lo:0,hi:1,phase:0}` - LFO (any frequency)
- `osc.sin{freq}` / `osc.saw{freq}` / `osc.square{freq}` / `osc.tri{freq}` / `osc.pulse{freq}` - typed oscillators
- `drive{amount:1/2}` - overdrive waveshaper
- `stanh{gain:3/2}` - tanh saturation (alias for `shaper.tanh`)
- `shaper.tanh{gain}` / `shaper.atan{gain}` / `shaper.poly{gain}` / `shaper.pow{curve}` / `shaper.asym{gain,bias}` / `shaper.diode{gain,pos,neg}` - waveshapers
- `compressor{...}` / `limiter{...}` - dynamics

## Effects Library (`include 'lib/effects.limut'`)

Wet-path effects (wrap in `mix{}` for dry signal):

- `echo{time:1/8b,feedback:0.7,max}` - echo with feedback and dry path
- `pingpong{time:1/4b,feedback:0.7}` - stereo ping-pong delay
- `reverb{length:1b,curve:3}` - convolution reverb
- `flanger{control:[0,1]l8@f,feedback:0,lo:0.0005,hi:0.007}` - flanger
- `phaser{control:[0,1]l4@f,lo:300Hz,hi:2600Hz,stages:4,q:1/2}` - phaser
- `shifter{ratio,length:0.03}` - pitch shifter
- `shimmer{ratio:2,length:2s}` - shimmer reverb
- `tape{wow:1,cut:-10db}` - cassette tape effect
- `airverb{delay:1/2b}` - airy reverb with flanger and stereo pingpong
- `grain{ratio,length:0.03,phase:0}` - granular resynthesis grain
- `demon{}` - demon voice effect (for vocals/mic)
- `ultracomb{f:...,p:...,s:...,stages:6}` - ultracomb filter (growling sounds)

## User Input Functions

- `slider{0.1}` - on-screen slider. `slider{name:'Foo',min:-5,max:5,curve:2}`
- `gamepad{1}` - gamepad axis (-1 to 1). `gamepad{button:0}` (0-1). `gamepad{'lsh'}` left stick horizontal. `gp` is alias
- `midi{70}` - MIDI control/note (0-1). `midi{36,9,1}` (control 36, channel 9, port 1)
- `midi{'bend'}` - pitch bend (-1 to 1). `midi{'notes'}` - chord of playing notes. `midi{'vel'}` - velocity

## Console Commands

- `list` - list all player base types including presets
- `list audio` - list filtered by string

## Preset Libraries

### Synthwave (`include 'preset/synthwave.limut'`)
Audio: `moroder`, `blade`, `laserharp`, `synlead`, `synpluck`, `synbass`, `chiparp`, `softpad`, `space`, `blues`, `basspluck`, `bloom`, `pick`, `softkeys`, `epiano`, `lushpad`, `stringpad`, `oxy`, `vambi`, `cybass`, `cydist`, `cyborg`, `hiss`, `blips`, `chime`, `play80s`
Visual: `neongrid`, `neonbars`, `neonbits`, `neonlines`, `neonsine`, `neonheart`, `neonshapes`, `skybars`, `sun`, `sunsetsky`, `vhsbuffer`
Many support `cutoff` param (0-1, default 1/2). Some support `decay` param.

### 808 (`include 'preset/808.limut'`)
Individual: `bd808`, `sd808`, `oh808`, `ch808`, `cb808`, `cp808`, `ma808`, `ht808`, `mt808`, `lt808`, `hc808`, `mc808`, `lc808`, `cl808`, `rs808`, `cy808`
Combined: `tr808` (all-in-one; pattern chars select sound: x/v=bd, o/i/u=sd, h/*=cp, -/:/a=ch, ==oh, ~=cy, k=cl, m=mt, t=rs, s=ma, p=mc, e=cb; ^ flag for accent), `h808` (hihats; `o` flag for open), `t808` (toms; `h`/`l` flags), `c808` (congas; `h`/`l` flags)

### 909 (`include 'preset/909.limut'`)
Synthesized: `bd909` (level, tune, attack, decay), `sd909` (level, tune, tone, snappy), `h909` (level, chdecay, ohdecay; `o` flag for open), `cp909` (level), `cc909` (level, tune), `rc909` (level, tune), `t909` (level, tune, decay; `l`/`h` flags), `rs909` (level)
Sampled (lighter CPU): `bds909`, `sds909`, `hs909`, `cps909`, `ccs909`, `rcs909`, `ts909`, `rss909`
All: event value gives accent.

### TB-303 (`include 'preset/303.limut'`)
`tb303` - acid bass. Controls: `wave` ('saw'/'square'), `cutoff`, `resonance`, `envmod`, `decay`, `accent` (all 0-1, default 1/2). Pattern flags: `a` accent, `u` up octave, `d` down octave, `s` slide.
Example: `` b tb303 `0a2u2b0d 0u0a2d3 00u0a0d 0da4ua5a6u`, cutoff=[1/4:1]n3, resonance=0.8, accent=1 ``

### Trance (`include 'preset/trance.limut'`)
`trance` - classic supersaw lead (default `add=(0,2)`). Controls: `cutoff`, `decay`, `detune` (all 0-1).

### Techno (`include 'preset/techno.limut'`)
Includes 909, 303, trance libraries. Audio: `hollow`, `tinbass` (cutoff), `sweep` (cutoff), `robot`, `techbass` (cutoff, decay), `growl`

### House (`include 'preset/house.limut'`)
Includes 909, 303, trance libraries. Audio: `m1organ` (cutoff), `reese` (cutoff, detune), `donk` (cutoff, decay), `didgeridoo`

## Available Scales

chromatic, major, minor, pentatonic/penta, minorpentatonic/minorpenta, mixolydian, dorian, phrygian, lydian, locrian, harmonicminor, harmonicmajor, melodicminor, melodicmajor, diminished, egyptian, blues, wholetone, chinese, hungarianminor, romanianminor, halfwhole, wholehalf, bebopmaj, bebopdorian, bebopdom, bebopmelmin, majorpentatonic, aeolian, dorian2, yu, zhi, prometheus, indian, locrianmajor, lydianminor, minmaj, susb9, lydianaug, lydiandom, melmin5th, halfdim, altered

## Set for Groups

```
set (p1,p2,p3) room=0.7, echo=3/4    // apply params to multiple players
set p* amp=0                           // wildcard: all players starting with p
set !p* add+=7                         // all players NOT starting with p
set * swing=58                         // all players
set ch=[0,2,4,3]t8                     // define shared variable
```

### Operator overrides
- `add+=N` - add to existing value
- `amp*=N` - multiply existing value
- `oct+=N` - shift octave

## Bus Mixing

There is an implicit `main` bus. Players can route to named buses:
```
fx bus 0, echo=1/2, room=0.5
bass dbass 0, bus=fx
```
Override main bus: `set main echo=1/2`

## Genre Recipes

### Techno (120-140 bpm, minor/phrygian)
```
set bpm=130
set scale=phrygian
kd play X., room=0.1
hh play -, echo=1/4, amp=2
sd play ..(H*)., room=0.2
db dbass 0, dur=1/4, lpf={[150:800]r,q:12}, att=0, amp=2
pad dsaw (0246), dur=8, envelope=pad, lpf=[500:3000]l16@f, oct=(3,4), amp=1/2
```

### House (120-128 bpm, minor/dorian)
```
set bpm=125
set scale=minor
kd play X., room=0.1
hh play .[::], echo=1/4
sd play ..O., room=0.3
bass fmbass 0[.0][.0][0.], dur=1/2, sus=1/2, lpf={[300:800]n4,q:8}, oct=(2,3), att=0, amp=0.8
pad prophet (0246), dur=8, oct=(2,3), amp=1/2, room=0.7
```

### Ambient (60-90 bpm, major/lydian/penta)
```
set bpm=70
set scale=penta
pad ethereal (024)(035), dur=4, room=2, oct=(3,4), amp=1/3, pan=[-1:1]r
pi piano 0, dur=[2,4], add=[-2:3]n1/4, amp=[0:1]n6, room=0.7, oct=5
n noise 0, dur=8, amp=1/16, lpf=[800:1200]n4, pan=(-1,1), room=2
```

### DnB (160-180 bpm, minor)
```
set bpm=170
set scale=minor
kd play X..X.X.., room=0.1
sd play ..O., room=0.1
hh play -[--]-[.-], amp=2, echo=1/4
db dbass 0, dur=1/4, lpf=[200:1000]l8, att=0, oct=(1,2), amp=2
```

### Acid (125-135 bpm, phrygian)
```
set bpm=127
set scale=phrygian
kd play X., room=0.1
hh play -, amp=2
b saw 00[43]-707[-32]-4, dur=1/2, oct=2, amp=2, echo=3/4, lpf={this.freq*[2:50]n4,q:25}
```

### Synthwave (80-120 bpm, minor/phrygian)
```
set bpm=100
set scale=minor
kd play X.v., room=0.2
sd play ..O., room=0.2
hh play -===---=, dur=1/4, amp=2
db dbass 0, dur=1/4, lpf={[200:1400]n8,q:15}, amp=1+wow, room=0.2
pad blade (024)(035), dur=4, oct=3, add=[0,4,5,6]t8
arp synpluck 02479742, dur=1/4, echo=3/4, lpf=[500:3000]l11
```

### Breakbeat/IDM (120-140 bpm, minor/phrygian)
```
set bpm=132
set * swing=58
kd play V., room=0.1
hh play [.-]-[.-][--], fold, amp=2
sd play ..*., fold, room=0.1
b saw .0, dur=1/2, oct=2, lpf={[200:1500]l8,q:12}, flanger=1/7, amp=3/2
```

## Tips for Good Music

1. **Layer sparingly**: 4-8 players is plenty. Too many = mud.
2. **Use filter sweeps**: `lpf={[300:2000]l8,q:15}` adds movement and interest.
3. **Echo/delay**: `echo=3/4` (dotted quarter) or `echo=1/2` creates rhythmic interest.
4. **Shared chord progressions**: Define `set ch=[0,2,4,3]t8` and use `add=ch` on multiple players.
5. **Pan for width**: Spread elements with `pan=(-1,1)` or `pan=[-1/2:1/2]r`.
6. **Room/reverb**: Use sparingly on drums (0.1-0.3), more on pads/leads (0.5-2).
7. **Sidechain-like pumping**: `amp=1-kd.pulse.min` makes things duck with the kick.
8. **Build/drop structure**: Use `set` overrides and commented lines for live arrangement.
9. **Octave layering**: `oct=(2,3)` or `oct=(3,4,5)` for thickness.
10. **wow for organic movement**: `addc=wow` adds subtle pitch drift to pads/leads.
11. **Swing**: `set * swing=58` gives a nice groove (50=straight, 66=heavy triplet swing).
12. **Amp variation**: `amp=[0:1]n4` for perlin noise dynamics, `amp=[]r` for random.
13. **Chop/gate**: `chop=2` or `chop=4` for rhythmic gating on pads.
14. **Follow**: `dsf dsquare follow ds` - layer the same pattern with a different synth.

## Production Idioms (from real pieces)

### Mastering chain on `main` bus
Almost every finished piece ends with one of these on `set main`:
```
set main compress={2,gain:2}, drive=1/32                     // gentle glue + warmth
set main compress={2,gain:2}, drive=1/64, reverb={1,mix:1/4} // + tail
set main compress={3/2,gain:3/2}, drive=1/96, amp=3/2        // heavy techno glue
```
`drive` 1/96 → 1/16 trades subtle warmth for audible saturation. `compress` ratio 2-3 with `gain:2-3` is the sweet spot.

### Multi-bus organization (techno/house template)
Separate buses per stem so each can be shaped independently:
```
set p* bus='bp'                                 // all perc → bp
set !p* bus='blead'                              // everything else → blead
bp bus 0, compress={2,gain:2}, drive=1/32, amp=2/3
blead bus 0, compress={2,gain:2}, reverb={2,mix:1/3}, amp=1/2
```
Common bus names: `bp`/`bperc`, `bb`/`bbass`, `blead`/`bl`, `be` (external).

### Sparse delay idiom (`delay|=[...]t[N,M]`)
Adds occasional delay throws without changing every event:
```
set p* delay|=[(),[1,3]r/4]t[14,2]    // 14 bars dry, 2 bars random throws
set p* delay|=[(),[1,3,5]r/4]t[13,3]
delay=[0,(0,[1/4,3/4]r)]t[7,1]        // single-player form
```
`|=` (concat-assign) appends to existing delay rather than overwriting.

### Pattern variation with `crop` and `+`
```
b reese 0_7 crop 14 + 89             // 14 beats of 0_7, then 89
ps sd909 ..0 crop 16
t trance 72. crop 14 + 89
```

### Sidechain-style ducking via `pulse`
```
amp=2/3+kd.pulse.0/3                       // pad swells with kick
contrast=3-2*bs.pulse.max                   // visual reacts to bass
zoom=1+smooth{main.pulse,att:1/2,dec:1/2}   // smoothed pulse for visuals
```

### Visual + buffer feedback (canonical setup)
```
vk kal 1, buffer='vb', blend=max, contrast=3, fore=neonpink
vb buffer 0, feedback={fore:0.95,zoom:1.01,rotate:0.001}
```
Common feedback knobs: `fore:0.85-0.97` (decay), `zoom:1.001-1.05`, `rotate`, `ripple`, `scroll`, `mirror`. Reactive: `feedback={fore:0.85+0.15*pk.pulse.0,zoom:1.02}`.

### Webcam + recolor
```
vw webcam 0, vignette=0, buffer='vb', recol=neon, blend=max
vb buffer 0, loc=tile_tr, feedback={fore:0.9,zoom:1.02}
```

### VHS retro look
```
v kal 0, vhs, vignette={1/2,aspect:4/3}, contrast
vb vhsbuffer 0, feedback={fore:0.85}
```

### Build/drop arrangement via `riser`
`riser` is typically a slider ramp. Pieces stash a "drop" block as comments:
```
// set (b*,p*) hpf=10000-10000*riser^3    // sweep filters open
// set t cutoff=riser^3                    // open lead filter
// f sd909 2, level=riser^6                 // snare roll fades in
```
Define with `set riser=slider{0,name:'Riser'}`.

### Euclidean rhythms
```
ph h909 0, o=euclid{16,from:[19,23]t4}-1     // open-hat pattern
b tb303 0, amp=euclid{32,from:53}-7/8         // sparse 303 line
o m1organ 0, dur=euclid{7,from:16}/4          // polymeter via dur
```

### One-shots with `now ... loop 1`
```
boom play now [(vx)(vX)(VXM)] loop 1, room=2, echo=0.46
whoosh dsaw now (047) loop 1, envelope=simple, att=1/2, rel=3
```
`now` starts on next beat (not beat 0); `loop 1` plays once.

### Layered delay copies via subparams
Layer a delayed copy with different params on the same event:
```
delay=(0,{1/4,oct:3})                     // dry + delayed-up-an-octave
delay=(0,{3/4,oct:2,addc:19})             // detuned/octave-shifted
delay=(0,{1/2,add:1,stutter:2})           // multiple overrides
```

### Shared chord progressions via `set ch=...`
```
set ch=[(0,2,4,7),(0,3,5,7),(1,3,5b,7),(1,3,4,6#)]t4
p dsaw 0, add=ch, glide=2/3
l sine 0, add=ch.rand, oct=5      // .rand picks a voice
b bass 0, add=ch.0                 // .0 picks first voice
```

### Non-percussion targeting with `set !p*`
```
set !p* add+=[2,-1,1,0]t4
set !p* bus='blead'
```

### Drum preset notes
- **909 synth** (`bd909`, `sd909`, `h909`, `cp909`, `t909`, `rs909`, `cc909`, `rc909`): pass `attack` flag to `bd909` for pitch-envelope click. Params: `level`, `tune`, `decay`, `tone`, `snappy`.
- **909 sampled** (`bds909`, `sds909`, `hs909`, `cps909`, `ts909`, `rss909`, `ccs909`, `rcs909`): much lighter CPU — prefer for dense patterns.
- **`h909`/`hs909`**: pattern char `o` = open hat. Drum char letters in patterns also pick variations.
- **`tb303`** flags: `a`=accent, `u`=up oct, `d`=down oct, `s`=slide.

### Live-coding scaffold
Typical improv file:
```
include 'preset/synthwave.limut'        // or techno/house
set scale=minor
set bpm=120
set main compress={2,gain:2}, drive=1/64

vk kal 0, buffer='vb', blend=max, contrast
vb buffer 0, feedback={fore:0.95,zoom:1.01}

pk bd909 0..., attack
ph h909 ..0, swing=54
ps sd909 ..0., swing=58

b tb303 0, cutoff=[0:1]n4, resonance=7/8

// l trance 0_7, decay=5, reverb=2          // bring in lead
// pad softpad (024), dur=4
// set (p*,b) amp=0                         // drop block
// set t cutoff=riser^3
```
