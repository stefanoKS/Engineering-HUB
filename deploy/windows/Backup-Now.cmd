@echo off
cd /d "%~dp0..\.."
node --env-file=data/lan/worker.env apps/worker/dist/cli.js backup-now
pause
