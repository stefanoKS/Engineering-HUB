import openpyxl,json
from pathlib import Path
p=Path("C:/Users/14413/Documents/Engineering-HUB/outputs/monthly-action-20261112")
a=openpyxl.load_workbook(p/'source.xlsx'); b=openpyxl.load_workbook(p/"2026年11月_アクションプラン_発表更新.xlsx")
expected=json.loads((p/'edits.json').read_text(encoding='utf8'))
changes=[]; styles=[]
for s in a:
 t=b[s.title]
 for row in s:
  for c in row:
   d=t[c.coordinate]
   if c.value!=d.value: changes.append((s.title,c.coordinate))
   if c.coordinate not in expected or s.title!=a.worksheets[0].title:
    if c._style!=d._style: styles.append((s.title,c.coordinate))
assert set(changes)=={(a.worksheets[0].title,k) for k in expected}, changes
for k,v in expected.items(): assert b.worksheets[0][k].value.rstrip()==v.rstrip()
print(json.dumps({'changed_cells':changes,'unrelated_style_changes':styles,'sheets':b.sheetnames},ensure_ascii=False))
