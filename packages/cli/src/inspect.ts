import { parseSource } from '@gneh/compiler';
import { karlowe } from '@gneh/karlowe';
import { sugarcast } from '@gneh/sugarcast';
import { inkdown } from '@gneh/inkdown';
import { splitPassages } from '@gneh/source';
import type { Project } from './project.js';

export type InspectionLevel = 'container' | 'syntax' | 'ir';

function selected<T extends { id?: string; name?: string }>(items: T[], passage?: string): T[] {
  return passage ? items.filter((item) => item.id === passage) : items;
}

function requirePassage(found: number, passage?: string): void {
  if (passage && !found) throw new Error(`Passage not found: ${passage}`);
}

/** Produce versioned public records rather than frontend-private lexer tokens. */
export function inspectProject(project: Project, level: InspectionLevel, passage?: string): unknown {
  if (level === 'container') {
    const sources = project.sources.map((source) => {
      const parsed = splitPassages(source.source, source.path);
      return {
        path: source.path,
        metadata: parsed.metadata,
        passages: selected(parsed.passages, passage),
        diagnostics: parsed.diagnostics,
      };
    });
    requirePassage(
      sources.reduce((total, source) => total + source.passages.length, 0),
      passage,
    );
    return { schema: 'gneh.inspect/v1', level, sources };
  }
  if (level === 'syntax') {
    const sources = project.sources.map((source) => {
      const parsed = parseSource(source.source, source.path, source.dialect, {
        dialects: [inkdown(), karlowe(), sugarcast()],
      });
      return {
        path: source.path,
        passages: selected(parsed.passages, passage),
        diagnostics: parsed.diagnostics,
      };
    });
    requirePassage(
      sources.reduce((total, source) => total + source.passages.length, 0),
      passage,
    );
    return { schema: 'gneh.inspect/v1', level, sources };
  }
  const passages = selected(project.result.story.passages, passage);
  requirePassage(passages.length, passage);
  return {
    schema: 'gneh.inspect/v1',
    level,
    story: {
      ...project.result.story,
      passages,
    },
    diagnostics: project.result.diagnostics,
  };
}
