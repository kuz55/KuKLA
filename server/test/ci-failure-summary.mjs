// Summarize failed TAP subtests as GitHub annotations when runner logs are
// inaccessible. Tests must use synthetic data; do not print full payloads.
import { readFileSync } from 'node:fs';

const lines=readFileSync(process.argv[2],'utf8').split(/\r?\n/);
const escaped=value=>value.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
for (let i=0;i<lines.length;i++) {
  if (!/^not ok \d+ - /.test(lines[i])) continue;
  const details=[];
  for (let j=i+1;j<Math.min(i+35,lines.length) && !/^\s*\.\.\.$/.test(lines[j]);j++) {
    const match=lines[j].match(/^\s*(?:#\s*)?(location|failureType|expected|actual):\s*(.{1,120})$/);
    if (match) details.push(`${match[1]}=${match[2]}`);
  }
  console.log(`::error title=Server test failure::${escaped([lines[i],...details].join(' | '))}`);
}
