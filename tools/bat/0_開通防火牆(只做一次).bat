@echo off
setlocal
title Auto-Fit - Open firewall for LAN test (run once)

rem ============================================================
rem  ASCII ONLY -- do not put Chinese in this file.
rem  cmd.exe mis-seeks in UTF-8 batch files while codepage 65001 is
rem  active and starts running comment text as commands. All Chinese
rem  text lives in the Python scripts. Notes: docs\bat.md
rem ============================================================

rem Adding a firewall rule needs elevation. Re-launch self via UAC.
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if errorlevel 1 (
    echo.
    echo [X] Administrator rights were not granted ^(UAC cancelled^).
    echo     Run this .bat again and click "Yes" in the UAC prompt.
    echo.
    pause
    exit /b 1
  )
  exit /b 0
)

chcp 65001 >nul

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

python tools\open_firewall.py
if errorlevel 1 (
  echo.
  echo [X] Stopped. Details are in the message above.
  echo     no Python? install 3.10+ from python.org
  echo.
  pause & exit /b 1
)

echo.
pause
exit /b 0
