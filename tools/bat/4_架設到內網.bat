@echo off
chcp 65001 >nul
setlocal
title Auto-Fit - Office LAN web (share with colleagues)

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

python tools\dev_server.py --port 8765 --lan --open
if errorlevel 1 (
  echo.
  echo [X] Could not start. Details are in the message above.
  echo     no Python? install 3.10+ from python.org
  echo     port 8765 busy? close the other window and retry
  echo.
  pause & exit /b 1
)
exit /b 0
