import { describe, expect, it } from 'vitest';
import {
  applyRule,
  dropMissingExternalParents,
  interpretFreeform,
  parseDelimitedText,
  validateRule,
} from '../../main/services/orbit/orbitImport';
import { isRenameAllowed, slugForOrganization } from '../../main/services/orbit/orbitAccess';

const accountedRows = (interpretation: ReturnType<typeof applyRule>) =>
  [...interpretation.usedLines, ...interpretation.ignored.map(entry => entry.row)].sort((a, b) => a - b);

describe('ORBIT import - parseDelimitedText', () => {
  it('detects commas and keeps quoted cells together', () => {
    const table = parseDelimitedText('ruta,email\n"ACME, S.L./Ventas",ana@x.com\nACME/IT,bob@x.com\n');

    expect(table.delimiter).toBe(',');
    expect(table.columnCount).toBe(2);
    expect(table.records.map(record => record.cells)).toEqual([
      ['ruta', 'email'],
      ['ACME, S.L./Ventas', 'ana@x.com'],
      ['ACME/IT', 'bob@x.com'],
    ]);
  });

  it('detects semicolons and tabs, strips a BOM and skips blank lines keeping line numbers', () => {
    const semicolons = parseDelimitedText('﻿empresa;area\n\nACME;Ventas\n');
    expect(semicolons.delimiter).toBe(';');
    expect(semicolons.records.map(record => record.line)).toEqual([1, 3]);
    expect(semicolons.records[0].cells[0]).toBe('empresa');

    const tabs = parseDelimitedText('a\tb\tc\n1\t2\t3');
    expect(tabs.delimiter).toBe('\t');
  });

  it('treats text without a consistent delimiter as one column per line', () => {
    const table = parseDelimitedText('Tecnología\nIT (dentro de Tecnología)\nVentas');
    expect(table.delimiter).toBeNull();
    expect(table.records).toHaveLength(3);
    expect(table.records[1].cells).toEqual(['IT (dentro de Tecnología)']);
  });

  it('reads a quoted cell that spans several lines as a single record', () => {
    const table = parseDelimitedText('name,description\nVentas,"First line\nsecond line"\nIT,Tech');
    expect(table.records).toHaveLength(3);
    expect(table.records[1].cells[1]).toBe('First line\nsecond line');
    expect(table.records[2].line).toBe(4);
  });
});

describe('ORBIT import - applyRule', () => {
  it('builds a tree from a path column and attaches members to the last level', () => {
    const table = parseDelimitedText(
      'ruta,email,rol\nACME/Ventas/Norte,ana@x.com,jefe\nACME/Ventas/Sur,bob@x.com,\nACME/IT,,\n,carol@x.com,empleado\n'
    );
    const result = applyRule(table, {
      hasHeader: true,
      structure: 'path',
      pathColumn: 0,
      pathSeparator: '/',
      memberColumn: 1,
      roleColumn: 2,
      roleMapping: { jefe: 'ADMIN', empleado: 'MEMBER' },
      defaultRole: 'MEMBER',
    });

    expect(result.nodes.map(node => node.key)).toEqual([
      'acme',
      'acme/ventas',
      'acme/ventas/norte',
      'acme/ventas/sur',
      'acme/it',
    ]);
    expect(result.nodes.find(node => node.key === 'acme/ventas/norte')?.parentKey).toBe('acme/ventas');
    expect(result.members).toEqual([
      { orgKey: 'acme/ventas/norte', identifier: 'ana@x.com', role: 'ADMIN', line: 2 },
      { orgKey: 'acme/ventas/sur', identifier: 'bob@x.com', role: 'MEMBER', line: 3 },
    ]);
    expect(result.ignored).toEqual([{ row: 5, reason: 'No organization is given for carol@x.com' }]);
    // No row lost: every data row is either used or ignored with a reason.
    expect(accountedRows(result)).toEqual([2, 3, 4, 5]);
  });

  it('builds a tree from one column per level, skipping empty levels', () => {
    const table = parseDelimitedText('empresa;área;equipo\nACME;Tecnología;IT\nACME;Tecnología;\nACME;Ventas;Norte');
    const result = applyRule(table, { hasHeader: true, structure: 'levels', levelColumns: [0, 1, 2] });

    expect(result.nodes.map(node => node.displayName)).toEqual(['ACME', 'Tecnología', 'IT', 'Ventas', 'Norte']);
    expect(result.ignored).toEqual([]);
    expect(accountedRows(result)).toEqual([2, 3, 4]);
  });

  it('builds a tree from child → parent rows, in any order', () => {
    const table = parseDelimitedText('org,padre\nNorte,Ventas\nVentas,ACME\nACME,\n');
    const result = applyRule(table, { hasHeader: true, structure: 'parent', nameColumn: 0, parentColumn: 1 });

    const byKey = new Map(result.nodes.map(node => [node.key, node]));
    expect(byKey.get('acme')?.parentKey).toBeNull();
    expect(byKey.get('ventas')?.parentKey).toBe('acme');
    expect(byKey.get('norte')?.parentKey).toBe('ventas');
    expect(result.externalParents.size).toBe(0);
    expect(result.ignored).toEqual([]);
  });

  it('drops organizations on a cycle and everything hanging from them, with the reason', () => {
    const table = parseDelimitedText('org,padre\nA,B\nB,A\nC,A\nD,\n');
    const result = applyRule(table, { hasHeader: true, structure: 'parent', nameColumn: 0, parentColumn: 1 });

    expect(result.nodes.map(node => node.key)).toEqual(['d']);
    expect(result.ignored.map(entry => entry.row)).toEqual([2, 3, 4]);
    expect(result.ignored[0].reason).toMatch(/cycle/);
    expect(result.ignored[2].reason).toMatch(/left out/);
    expect(accountedRows(result)).toEqual([2, 3, 4, 5]);
  });

  it('keeps the first parent of an organization and reports a contradicting row', () => {
    const table = parseDelimitedText('org,padre\nIT,Tecnología\nIT,Ventas\nTecnología,\nVentas,\n');
    const result = applyRule(table, { hasHeader: true, structure: 'parent', nameColumn: 0, parentColumn: 1 });

    expect(result.nodes.find(node => node.key === 'it')?.parentKey).toBe('tecnologia');
    expect(result.ignored).toEqual([{ row: 3, reason: '"IT" was already placed under "Tecnología" by an earlier row' }]);
  });

  it('reports parents that are neither rows of the file nor existing organizations', () => {
    const table = parseDelimitedText('org,padre,email\nNorte,Ventas,ana@x.com\nSur,Ventas,\nIT,Tecnología,\nTecnología,,\n');
    const initial = applyRule(table, {
      hasHeader: true,
      structure: 'parent',
      nameColumn: 0,
      parentColumn: 1,
      memberColumn: 2,
    });
    expect([...initial.externalParents.values()]).toEqual(['Ventas']);

    const result = dropMissingExternalParents(initial, new Map([['ventas', 'Ventas']]));
    expect(result.nodes.map(node => node.key).sort()).toEqual(['it', 'tecnologia']);
    expect(result.members).toEqual([]);
    expect(result.ignored.map(entry => entry.row)).toEqual([2, 3]);
    expect(result.ignored[0].reason).toMatch(/neither in the file nor an existing organization/);
  });

  it('reads people with their group and maps roles, never to OWNER', () => {
    const table = parseDelimitedText('email,grupo,cargo\nana@x.com,IT,jefe\nbob@x.com,IT,owner\ncarol@x.com,Ventas,becario\n');
    const result = applyRule(table, {
      hasHeader: true,
      structure: 'members_only',
      memberColumn: 0,
      memberOrgColumn: 1,
      roleColumn: 2,
      roleMapping: { jefe: 'ADMIN' },
      defaultRole: 'MEMBER',
    });

    expect(result.nodes.map(node => node.displayName)).toEqual(['IT', 'Ventas']);
    expect(result.members.map(member => member.role)).toEqual(['ADMIN', 'ADMIN', 'MEMBER']);
    expect(result.notes.join(' ')).toMatch(/second owner/);
    expect(result.notes.join(' ')).toMatch(/unknown role "becario"/);
  });
});

describe('ORBIT import - interpretFreeform', () => {
  it('turns the lines the model read into a tree and reports the ones it skipped', () => {
    const result = interpretFreeform(
      [1, 2, 3, 4],
      [
        { line: 1, action: 'use', path: ['Tecnología'] },
        { line: 2, action: 'use', path: ['Tecnología', 'IT'], member: 'ana@x.com', role: 'ADMIN' },
        { line: 3, action: 'ignore', reason: 'Comment' },
        { line: 99, action: 'use', path: ['Invented'] },
      ]
    );

    expect(result.nodes.map(node => node.key)).toEqual(['tecnologia', 'tecnologia/it']);
    expect(result.members).toEqual([{ orgKey: 'tecnologia/it', identifier: 'ana@x.com', role: 'ADMIN', line: 2 }]);
    expect(result.ignored).toEqual([
      { row: 3, reason: 'Comment' },
      { row: 4, reason: 'The interpretation did not use this row' },
    ]);
  });
});

describe('ORBIT import - validateRule', () => {
  it('rejects rules that point at columns the file does not have', () => {
    expect(validateRule({ hasHeader: true, structure: 'path', pathColumn: 3, pathSeparator: '/' }, 2)).toEqual([
      '"pathColumn" must be a column index between 0 and 1.',
    ]);
    expect(validateRule({ hasHeader: true, structure: 'parent', nameColumn: 0 }, 2)).toEqual([
      '"parentColumn" is required for structure "parent".',
    ]);
    expect(validateRule({ hasHeader: true, structure: 'freeform' }, 1)).toEqual([]);
    expect(validateRule({ hasHeader: true, structure: 'levels', levelColumns: [0, 1], defaultRole: 'OWNER' }, 2)).toEqual([
      '"defaultRole" must be ADMIN or MEMBER.',
    ]);
  });
});

describe('ORBIT - organization slugs', () => {
  it('derives a slug the create endpoint accepts', () => {
    expect(slugForOrganization('Tecnología')).toBe('tecnologia');
    expect(slugForOrganization('Ventas Norte')).toBe('ventas-norte');
    expect(slugForOrganization('IT')).toBe('it-org');
    expect(slugForOrganization('研究')).toBe('organization');
    expect(slugForOrganization('A'.repeat(80)).length).toBeLessThanOrEqual(38);
  });

  it('knows which renames the update endpoint would refuse', () => {
    expect(isRenameAllowed('IT')).toBe(false);
    expect(isRenameAllowed('Infra')).toBe(true);
  });
});
