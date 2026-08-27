import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN_NAMES = [
  'identity',
  'property',
  'booking',
  'contract',
  'billing',
  'payment',
  'audit',
  'maintenance',
  'notification',
  'media',
] as const;

function TypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return TypeScriptFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('domain architecture boundaries', () => {
  it.each(DOMAIN_NAMES)('%s does not import another domain implementation', (domain) => {
    const sourceRoot = join(process.cwd(), 'libs', domain, 'src');
    const violations = TypeScriptFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return DOMAIN_NAMES.filter(
        (candidate) => candidate !== domain && source.includes(`@platform/${candidate}`),
      ).map((candidate) => `${file} imports @platform/${candidate}`);
    });

    expect(violations).toEqual([]);
  });
});
