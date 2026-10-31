/**
 * Generates the V2 dictionary from the tested V1 translation source.
 *
 * `shared/i18n.js` is the V1 single source of truth for 1,100+ interface strings and their
 * Japanese/English pairs. V2 reuses it rather than retyping translations: this script evaluates
 * the file in an isolated context and writes a JSON dictionary plus a parity report. Nothing is
 * translated at runtime, and stored text is never part of the dictionary.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'shared', 'i18n.js');
const outputPath = path.join(root, 'packages', 'i18n', 'src', 'dictionary.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = { Object, Array, String, Number, console };
vm.createContext(sandbox);
vm.runInContext(`${source}\n;globalThis.__EH_I18N__ = EH_I18N;`, sandbox, { filename: 'shared/i18n.js' });
const i18n = sandbox.__EH_I18N__;
if (!i18n || !i18n.DICTIONARY || !i18n.DICTIONARY.ja || !i18n.DICTIONARY.en) {
  throw new Error('shared/i18n.js did not expose a ja/en dictionary');
}

const dictionary = { ja: i18n.DICTIONARY.ja, en: i18n.DICTIONARY.en };
fs.writeFileSync(outputPath, `${JSON.stringify(dictionary, null, 0)}\n`, 'utf8');

const jaKeys = Object.keys(dictionary.ja);
const enKeys = Object.keys(dictionary.en);
const missingEn = jaKeys.filter((key) => !(key in dictionary.en));
const extraEn = enKeys.filter((key) => !(key in dictionary.ja));

process.stdout.write(
  `dictionary: ${jaKeys.length} ja keys, ${enKeys.length} en keys, ${missingEn.length} missing en, ${extraEn.length} extra en\n`
);
if (missingEn.length) {
  process.stdout.write(`missing: ${missingEn.slice(0, 20).join(', ')}\n`);
  process.exitCode = 1;
}
