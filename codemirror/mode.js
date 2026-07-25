// Syntax highlighting mode for the limut DSL.
// A line-oriented, token-based mode (no parser combinators). A small per-line state
// machine drives the semantic colours:
//   playerid  - the id at the start of a command line, and the id(s) after set/preset
//   keyword   - set / preset / include / follow / gp / section
//   property  - parameter / field names (`name=`, or `name:` inside a { } map)
//   pattern   - the pattern literal of a player line (the note/sample/drum sequence),
//               but not the pattern operators (crop, loop, +, *) or their arguments
// See index.html for the DSL reference; colours are the classes defined in codemirror.css.

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("limut", function() {

  // Highlighted as `keyword` wherever they appear
  var keywords = { set: true, gp: true, preset: true, follow: true, include: true, section: true };

  var wordRE = /[\w$]/;
  var operatorRE = /[+\-*/%=!?|~^&@]/;
  var numberRE = /^[\d_]*(\.\d+)?(\/\d+)?([eE][+\-]?\d+)?(db)?/i;
  // A word is a param/field name if immediately followed by an assignment (not `==`)...
  var paramAssignRE = /^\s*(?:[+\-*/])?=(?!=)/;
  // ...or by a `:` when the innermost open bracket is a { } map / arg list
  var mapColonRE = /^\s*:/;

  function tokenBlockComment(stream, state) {
    var maybeEnd = false, ch;
    while ((ch = stream.next()) != null) {
      if (ch == "/" && maybeEnd) { state.tokenize = tokenBase; break; }
      maybeEnd = (ch == "*");
    }
    return "comment";
  }

  // The pattern of a player line: everything from after the type up to the first comma.
  // Literal runs (note/sample/drum sequences, groups, subsequences) are `pattern` green;
  // the operators crop/loop/+/* and their number arguments keep their normal colours.
  function tokenPattern(stream, state) {
    if (stream.eatSpace()) return null;
    var ch = stream.peek();
    if (ch == ",") { stream.next(); state.region = "body"; return null; } // pattern ends; params follow
    if (ch == "/" && stream.match(/^\/\//)) { stream.skipToEnd(); return "comment"; }
    if (ch == "/" && stream.match(/^\/\*/)) { state.tokenize = tokenBlockComment; return tokenBlockComment(stream, state); }

    // Pattern operators / source keywords render as ordinary identifiers, not literals
    var kw = stream.match(/^(crop|loop|follow|now)\b/i);
    if (kw) { state.patExpect = /^now$/i.test(kw[0]) ? "literal" : "expression"; return "identifier"; }
    if (state.patExpect == "operator") {
      if (stream.eat("+")) { state.patExpect = "literal"; return "operator"; }
      if (stream.eat("*")) { state.patExpect = "expression"; return "operator"; }
    }

    // The argument of crop/loop/* (or the player named by follow) — normal number/identifier
    if (state.patExpect == "expression") {
      state.patExpect = "operator";
      if (/\d/.test(ch) || ch == ".") { stream.next(); stream.match(numberRE); return "number"; }
      stream.next(); stream.eatWhile(wordRE); return "identifier";
    }

    // A literal: a run up to whitespace, comma, or a comment start (brackets etc.
    // included), coloured green. `//` and `/*` end the literal so they start a comment.
    stream.next();
    while (!stream.eol() && !stream.match(/^[\s,]/, false) && !stream.match(/^\/[/*]/, false)) { stream.next(); }
    state.patExpect = "operator";
    return "pattern";
  }

  function tokenBase(stream, state) {
    var ch = stream.next();

    // Comments
    if (ch == "/" && stream.eat("/")) { stream.skipToEnd(); return "comment"; }
    if (ch == "/" && stream.eat("*")) { state.tokenize = tokenBlockComment; return tokenBlockComment(stream, state); }

    // Strings (single-quoted, file paths etc.)
    if (ch == "'") {
      while ((ch = stream.next()) != null) { if (ch == "'") break; }
      return "string";
    }

    // Hex colours: #036 #0369 #003366 #00336699
    if (ch == "#" && stream.match(/^[0-9a-fA-F]{1,8}/)) { return "colour"; }

    // Numbers: 1, 1.5, .5, 1/4, 1e3, 2db
    if (/\d/.test(ch) || (ch == "." && /\d/.test(stream.peek()))) {
      stream.match(numberRE);
      return "number";
    }

    // Brackets. Track a stack so map keys (`name:` inside `{ }`) can be told from
    // ranges (`[a:b]`), and the `set (a,b,...)` id list can be highlighted.
    // A `]` may carry a range/interpolation modifier: a type letter t/l/s/r/n with an
    // optional section-relative `x` on either/both sides (eg ]l ]tx ]xt ]lx ]xrx), or
    // `e`/`es` for an event timevar.
    if (ch == "]") { stream.match(/^(x?[tlsrn]x?|es?)/i); popBracket(state); return "bracket"; }
    if (ch == ")") { if (state.region == "setList") state.region = "body"; popBracket(state); return "bracket"; }
    if (ch == "}") { popBracket(state); return "bracket"; }
    if (ch == "[" || ch == "(" || ch == "{") {
      if (ch == "(" && state.region == "setHead") state.region = "setList";
      state.brackets.push(ch);
      return "bracket";
    }
    if (ch == "<" || ch == ">") { return "bracket"; }

    // Time-domain modifiers @e @f @s (a lone @ is an operator)
    if (ch == "@") { if (stream.eat(/[efs]/)) return "meta"; return "operator"; }

    // Operators: + - * / % = ! ? | ~ ^ &
    if (operatorRE.test(ch)) { stream.eatWhile(operatorRE); return "operator"; }

    // Words: param/field names, keywords, player ids, types, or plain identifiers
    if (wordRE.test(ch)) {
      stream.eatWhile(wordRE);
      var word = stream.current().toLowerCase();
      // Parameter / field name — takes precedence over id / identifier colouring
      if (stream.match(paramAssignRE, false) ||
          (state.brackets[state.brackets.length - 1] == "{" && stream.match(mapColonRE, false))) {
        if (state.region != "setList") state.region = "body";
        return "property";
      }
      if (keywords[word]) {
        state.region = word == "set" ? "setHead" : word == "preset" ? "presetName" : "body";
        return "keyword";
      }
      var style = "identifier";
      if (state.region == "setList") {
        style = "playerid"; // an id in the `set (a, b, ...)` list; stays in the list until )
      } else if (state.region == "setHead" || state.region == "presetName") {
        style = "playerid"; state.region = "body"; // the id after `set`, or the name after `preset`
      } else if (state.region == "afterId") {
        state.region = "pattern"; state.patExpect = "literal"; // the type word; its pattern follows
      } else if (state.region == "head") {
        // A line-start word is a player id only when a type word follows it (`id type ...`),
        // which tells a command apart from a continuation/closer line (`amp=2`, `}, vel=1`)
        if (stream.match(/^\s*[\w$]/, false)) { style = "playerid"; state.region = "afterId"; }
        else { state.region = "body"; }
      }
      return style;
    }

    // Punctuation (`. , : ;` etc.) — ranges [a:b] and chords (a,b) read cleanly
    return null;
  }

  function popBracket(state) { if (state.brackets.length) state.brackets.pop(); }

  return {
    startState: function() { return { tokenize: tokenBase, region: "head", patExpect: "literal", brackets: [] }; },
    token: function(stream, state) {
      if (stream.sol() && state.tokenize == tokenBase) { state.region = "head"; }
      if (state.tokenize == tokenBase && state.region == "pattern") return tokenPattern(stream, state);
      if (state.tokenize == tokenBase && stream.eatSpace()) return null;
      return state.tokenize(stream, state);
    },
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    closeBrackets: "()[]{}''",
    fold: "brace"
  };
});

CodeMirror.defineMIME("text/x-limut", "limut");

});
