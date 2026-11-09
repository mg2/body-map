@echo off

REM Start the React/Node app in a new window
start "npm" .\npm.cmd start

REM Wait a few seconds for the server to start
timeout /t 5 /nobreak >nul

REM Open Chrome on the application URL
start chrome http://localhost:3000/