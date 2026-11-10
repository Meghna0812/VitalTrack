import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBiomarker, normalizeResult, unitKey } from '../src/services/normalize.js';
import { BIOMARKERS } from '../src/data/biomarkers.js';

test('catalog has 35+ biomarkers', () => {
  assert.ok(BIOMARKERS.length >= 35);
});

test('different lab names map to the same biomarker', () => {
  const cases = {
    HGB: ['Haemoglobin', 'Hb', 'Hemoglobin (Hb)', 'HGB'],
    ALT: ['SGPT', 'SGPT (ALT)', 'Alanine Aminotransferase'],
    GLU_F: ['Glucose (Fasting)', 'Fasting Plasma Glucose', 'FBS'],
    CREAT: ['Serum Creatinine', 'S. Creatinine', 'Creatinine'],
    CHOL: ['Cholesterol, Total', 'Total Cholesterol'],
    VITD: ['Vitamin D (25-OH)', '25(OH)D'],
  };
  for (const [code, names] of Object.entries(cases)) {
    for (const n of names) assert.equal(findBiomarker(n)?.code, code, n);
  }
});

test('unknown names are NOT guessed', () => {
  assert.equal(findBiomarker('Absolute Neutrophil Count'), null);
  assert.equal(findBiomarker('Lipoprotein (a)'), null);
});

test('unit spellings collapse to one key', () => {
  assert.equal(unitKey('x10^3/µL'), unitKey('10³/uL'));
  assert.equal(unitKey('gm/dL'), unitKey('g/dl'));
});

test('unit conversion to canonical units', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);
  near(normalizeResult({ name: 'Hb', value: 138, unit: 'g/L' }).value, 13.8);
  near(normalizeResult({ name: 'FBS', value: 5.1, unit: 'mmol/L' }).value, 91.88);
  near(normalizeResult({ name: 'Creatinine', value: 84, unit: 'µmol/L' }).value, 0.95);
  near(normalizeResult({ name: 'Platelet Count', value: 2.6, unit: 'lakhs/cumm' }).value, 260);
  near(normalizeResult({ name: 'TLC', value: 7800, unit: '/cumm' }).value, 7.8);
  near(normalizeResult({ name: 'HbA1c', value: 35, unit: 'mmol/mol' }).value, 5.35);
});

test('lab reference range is converted too and used for the flag', () => {
  const r = normalizeResult({ name: 'LDL-C', value: 3.1, unit: 'mmol/L', refLow: null, refHigh: 3.4 });
  assert.equal(r.unit, 'mg/dL');
  assert.ok(Math.abs(r.refHigh - 131.48) < 0.01);
  assert.equal(r.flag, 'normal');
});

test('problems produce review reasons instead of silent errors', () => {
  assert.match(normalizeResult({ name: 'Hb', value: 14, unit: 'furlongs' }).reasons[0], /cannot be converted/);
  assert.match(normalizeResult({ name: 'Hb', value: 14, unit: null }).reasons[0], /no unit printed/);
  assert.match(normalizeResult({ name: 'Hb', value: 140, unit: 'g/dL' }).reasons[0], /plausible/); // g/L mislabelled
  assert.deepEqual(normalizeResult({ name: 'Hb', value: 14, unit: 'g/dL' }).reasons, []);
});
