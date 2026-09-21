# Karlowe portable Twine behavior

These cases adapt small examples from the official Twine Cookbook and retain Karlowe's portable Harlowe-style behavior.

## Conditions and variables

The conditional shape follows the Cookbook's [story-format comparison](https://twinery.org/cookbook/terms/terms_storyformats.html).

### Conditional branches

```karlowe
:: Start [start]
(if: $hasKey)[The door opens.](else:)[The door is locked.]
```

```json
{ "state": { "hasKey": true } }
```

```text
The door opens.
```

--------

### Setting and printing variables

```karlowe
:: Start [start]
(set: $coins to 2)(set: $coins to $coins + 3)Coins: (print: $coins)
```

```text
Coins: 5
```

--------

### Inferred comparisons and logical precedence

```karlowe
:: Start [start]
(if: $reason is 7 or 14 and $experience is 3)[match](else:)[miss] (if: 3 and 4 < $limit)[range](else:)[outside]
```

```json
{ "state": { "reason": 14, "experience": 3, "limit": 5 } }
```

```text
matchrange
```

--------

### Arithmetic, arrays, possessive access, and membership

```karlowe
:: Start [start]
(print: 1 + 2 * 3) (print: $enemy's name) (print: (a: 1, 2) contains 2)
```

```json
{ "state": { "enemy": { "name": "Ada" } } }
```

```text
7 Ada true
```

--------

### Macro names ignore ASCII case, hyphens, and underscores

```karlowe
:: Start [start]
(Se-T: $value to 7)(Pr_In_T: $value)
```

```json
{ "state": { "value": 0 }, "expect": { "state": { "value": 7 } } }
```

```text
7
```

--------

### Compatibility views materialize source-order output

```karlowe
:: Start [start]
(if: $hp > 0)[HP: $hp (link-repeat: "Hit")[(set: $hp to $hp - 1)]](else:)[Dead]
[[Next->End]]
:: End
End
```

```json
{ "state": { "hp": 1 }, "steps": [{ "activate": "Hit" }], "expect": { "state": { "hp": 0 } } }
```

```text
HP: 1 HitNext
```

--------

### Effects and values materialize in source order

```karlowe
:: Start [start]
(set: $value to 1)(print: $value)(set: $value to 2)(print: $value)
```

```json
{ "state": { "value": 0 }, "expect": { "state": { "value": 2 } } }
```

```text
12
```

--------

### Conditional writes execute only the selected hook

```karlowe
:: Start [start]
(if: $enabled)[(set: $value to 2)](else:)[(set: $value to 3)](print: $value)
```

```json
{ "state": { "enabled": false, "value": 0 }, "expect": { "state": { "enabled": false, "value": 3 } } }
```

```text
3
```

## Markup and layout

The inline forms are adapted from the Cookbook's [Harlowe markup](https://twinery.org/cookbook/markup/harlowe/harlowe_markup.html).

### Harlowe formatting, lists, and verbatim text

```karlowe
:: Start [start]
#Title
//italic// ''bold'' *emphasis* **strong** ~~strike~~ ^^sup^^
`$hidden //raw//`
* item
** nested
0. first
---
```

```json
{ "state": { "hidden": "shown" } }
```

```text
Titleitalic bold emphasis strong strike sup$hidden //raw//itemnestedfirst
```

--------

### Collapsing and combined emphasis

```karlowe
:: Start [start]
{one
    two} ***both*** {=three
   four
```

```text
one two both three four
```

--------

### Prose line breaks and escaped joins

```karlowe
:: Start [start]
first
second\
third
\fourth
```

```text
firstsecondthirdfourth
```

--------

### Modal aligners

```karlowe
:: Start [start]
==>
right
=><=
center
===><=
offset
<==>
justified
<==
left
```

```text
rightcenteroffsetjustifiedleft
```

--------

### Named-hook replacement is semantic

```karlowe
:: Start [start]
|notice>[old](replace: ?notice)[new]
```

```text
new
```

## Reuse, iteration, and navigation

### Displaying another passage

```karlowe
:: Start [start]
Before (display: "Reusable") after
:: Reusable
inside
```

```text
Before inside after
```

--------

### Iterating an array

```karlowe
:: Start [start]
(for: each _item, (a: "A", "B", "C"))[(print: _item)]
```

```text
ABC
```

--------

### Rightmost link arrow and computed possessive access

```karlowe
:: Start [start]
[[A->B->End]]
:: End
(print: (a: "first", "second")'s ($position))
```

```json
{ "state": { "position": 2 }, "steps": [{ "activate": "A->B" }] }
```

```text
second
```

--------

### Triple brackets resolve hook and link ambiguity

```karlowe
:: Start [start]
Before [[[Go->End]]]
:: End
Done
```

```json
{ "steps": [{ "activate": "Go" }], "expect": { "current": "End" } }
```

```text
Done
```

--------

### Source-order navigation settles before publishing a view

```karlowe
:: Start [start]
(go-to: "End")
:: End
Done
```

```json
{ "expect": { "current": "End" } }
```

```text
Done
```

--------

### Checkbox changes write bound Story state

```karlowe
:: Start [start]
(checkbox: 2bind $enabled, "Enabled")
:: Result
(print: $enabled)
```

```json
{
  "state": { "enabled": false },
  "steps": [
    { "change": { "target": "Enabled", "value": true } },
    { "navigate": { "target": "Result" } }
  ],
  "expect": { "state": { "enabled": true } }
}
```

```text
true
```

--------

### Canonical XML projection

```karlowe
:: Start [start]
''bold''
```

```xml
<gneh><bold key="&quot;i0:root/17:0&quot;"><text key="&quot;i0:root/17:0/19:0&quot;">bold</text></bold></gneh>
```
