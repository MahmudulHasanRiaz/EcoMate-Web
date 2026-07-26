import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BackupService } from './backup.service';

describe('uploaded backup SQL scanner', () => {
  const tempRoots: string[] = [];
  const service = new BackupService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const scan = async (contents: string | Buffer) => {
    const root = await mkdtemp(join(tmpdir(), 'ecomate-sql-scan-'));
    tempRoots.push(root);
    const path = join(root, 'dump.sql');
    await writeFile(path, contents);
    await (service as any).assertUploadedSqlIsSafe(path);
  };

  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('accepts a normal pg_dump COPY stream with a very large data row', async () => {
    const largeRow = Buffer.alloc(2 * 1024 * 1024, 0x61);
    await expect(
      scan(
        Buffer.concat([
          Buffer.from(
            '\\restrict token-1\nCREATE TABLE public.items (id text);\nCOPY public.items (id) FROM stdin;\n',
          ),
          largeRow,
          Buffer.from('\n\\.\n\\unrestrict token-1\n'),
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["SELECT 'COPY public.x (id) FROM stdin;';\n\\! touch /tmp/pwned\n"],
    ['SELECT 1 \\g |cat /etc/passwd\n'],
    ["SELECT pg_read_file/**/('/etc/passwd');\n"],
    ["COPY public.x TO '/tmp/out';\n"],
    ["COPY public.x FROM PROGRAM 'id';\n"],
    ['SET ROLE postgres;\n'],
    ['COMMIT; CREATE TABLE public.escaped (id integer);\n'],
    ['ROLLBACK;\nCREATE TABLE public.escaped (id integer);\n'],
    ['SAVEPOINT escape_restore;\n'],
    ['PREPARE TRANSACTION \'escape_restore\';\n'],
    ['RESET ROLE;\n'],
    ['CREATE EXTENSION file_fdw;\n'],
    ['CREATE SCHEMA hidden;\n'],
    [
      'CREATE FUNCTION public.escalate() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;\n',
    ],
  ])('rejects prohibited SQL/psql input %#', async (contents) => {
    await expect(scan(contents)).rejects.toThrow();
  });

  it('rejects a mismatched pg_dump restriction token', async () => {
    await expect(
      scan('\\restrict correct\nSELECT 1;\n\\unrestrict wrong\n'),
    ).rejects.toThrow('mismatched');
  });

  it('rejects a non-COPY line before it can consume unbounded memory', async () => {
    await expect(
      scan(`SELECT '${'a'.repeat(1024 * 1024 + 1)}';\n`),
    ).rejects.toThrow('line larger');
  });
});
