@echo off
rem Upload this version of the body map to GitHub. Double-click, or run "deploy --dry-run" to only see what would change.
cd /d "%~dp0"
node tools\deploy.mjs %*
set ERR=%ERRORLEVEL%
echo.
pause
exit /b %ERR%
