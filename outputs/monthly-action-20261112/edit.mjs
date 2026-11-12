import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir="C:/Users/14413/Documents/Engineering-HUB/outputs/monthly-action-20261112";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(dir+'/source.xlsx'));
console.log((await wb.inspect({kind:'sheet',include:'id,name'})).ndjson);
const s=wb.worksheets.getItem('活動実績表 (発表)');
const edits=JSON.parse(await fs.readFile(dir+'/edits.json','utf8')); for(const [a,v] of Object.entries(edits)){s.getRange(a).values=[[v]];} wb.recalculate(); console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!',options:{useRegex:true,maxResults:10}})).ndjson); await (await SpreadsheetFile.exportXlsx(wb)).save(dir+'/authored.xlsx');