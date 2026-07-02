import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getMachineIdPath(): string {
  const dirs = [os.homedir(), '/var/tmp', '/tmp'];
  for (const d of dirs) {
    try {
      fs.accessSync(d, fs.constants.W_OK);
      return path.join(d, '.ecomate-machine-id');
    } catch {}
  }
  return path.join(os.tmpdir(), '.ecomate-machine-id');
}

export function getMachineId(): string {
  const filePath = getMachineIdPath();

  try {
    const existing = fs.readFileSync(filePath, 'utf-8').trim();
    if (existing) return existing;
  } catch {}

  const id = crypto.randomUUID();
  try {
    fs.writeFileSync(filePath, id, 'utf-8');
  } catch {}

  return id;
}
