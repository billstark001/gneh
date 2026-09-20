#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TemplateKind = 'vanilla' | 'react' | 'preact' | 'vue';

const frameworkOverlays: Record<Exclude<TemplateKind, 'vanilla'>, URL> = {
  react: new URL('../overlays/react/', import.meta.url),
  preact: new URL('../overlays/preact/', import.meta.url),
  vue: new URL('../overlays/vue/', import.meta.url),
};

function packageName(value: string): string {
  const name = path
    .basename(path.resolve(value))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return name || 'gneh-story';
}

export function createProject(destination: string, template: TemplateKind = 'vanilla'): string {
  const target = path.resolve(destination);
  if (fs.existsSync(target) && fs.readdirSync(target).length)
    throw new Error(`Refusing to overwrite non-empty directory: ${target}`);
  fs.mkdirSync(target, { recursive: true });
  const sourceTemplate = fileURLToPath(new URL('../template/', import.meta.url));
  fs.cpSync(sourceTemplate, target, { recursive: true });
  fs.renameSync(path.join(target, '_gitignore'), path.join(target, '.gitignore'));
  const manifestPath = path.join(target, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    name: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  manifest.name = packageName(destination);
  if (template === 'react') {
    manifest.dependencies.react = '^19.1.0';
    manifest.dependencies['react-dom'] = '^19.1.0';
    manifest.devDependencies['@types/react'] = '^19.1.0';
    manifest.devDependencies['@types/react-dom'] = '^19.1.0';
    manifest.devDependencies['@vitejs/plugin-react'] = '^5.0.0';
  } else if (template === 'preact') {
    manifest.dependencies.preact = '^10.27.0';
    manifest.devDependencies['@preact/preset-vite'] = '^2.10.0';
  } else if (template === 'vue') {
    manifest.dependencies.vue = '^3.5.0';
    manifest.devDependencies['@vitejs/plugin-vue'] = '^6.0.0';
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (template !== 'vanilla') {
    fs.rmSync(path.join(target, 'src/main.ts'));
    fs.rmSync(path.join(target, 'src/ui.ts'));
    fs.cpSync(fileURLToPath(frameworkOverlays[template]), target, { recursive: true });
    if (template === 'react' || template === 'preact') {
      const html = path.join(target, 'index.html');
      fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('/src/main.ts', '/src/main.tsx'));
    }
  }
  return target;
}

function templateFrom(args: string[]): TemplateKind {
  const inline = args.find((argument) => argument.startsWith('--template='))?.slice(11);
  const option = args.indexOf('--template');
  const value = inline ?? (option >= 0 ? args[option + 1] : undefined) ?? 'vanilla';
  if (value === 'vanilla' || value === 'react' || value === 'preact' || value === 'vue') return value;
  throw new Error(`Unknown template ${JSON.stringify(value)}; expected vanilla, react, preact or vue.`);
}

export function main(args = process.argv.slice(2)): void {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'create-gneh [directory] [--template vanilla|react|preact|vue]\n\nCreates an editable Vite application (default: vanilla).',
    );
    return;
  }
  const template = templateFrom(args);
  const option = args.indexOf('--template');
  const destination = args.find(
    (argument, index) => !argument.startsWith('-') && !(option >= 0 && index === option + 1),
  );
  const target = createProject(destination ?? 'gneh-story', template);
  console.log(`Created ${target}\n\n  cd ${path.relative(process.cwd(), target) || '.'}\n  npm install\n  npm run dev`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
