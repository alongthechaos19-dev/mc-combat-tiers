@echo off
cd /d "%~dp0discord-sync"
echo Syncing tiers from Discord...
echo.
node sync.js
echo.
pause
