$ErrorActionPreference='Stop'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
$excel.AutomationSecurity=3
try {
$book=$excel.Workbooks.Open('C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112/source.xls',0,$true)
$names=@(); foreach($s in $book.Worksheets){$names+=$s.Name}; $names|ConvertTo-Json | Set-Content -Encoding UTF8 'C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112/sheets.json'
$s=$book.Worksheets.Item(1)
$cells=@(); foreach($c in $s.UsedRange.Cells){if($null -ne $c.Value2){$cells+=@{cell=$c.Address();text=$c.Text;formula=$c.Formula}}}; $cells|ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 'C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112/source-cells.json'
$book.SaveAs('C:\Users\14413\Documents\Engineering-HUB\outputs\monthly-action-20261112/source.xlsx',51)
$book.Close($false)
} finally {$excel.Quit()}