from pathlib import Path
import re, json, zipfile
root=Path(__file__).parent/'handbook-deepseek'
missing=[]
for md in root.glob('*.md'):
    text=md.read_text(encoding='utf-8')
    for ref in re.findall(r'!\[[^\]]*\]\(([^)]+)\)',text):
        if not (root/ref).is_file(): missing.append((md.name,ref))
    assert '\ufffd' not in text, f'Invalid Unicode: {md}'
assert not missing,missing
evidence=json.loads((root/'capture-evidence.json').read_text(encoding='utf-8'))
assert len(evidence)==17
assert {x['role'] for x in evidence}=={'MEMBER','MANAGER'}
assert len(list((root/'images').glob('*.png')))==17
archive=root.parent/'Engineering-HUB_DeepSeek_Handbook_Pack_JA.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        if p.is_file(): z.write(p,'handbook-deepseek/'+str(p.relative_to(root)))
print(json.dumps({'images':17,'missing_images':missing,'roles':['MANAGER','MEMBER'],'zip':str(archive),'bytes':archive.stat().st_size},ensure_ascii=False))
