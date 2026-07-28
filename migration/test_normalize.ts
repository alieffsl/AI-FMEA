import { normalizeToolDescription } from './normalizeToolDescription.ts';

const testCases: Array<[string, string]> = [
  ['JJB33-001-torso-ft', 'Torso FT'],
  ['Snake-Body', 'Snake Body'],
  ['Snake Body LT', 'Snake Body LT'],
  ['SNAKE_BODY.FT', 'Snake Body FT'],
  ['accessories', 'Accessory'],
  ['accessory', 'Accessory'],
  ['FP21009-TORSO FT', 'Fp21009 Torso FT'],
  ['torso', 'Torso'],
  ['Dog Body LT', 'Dog Body LT'],
  ['1f', '1f'],
  ['arch', 'Arch'],
  ['arches', 'Arch'],
  ['bracelet', 'Bracelet'],
  ['bracelets', 'Bracelet'],
];

console.log('Tool Description Normalization Tests\n');
let passed = 0;
let failed = 0;

for (const [input, expected] of testCases) {
  const actual = normalizeToolDescription(input);
  if (actual === expected) {
    console.log(`  ✓ "${input}" → "${actual}"`);
    passed += 1;
  } else {
    console.log(`  ✗ "${input}": expected "${expected}", got "${actual}"`);
    failed += 1;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
