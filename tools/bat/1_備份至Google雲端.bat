@echo off
chcp 65001 >nul
setlocal
title Auto-Fit - Backup to Google Drive

rem ============================================================
rem  ASCII ONLY -- do not put Chinese in this file.
rem  cmd.exe mis-seeks in UTF-8 batch files while codepage 65001 is
rem  active and starts running comment text as commands. All Chinese
rem  text lives in the Python scripts. Notes: docs\bat.md
rem ============================================================

call "%~dp0_repo.cmd"
if not defined REPO (
  echo [X] Project folder "*-V2.0" not found next to this .bat
  pause & exit /b 1
)
cd /d "%REPO%"
if errorlevel 1 (
  echo [X] Cannot enter %REPO%
  pause & exit /b 1
)

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

python tools\backup_to_drive.py
if errorlevel 1 (
  echo.
  echo [X] Backup failed. Details are in the message above.
  echo     log: %USERPROFILE%\.autofit\logs\
  echo     no Python? install 3.10+ from python.org
  echo.
  pause & exit /b 1
)

echo.
pause
exit /b 0
