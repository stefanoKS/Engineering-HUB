@echo off
cd /d "%~dp0..\.."
echo Apply reviewed additive migrations. For an existing database, verify a backup FIRST.
set /p EH_CONFIRM=Type APPLY MIGRATIONS to continue: 
if not "%EH_CONFIRM%"=="APPLY MIGRATIONS" exit /b 1
node --env-file=data/lan/api.env apps/api/dist/migrate.js
pause
