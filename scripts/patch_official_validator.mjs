import fs from 'node:fs';

const file = 'scripts/bootstrap_remaining.ts';
const src = fs.readFileSync(file, 'utf8');

const oldBlock = `async function validateAndPromoteTrafficPolicy(pool: any, html: string, rawSource: AnyRecord) {
  const compact = html.replace(/\\s+/g, '');
  const signals = {
    title: compact.includes('关于实施钟山风景名胜区交通优化提升措施的通告'),
    weekday: compact.includes('工作日9：00-17：00') || compact.includes('工作日9:00-17:00'),
    weekend: compact.includes('节假日、双休日8：30-17：30') || compact.includes('节假日、双休日8:30-17:30'),
    reservation: compact.includes('提前1天') && compact.includes('每个自然月内最多可以申领2次'),
    validity: compact.includes('有效期至2028年9月30日')
  };
`;

const newBlock = `async function validateAndPromoteTrafficPolicy(pool: any, html: string, rawSource: AnyRecord) {
  const decodeEntities = (value: string) => value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(nbsp|ensp|emsp|thinsp);/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  const compact = decodeEntities(
    html
      .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .normalize('NFKC')
    .replace(/\\s+/g, '');

  const signals = {
    title: compact.includes('关于实施钟山风景名胜区交通优化提升措施的通告'),
    weekday: /工作日9:00[-—–~～至]17:00/.test(compact),
    weekend: /节假日[、,，]?双休日8:30[-—–~～至]17:30/.test(compact),
    reservation:
      compact.includes('提前1天') &&
      compact.includes('每辆车每个自然月内最多可以申领2次'),
    validity:
      compact.includes('本通告自2025年10月1日起施行') &&
      compact.includes('有效期至2028年9月30日')
  };
`;

if (src.includes(newBlock)) {
  console.log('Official validator already patched.');
  process.exit(0);
}

if (!src.includes(oldBlock)) {
  console.error('Expected validator block not found; refusing unsafe edit.');
  process.exit(2);
}

fs.writeFileSync(file, src.replace(oldBlock, newBlock));
console.log('Official validator patched: HTML -> normalized text -> deterministic signals.');
