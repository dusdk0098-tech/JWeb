@echo off
rem YWeb: turn the server's start at Windows sign-in on or off (a shortcut in this user's Startup folder). See README.md.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart-windows.ps1" %*
