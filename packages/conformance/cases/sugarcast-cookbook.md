# Sugarcast portable Twine behavior

These cases adapt small examples from the official Twine Cookbook and exercise Sugarcast's portable SugarCube-style surface.

## Conditions and variables

The conditional shape follows the Cookbook's [story-format comparison](https://twinery.org/cookbook/terms/terms_storyformats.html), and variable examples follow [setting and showing variables](https://twinery.org/cookbook/settingandshowing/sugarcube/sugarcube_settingandshowing.html).

### Conditional branches

```sugarcast
:: Start [start]
<<if $hasKey>>The door opens.<<else>>The door is locked.<</if>>
```

```json
{ "state": { "hasKey": false } }
```

```text
The door is locked.
```

--------

### Setting and printing variables

```sugarcast
:: Start [start]
<<set $coins = 2>><<set $coins += 3>>Coins: <<= $coins>> / <<- $coins>>
```

```text
Coins: 5 / 5
```

--------

### Comparison aliases and definedness

```sugarcast
:: Start [start]
<<if 1 eq "1" and 1 isnot "1" and def $present and ndef $missing>>compatible<<else>>wrong<</if>>
```

```json
{ "state": { "present": 0 } }
```

```text
compatible
```

--------

### Operator aliases do not rewrite quoted strings

```sugarcast
:: Start [start]
<<if $a is 1 and not $b>><<print "is and to">><</if>>
```

```json
{ "state": { "a": 1, "b": false } }
```

```text
is and to
```

--------

### Multiline conditionals preserve source-order effects

```sugarcast
:: Start [start]
Before <<if $enabled>>
<<set $value = 2>>

Value: <<print $value>>
<<else>>
<<set $value = 3>>
Disabled
<</if>>
```

```json
{ "state": { "enabled": true, "value": 0 }, "expect": { "state": { "enabled": true, "value": 2 } } }
```

```text
Before Value: 2
```

--------

### Compatibility views materialize source-order output

```sugarcast
:: Start [start]
<<if $hp > 0>>HP: $hp <<button "Hit">><<set $hp -= 1>><</button>><<else>>Dead<</if>>
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

## Markup

The markup sample is adapted from the Cookbook's [SugarCube markup](https://twinery.org/cookbook/markup/sugarcube/sugarcube_markup.html).

### Formatting, comments, lists, and continuation

```sugarcast
:: Start [start]
!Title
//emphasis// ''strong'' __underline__ ==strike== ^^sup^^ ~~sub~~
"""$hidden //raw//"""
{{{$hidden //code//}}}
/* hidden */ /% hidden too %/ visible
* item
** nested
# ordered
----
joined \
together
```

```json
{ "state": { "hidden": "shown" } }
```

```text
Titleemphasis strong underline strike sup sub$hidden //raw//$hidden //code//  visibleitemnestedorderedjoined together
```

--------

### Block code is not evaluated

```sugarcast
:: Start [start]
{{{
$hidden
}}}
```

```json
{ "state": { "hidden": "shown" } }
```

```text
$hidden
```

--------

### Naked variables and nowiki text

```sugarcast
:: Start [start]
<<set _local = { name: "temporary" }>>$hero.name $items[1] $hero[$key] _local.name $$hero <nowiki>$hero.name //raw//</nowiki> `$name`
```

```json
{
  "state": { "hero": { "name": "Mara", "title": "Captain" }, "items": ["zero", "one"], "key": "title", "name": "Mara" }
}
```

```text
Mara one Captain temporary $hero $hero.name //raw// `Mara`
```

## Reuse, loops, and interaction

The examples adapt the Cookbook's [passage inclusion](https://twinery.org/cookbook/passagesinpassages/sugarcube/sugarcube_passagesinpassages.html), [looping](https://twinery.org/cookbook/looping/sugarcube/sugarcube_looping.html), and [modularity](https://twinery.org/cookbook/modularity/sugarcube/sugarcube_modularity.html) recipes.

### Including another passage

```sugarcast
:: Start [start]
Before <<include "Reusable">> after
:: Reusable
inside
```

```text
Before inside after
```

--------

### Iterating an array

```sugarcast
:: Start [start]
<<set _items = ["A", "B", "C"]>><<for _item of _items>><<print _item>><</for>>
```

```text
ABC
```

--------

### Widgets provide reusable views and effects

```sugarcast
---
setup: [WidgetDefinitions]
---
:: WidgetDefinitions [widget]
<<widget "badge">><<print _args[0]>><</widget>>
<<widget "panel" container>>[<<print _contents>>]<</widget>>
<<widget "add">><<set $total += _args[0]>><</widget>>
:: Start [start]
<<badge "Ready">><<panel>>inside<</panel>><<add 2>><<print $total>>
```

```json
{ "state": { "total": 1 } }
```

```text
Ready[inside]3
```

--------

### Buttons execute portable control flow

```sugarcast
:: Start [start]
<<button "Add">>
  <<if $enabled>>
    <<for _value of $values>><<set $total += _value>><</for>>
  <<else>><<set $total = -1>><</if>>
<</button>>
:: Result
Total: <<print $total>>
```

```json
{
  "state": { "enabled": true, "values": [2, 3], "total": 0 },
  "steps": [{ "activate": "Add" }, { "navigate": { "target": "Result" } }]
}
```

```text
Total: 5
```

--------

### Checkbox changes write bound Story state

```sugarcast
:: Start [start]
<<checkbox "$enabled" false true autocheck>>
:: Result
<<print $enabled>>
```

```json
{
  "state": { "enabled": false },
  "steps": [
    { "change": { "target": "", "value": true } },
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

```sugarcast
:: Start [start]
''bold''
```

```xml
<gneh><strong key="&quot;i0:root/17:0&quot;"><text key="&quot;i0:root/17:0/19:0&quot;">bold</text></strong></gneh>
```
