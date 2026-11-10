// Groups biomarkers into body systems, each with its own colour, icon and chart style.
// This is purely about presentation, so it lives in the frontend, not the backend catalog.

export const CATEGORIES = {
  blood:    { label: 'Blood count',  color: '#e5484d', icon: 'drop',   chart: 'bars' },
  sugar:    { label: 'Blood sugar',  color: '#f76b15', icon: 'cube',   chart: 'line' },
  lipids:   { label: 'Heart & lipids', color: '#8e4ec6', icon: 'heart', chart: 'bars' },
  kidney:   { label: 'Kidney',       color: '#d6409f', icon: 'bean',   chart: 'line' },
  liver:    { label: 'Liver',        color: '#30a46c', icon: 'leaf',   chart: 'line' },
  minerals: { label: 'Electrolytes', color: '#12a594', icon: 'spark',  chart: 'bars' },
  thyroid:  { label: 'Thyroid',      color: '#6e56cf', icon: 'bolt',   chart: 'bars' },
  vitamins: { label: 'Vitamins & iron', color: '#d4a20b', icon: 'sun', chart: 'line' },
};

const BY_CODE = {
  blood: ['HGB', 'RBC', 'WBC', 'PLT', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'NEUT', 'LYMPH', 'MONO', 'EOS', 'BASO'],
  sugar: ['GLU_F', 'HBA1C'],
  lipids: ['CHOL', 'LDL', 'HDL', 'VLDL', 'TRIG'],
  kidney: ['CREAT', 'BUN', 'UREA', 'URIC', 'EGFR'],
  liver: ['ALT', 'AST', 'ALP', 'GGT', 'TBIL', 'DBIL', 'ALB', 'TP'],
  minerals: ['NA', 'K', 'CL', 'CA'],
  thyroid: ['TSH', 'FT4', 'FT3'],
  vitamins: ['VITD', 'B12', 'FERR', 'IRON'],
};

const CODE_TO_CATEGORY = Object.fromEntries(
  Object.entries(BY_CODE).flatMap(([cat, codes]) => codes.map((c) => [c, cat])),
);

export const categoryOf = (code) => CODE_TO_CATEGORY[code] ?? 'blood';
