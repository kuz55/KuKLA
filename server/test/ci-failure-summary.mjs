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
    const stack=lines[j].match(/\((?:file:\/\/)?([^\s()]+\/test\/[\w.-]+\.test\.mjs:\d+:\d+)\)/);
    if (stack && !details.some(detail=>detail.startsWith('testStack='))) details.push(`testStack=${stack[1]}`);
    const error=lines[j].match(/^\s*(?:#\s*)?error:\s*'([^']{1,120})'$/);
    if (error) details.push(`error=${error[1]}`);
    if (/^\s*(?:#\s*)?error:\s*\|[-+]?\s*$/.test(lines[j])) {
      const first=lines.slice(j+1,j+5).map(line=>line.replace(/^\s*#?\s*/,''))
        .find(line=>line.length>0);
      if (first) details.push(`error=${first.slice(0,120)}`);
    }
  }
  console.log(`::error title=Server test failure::${escaped([lines[i],...details].join(' | '))}`);
}
