# Limut

Live coding music and visuals in the browser. Inspired by FoxDot with a desire to make it more accessible by running in any modern browser with no installation. Approach to visuals inspired by Crash Server's `video` player, and shadertoy :-)

# Documentation

Documentation is available in the page itself, underneath the console.

# Try it

Try it at https://sdclibbery.github.io/limut/

Example limut code can be pasted into the editor to see what Limut can do; this can be found on the page under the editor and console windows, or there are many examples (including some technical tests) at https://github.com/sdclibbery/limut/blob/master/examples.limut

Please report problems / bugs / browser issues etc as github issues at https://github.com/sdclibbery/limut/issues

# Releases and breaking changes

Normal development should be backwards compatible. There is no specific log of added functionality (apart from the commit log).

Occasionally, breaking changes are introduced; when this happens, a new github release is produced: https://github.com/sdclibbery/limut/releases to document the upgrade path for user code.

# Electron app

Limut can be run as a website, or packaged into a desktop web app. With npm installed, run `npm install` to install electron, and then `npm start` to run the electron app. There are no prepackaged versions available at present (pull requests welcome).

# Code Editor

Limut uses the CodeMirror editor by default (https://codemirror.net). This provides syntax coloring. However, on some devices (eg mobile) a better experience may result from using a basic textarea editor; this can be enabled by using the `?textarea` url parameter.

# Development

Run locally by firing up `./server.sh` and connecting a browser to http://localhost:8000/?test . The unit tests run on page load when the `?test` url parameter is present; view output in the browser console.

# Samples

Piano sounds: https://archive.org/details/SalamanderGrandPianoV3

Limut's audio files have been copied from FoxDot (https://github.com/Qirky/FoxDot), where they were obtained from a number of sources. Here's a list of thanks for the unknowing creators of FoxDot's sample archive.

    Legowelt Sample Kits
    Game Boy Drum Kit
    A number of sounds courtesy of Mike Hodnick's live coded album, Expedition
    Many samples have been obtained from http://freesound.org and have been placed in the public domain via the Creative Commons 0 License: http://creativecommons.org/publicdomain/zero/1.0/ - thank you to the original creators
    Other samples have come from the Dirt Sample Engine which is part of the TidalCycles live coding language created by Yaxu - another huge amount of thanks.

If you feel I've used a sample where I shouldn't have, please get in touch!

# Waveforms

Some waveform tables are taken from the Web Audio Samples repo, under the Apache license: https://github.com/GoogleChromeLabs/web-audio-samples

# Shaders

Many shaders are based on ones from https://www.shadertoy.com/ , and the shadertoy synth uses the Shadertoy.com API to load shaders directly from shadertoy.
