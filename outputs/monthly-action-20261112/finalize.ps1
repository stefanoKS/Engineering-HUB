$ErrorActionPreference='Stop'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
$excel.AutomationSecurity=3
try {
$book=$excel.Workbooks.Open('C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112\source.xlsx',0,$true)
$auth=$excel.Workbooks.Open('C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112\authored.xlsx',0,$true)
$s=$book.Worksheets.Item(1)
$a=$auth.Worksheets.Item(1)
$edits=Get-Content -Raw -Encoding UTF8 'C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112\edits.json'|ConvertFrom-Json
foreach($prop in $edits.PSObject.Properties){
$c=$s.Range($prop.Name)
$old=[string]$c.Value2
$new=[string]$a.Range($prop.Name).Value2
$oldLines=$old.Split([char]10)
$c.Value2=$new
$c.Font.Color=0
$pos=1
foreach($line in $new.Split([char]10)) {if($line.Length -gt 0 -and $oldLines -cnotcontains $line){$c.Characters($pos,$line.Length).Font.Color=255}; $pos+=$line.Length+1}
}
$auth.Close($false)
$excel.Calculate()
$book.SaveAs('C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112\2026年11月_アクションプラン_発表更新.xlsx',51)
$s.ExportAsFixedFormat(0,'C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112\review.pdf')
$book.Close($false)
} finally {$excel.Quit()}