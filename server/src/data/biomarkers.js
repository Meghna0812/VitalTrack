// The biomarker catalog: the single source of truth for every test VitalTrack understands.
//
// For each biomarker:
//   code      short stable ID we store in the database ("HGB")
//   name      display name
//   unit      the CANONICAL unit – every value is converted to this before storing
//   aliases   the different names labs print for the same test
//   units     every unit we accept -> how to convert it to the canonical unit
//             (a number = multiply by it; a function = custom formula)
//   range     default adult reference range [low, high] in canonical units (null = no bound)
//   plausible values outside this are almost certainly an extraction error, not a real result
//
// Reference ranges are general adult values for demo purposes. When the lab prints
// its own range we use that instead (labs differ, and the report's range wins).

const COUNT_THOUSANDS = { // canonical: 10^3/µL  (same as 10^9/L)
  '10^3/µL': 1, 'x10^3/µL': 1, '10^9/L': 1, 'x10^9/L': 1, 'K/µL': 1, 'thou/µL': 1, 'thou/mm3': 1,
  '/µL': 0.001, 'cells/µL': 0.001, '/cumm': 0.001, 'cells/cumm': 0.001, '/mm3': 0.001,
};
const PERCENT = { '%': 1 };
const ENZYME = { 'U/L': 1, 'IU/L': 1 };
const ELECTROLYTE = { 'mmol/L': 1, 'mEq/L': 1 };
const LIPID = { 'mg/dL': 1, 'mmol/L': 38.67 };
const G_PER_DL = { 'g/dL': 1, 'g/L': 0.1 };

export const BIOMARKERS = [
  // ---- Complete blood count ----
  { code: 'HGB', name: 'Hemoglobin', unit: 'g/dL', aliases: ['hemoglobin', 'haemoglobin', 'hb', 'hgb'],
    units: { ...G_PER_DL, 'mmol/L': 1.611 }, range: [12, 17.5], plausible: [2, 25] },
  { code: 'RBC', name: 'Red Blood Cell Count', unit: '10^6/µL',
    aliases: ['rbc', 'rbc count', 'red blood cell count', 'red blood cells', 'total rbc count', 'erythrocytes', 'erythrocyte count'],
    units: { '10^6/µL': 1, 'x10^6/µL': 1, '10^12/L': 1, 'x10^12/L': 1, 'million/µL': 1, 'million/cumm': 1, 'mill/cumm': 1, 'M/µL': 1 },
    range: [4.0, 6.0], plausible: [0.5, 10] },
  { code: 'WBC', name: 'White Blood Cell Count', unit: '10^3/µL',
    aliases: ['wbc', 'wbc count', 'white blood cell count', 'white blood cells', 'total leucocyte count', 'total leukocyte count', 'tlc', 'leukocytes', 'total wbc count'],
    units: COUNT_THOUSANDS, range: [4.0, 11.0], plausible: [0.1, 200] },
  { code: 'PLT', name: 'Platelet Count', unit: '10^3/µL', aliases: ['platelets', 'platelet count', 'plt', 'thrombocytes'],
    units: { ...COUNT_THOUSANDS, 'lakhs/cumm': 100, 'lakh/cumm': 100, 'lakhs/µL': 100 }, range: [150, 450], plausible: [1, 2000] },
  { code: 'HCT', name: 'Hematocrit', unit: '%', aliases: ['hematocrit', 'haematocrit', 'hct', 'pcv', 'packed cell volume'],
    units: { '%': 1, 'L/L': 100 }, range: [36, 52], plausible: [10, 75] },
  { code: 'MCV', name: 'Mean Corpuscular Volume', unit: 'fL', aliases: ['mcv', 'mean corpuscular volume'],
    units: { fL: 1 }, range: [80, 100], plausible: [40, 150] },
  { code: 'MCH', name: 'Mean Corpuscular Hemoglobin', unit: 'pg', aliases: ['mch', 'mean corpuscular hemoglobin', 'mean corpuscular haemoglobin'],
    units: { pg: 1 }, range: [27, 33], plausible: [10, 50] },
  { code: 'MCHC', name: 'Mean Corpuscular Hemoglobin Concentration', unit: 'g/dL',
    aliases: ['mchc', 'mean corpuscular hemoglobin concentration', 'mean corpuscular haemoglobin concentration'],
    units: G_PER_DL, range: [32, 36], plausible: [20, 45] },
  { code: 'RDW', name: 'Red Cell Distribution Width', unit: '%', aliases: ['rdw', 'rdw-cv', 'rdw cv', 'red cell distribution width'],
    units: PERCENT, range: [11.5, 14.5], plausible: [5, 40] },
  { code: 'NEUT', name: 'Neutrophils', unit: '%', aliases: ['neutrophils', 'neutrophil', 'polymorphs', 'neutrophils %'],
    units: PERCENT, range: [40, 75], plausible: [0, 100] },
  { code: 'LYMPH', name: 'Lymphocytes', unit: '%', aliases: ['lymphocytes', 'lymphocyte', 'lymphocytes %'],
    units: PERCENT, range: [20, 45], plausible: [0, 100] },
  { code: 'MONO', name: 'Monocytes', unit: '%', aliases: ['monocytes', 'monocyte', 'monocytes %'],
    units: PERCENT, range: [2, 10], plausible: [0, 100] },
  { code: 'EOS', name: 'Eosinophils', unit: '%', aliases: ['eosinophils', 'eosinophil', 'eosinophils %'],
    units: PERCENT, range: [1, 6], plausible: [0, 100] },
  { code: 'BASO', name: 'Basophils', unit: '%', aliases: ['basophils', 'basophil', 'basophils %'],
    units: PERCENT, range: [0, 2], plausible: [0, 100] },

  // ---- Diabetes ----
  { code: 'GLU_F', name: 'Fasting Glucose', unit: 'mg/dL',
    aliases: ['fasting glucose', 'glucose fasting', 'fasting blood sugar', 'fbs', 'fasting plasma glucose', 'fpg', 'glucose (fasting)', 'blood sugar fasting', 'plasma glucose fasting'],
    units: { 'mg/dL': 1, 'mmol/L': 18.016 }, range: [70, 99], plausible: [10, 1000] },
  { code: 'HBA1C', name: 'HbA1c', unit: '%',
    aliases: ['hba1c', 'glycated hemoglobin', 'glycosylated hemoglobin', 'glycated haemoglobin', 'glycosylated haemoglobin', 'a1c', 'hemoglobin a1c'],
    // IFCC unit (mmol/mol) -> NGSP % uses a formula, not a simple multiplier
    units: { '%': 1, 'mmol/mol': (v) => 0.09148 * v + 2.152 }, range: [4.0, 5.6], plausible: [2, 20] },

  // ---- Lipid profile ----
  { code: 'CHOL', name: 'Total Cholesterol', unit: 'mg/dL', aliases: ['total cholesterol', 'cholesterol', 'cholesterol total', 'serum cholesterol'],
    units: LIPID, range: [null, 200], plausible: [30, 1000] },
  { code: 'LDL', name: 'LDL Cholesterol', unit: 'mg/dL', aliases: ['ldl', 'ldl cholesterol', 'ldl-c', 'ldl direct', 'low density lipoprotein', 'cholesterol ldl'],
    units: LIPID, range: [null, 100], plausible: [5, 800] },
  { code: 'HDL', name: 'HDL Cholesterol', unit: 'mg/dL', aliases: ['hdl', 'hdl cholesterol', 'hdl-c', 'high density lipoprotein', 'cholesterol hdl'],
    units: LIPID, range: [40, null], plausible: [5, 200] },
  { code: 'VLDL', name: 'VLDL Cholesterol', unit: 'mg/dL', aliases: ['vldl', 'vldl cholesterol', 'very low density lipoprotein'],
    units: LIPID, range: [5, 40], plausible: [1, 500] },
  { code: 'TRIG', name: 'Triglycerides', unit: 'mg/dL', aliases: ['triglycerides', 'triglyceride', 'tg', 'serum triglycerides'],
    units: { 'mg/dL': 1, 'mmol/L': 88.57 }, range: [null, 150], plausible: [10, 5000] },

  // ---- Kidney ----
  { code: 'CREAT', name: 'Creatinine', unit: 'mg/dL', aliases: ['creatinine', 'serum creatinine', 's. creatinine', 'creatinine serum'],
    units: { 'mg/dL': 1, 'µmol/L': 1 / 88.4 }, range: [0.6, 1.3], plausible: [0.1, 20] },
  { code: 'BUN', name: 'Blood Urea Nitrogen', unit: 'mg/dL', aliases: ['bun', 'blood urea nitrogen', 'urea nitrogen'],
    units: { 'mg/dL': 1, 'mmol/L': 2.801 }, range: [7, 20], plausible: [1, 200] },
  { code: 'UREA', name: 'Urea', unit: 'mg/dL', aliases: ['urea', 'blood urea', 'serum urea'],
    units: { 'mg/dL': 1, 'mmol/L': 6.006 }, range: [15, 45], plausible: [2, 400] },
  { code: 'URIC', name: 'Uric Acid', unit: 'mg/dL', aliases: ['uric acid', 'serum uric acid'],
    units: { 'mg/dL': 1, 'µmol/L': 1 / 59.48 }, range: [3.5, 7.2], plausible: [0.5, 25] },
  { code: 'EGFR', name: 'eGFR', unit: 'mL/min/1.73m²', aliases: ['egfr', 'estimated gfr', 'estimated glomerular filtration rate'],
    units: { 'mL/min/1.73m²': 1, 'mL/min/1.73m2': 1, 'mL/min': 1 }, range: [90, null], plausible: [1, 200] },

  // ---- Electrolytes ----
  { code: 'NA', name: 'Sodium', unit: 'mmol/L', aliases: ['sodium', 'na', 'na+', 'serum sodium'], units: ELECTROLYTE, range: [135, 145], plausible: [90, 200] },
  { code: 'K', name: 'Potassium', unit: 'mmol/L', aliases: ['potassium', 'k', 'k+', 'serum potassium'], units: ELECTROLYTE, range: [3.5, 5.1], plausible: [1, 10] },
  { code: 'CL', name: 'Chloride', unit: 'mmol/L', aliases: ['chloride', 'cl', 'cl-', 'serum chloride'], units: ELECTROLYTE, range: [98, 107], plausible: [60, 150] },
  { code: 'CA', name: 'Calcium', unit: 'mg/dL', aliases: ['calcium', 'ca', 'serum calcium', 'total calcium'],
    units: { 'mg/dL': 1, 'mmol/L': 4.008 }, range: [8.5, 10.5], plausible: [3, 20] },

  // ---- Liver ----
  { code: 'ALT', name: 'ALT (SGPT)', unit: 'U/L', aliases: ['alt', 'sgpt', 'alanine aminotransferase', 'alanine transaminase', 'alt (sgpt)', 'sgpt (alt)'],
    units: ENZYME, range: [7, 56], plausible: [1, 10000] },
  { code: 'AST', name: 'AST (SGOT)', unit: 'U/L', aliases: ['ast', 'sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'ast (sgot)', 'sgot (ast)'],
    units: ENZYME, range: [10, 40], plausible: [1, 10000] },
  { code: 'ALP', name: 'Alkaline Phosphatase', unit: 'U/L', aliases: ['alp', 'alkaline phosphatase'], units: ENZYME, range: [44, 147], plausible: [5, 5000] },
  { code: 'GGT', name: 'Gamma GT', unit: 'U/L', aliases: ['ggt', 'gamma gt', 'gamma glutamyl transferase', 'ggtp'], units: ENZYME, range: [8, 61], plausible: [1, 5000] },
  { code: 'TBIL', name: 'Total Bilirubin', unit: 'mg/dL', aliases: ['total bilirubin', 'bilirubin total', 'bilirubin', 'serum bilirubin total'],
    units: { 'mg/dL': 1, 'µmol/L': 1 / 17.104 }, range: [0.2, 1.2], plausible: [0.01, 50] },
  { code: 'DBIL', name: 'Direct Bilirubin', unit: 'mg/dL', aliases: ['direct bilirubin', 'bilirubin direct', 'conjugated bilirubin'],
    units: { 'mg/dL': 1, 'µmol/L': 1 / 17.104 }, range: [0, 0.3], plausible: [0, 40] },
  { code: 'ALB', name: 'Albumin', unit: 'g/dL', aliases: ['albumin', 'serum albumin'], units: G_PER_DL, range: [3.5, 5.0], plausible: [0.5, 8] },
  { code: 'TP', name: 'Total Protein', unit: 'g/dL', aliases: ['total protein', 'protein total', 'serum total protein'], units: G_PER_DL, range: [6.0, 8.3], plausible: [1, 15] },

  // ---- Thyroid ----
  { code: 'TSH', name: 'TSH', unit: 'µIU/mL', aliases: ['tsh', 'thyroid stimulating hormone', 'tsh ultrasensitive', 'tsh 3rd generation'],
    units: { 'µIU/mL': 1, 'mIU/L': 1, 'mU/L': 1, 'uIU/mL': 1 }, range: [0.4, 4.0], plausible: [0.001, 200] },
  { code: 'FT4', name: 'Free T4', unit: 'ng/dL', aliases: ['free t4', 'ft4', 'free thyroxine', 't4 free'],
    units: { 'ng/dL': 1, 'pmol/L': 1 / 12.871 }, range: [0.8, 1.8], plausible: [0.05, 10] },
  { code: 'FT3', name: 'Free T3', unit: 'pg/mL', aliases: ['free t3', 'ft3', 'free triiodothyronine', 't3 free'],
    units: { 'pg/mL': 1, 'pmol/L': 0.651 }, range: [2.3, 4.2], plausible: [0.1, 30] },

  // ---- Vitamins & iron ----
  { code: 'VITD', name: 'Vitamin D (25-OH)', unit: 'ng/mL',
    aliases: ['vitamin d', 'vitamin d3', '25-oh vitamin d', '25 hydroxy vitamin d', 'vitamin d (25-oh)', 'vitamin d total', '25(oh)d'],
    units: { 'ng/mL': 1, 'nmol/L': 0.4006 }, range: [30, 100], plausible: [1, 300] },
  { code: 'B12', name: 'Vitamin B12', unit: 'pg/mL', aliases: ['vitamin b12', 'b12', 'cobalamin', 'cyanocobalamin'],
    units: { 'pg/mL': 1, 'pmol/L': 1.355 }, range: [200, 900], plausible: [20, 5000] },
  { code: 'FERR', name: 'Ferritin', unit: 'ng/mL', aliases: ['ferritin', 'serum ferritin'],
    units: { 'ng/mL': 1, 'µg/L': 1 }, range: [30, 400], plausible: [1, 10000] },
  { code: 'IRON', name: 'Serum Iron', unit: 'µg/dL', aliases: ['iron', 'serum iron'],
    units: { 'µg/dL': 1, 'µmol/L': 5.585 }, range: [60, 170], plausible: [5, 1000] },
];
