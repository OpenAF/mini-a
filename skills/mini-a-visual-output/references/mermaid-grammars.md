# Mermaid 12.0.0: railroad grammars

Read only when explaining a grammar. These four keywords select different input languages; do not mix their operators. Examples are illustrative. Keep strict mode and validate experimental syntax against the deployed renderer.

## Intermediate representation

Use terminal/nonterminal, sequence, choice, optional, zeroOrMore or oneOrMore constructors. Rules end with semicolons.

```mermaid
railroad-beta
  title Note identifier
  identifier = sequence(terminal("note-"), oneOrMore(nonterminal("digit"))) ;
  digit = choice(terminal("0"), terminal("1")) ;
```

## EBNF

Rules use `=`, alternatives use `|`, repetition uses `*`/`+`, and grouping uses parentheses.

```mermaid
railroad-ebnf-beta
  title Note identifier
  identifier = "note-" digit+ ;
  digit = "0" | "1" ;
```

## ABNF

Alternatives use `/`; repetition prefixes the item (e.g. `1*DIGIT`). Core rules such as DIGIT and ALPHA are available.

```mermaid
railroad-abnf-beta
  title Note identifier
  identifier = "note-" 1*DIGIT ;
```

## PEG

Rules use `<-`, ordered choice uses `/` and repetition uses postfix `*`/`+`. Preserve alternative order; it affects matching.

```mermaid
railroad-peg-beta
  title Note identifier
  Identifier <- "note-" Digit+ ;
  Digit <- "0" / "1" ;
```
