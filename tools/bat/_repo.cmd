@echo off
rem ASCII only. Sets REPO to the "*-V2.0" project folder next to this file.
rem The folder name contains Chinese, so it is discovered at run time
rem instead of being written into the .bat (see docs\bat.md).
set "REPO="
for /d %%D in ("%~dp0*-V2.0") do set "REPO=%%~fD"
exit /b 0
