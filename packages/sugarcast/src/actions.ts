import type { EffectNode } from '@gneh/core';
import { parseSugarExpression } from '@gneh/expression';
import type { MarkupParser } from '@gneh/syntax';
import type { SugarcastLowerings, SugarcastMacroToken } from './parser.js';

type ReadMacro = (source: string, index: number) => SugarcastMacroToken | undefined;

type ReadBlock = (
  source: string,
  opening: SugarcastMacroToken,
) => {
  sections: { tag: SugarcastMacroToken; body: string; base: number }[];
  end: number;
};

/** Lower the effect-only subset accepted inside SugarCube link/button bodies. */
export function actionBody(
  source: string,
  base: number,
  parser: MarkupParser,
  registry: SugarcastLowerings,
  readMacro: ReadMacro,
  readBlock: ReadBlock,
): EffectNode[] {
  let index = 0;
  const effects: EffectNode[] = [];
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    const macro = readMacro(source, index);
    if (!macro)
      parser.error(
        'SUGARCAST_ACTION',
        'Button bodies contain only effect macros in the portable profile.',
        base + index,
      );
    const canonical = registry.normalize(macro.name);
    if (canonical === 'if') {
      const block = readBlock(source, macro);
      let alternate: EffectNode[] = [];
      for (let sectionIndex = block.sections.length - 1; sectionIndex >= 0; sectionIndex--) {
        const section = block.sections[sectionIndex];
        const branch = actionBody(section.body, base + section.base, parser, registry, readMacro, readBlock);
        if (registry.normalize(section.tag.name) === 'else') alternate = branch;
        else
          alternate = [
            {
              type: 'if',
              test: parseSugarExpression(
                section.tag.args,
                parser.span(base + section.tag.argStart, base + section.tag.end - 2),
              ).ast,
              yes: branch,
              no: alternate,
            },
          ];
      }
      effects.push(...alternate);
      index = block.end;
      continue;
    }
    if (canonical === 'for') {
      const match = /^(?:const\s+|let\s+)?(_?[A-Za-z]\w*)\s+of\s+([\s\S]+)$/.exec(macro.args);
      if (!match)
        parser.error(
          'SUGARCAST_FOR',
          'Portable sugarcast uses <<for _item of expression>>. C-style and range loops require a rewrite.',
          base + index,
          base + macro.end,
        );
      const block = readBlock(source, macro);
      effects.push({
        type: 'each',
        binding: { type: 'Identifier', name: match[1] },
        items: parseSugarExpression(
          match[2],
          parser.span(base + macro.argStart + macro.args.indexOf(match[2]), base + macro.end - 2),
        ).ast,
        body: actionBody(block.sections[0].body, base + block.sections[0].base, parser, registry, readMacro, readBlock),
      });
      index = block.end;
      continue;
    }
    const result = registry.lower(macro.name, {
      source,
      index,
      base,
      parser,
      inline: true,
      node: { ...macro, type: 'macro', fullEnd: macro.end, children: [] },
    });
    const lowered = result?.nodes.filter((node) => node.type === 'effect') ?? [];
    if (!result || lowered.length !== result.nodes.length)
      parser.error(
        'SUGARCAST_ACTION',
        `<<${macro.name}>> is not an effect macro and cannot be used in an event body.`,
        base + index,
        base + macro.end,
      );
    for (const node of lowered) effects.push(...node.effects);
    index = result.end;
  }
  return effects;
}
