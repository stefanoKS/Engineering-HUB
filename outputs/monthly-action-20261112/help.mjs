import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir="C:/Users/14413/Documents/Engineering-HUB/outputs/monthly-action-20261112";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(dir+'/source.xlsx'));
console.log((await wb.inspect({kind:'sheet',include:'id,name'})).ndjson);
const s=wb.worksheets.getItem('活動実績表 (発表)');
console.log(wb.help('*',{search:'richText|textRuns',include:'index,notes,examples',maxChars:5000}).ndjson);