@echo off
rem AMPLE first-time setup: double-click this file. Works on a fresh Windows 10/11 PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0control\tools\bootstrap.ps1" %*
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the message above, then run setup.cmd again.
)
if "%~1"=="" pause
