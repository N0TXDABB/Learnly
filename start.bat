@echo off
rem Learnly for Windows: double-click this file.
setlocal
cd /d "%~dp0"
title Learnly

rem Prefer a Python version that every package has ready-made downloads for.
set "PY="
where py >nul 2>nul && for %%V in (3.13 3.12 3.11 3.10 3.14) do (
  if not defined PY py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
)
if not defined PY set "PY=python"

%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Learnly needs Python 3.10 or newer.
  echo  Download it from https://www.python.org/downloads/
  echo  and tick "Add python.exe to PATH" in the installer, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo  Setting up Learnly for the first time. This takes a minute or two...
  %PY% -m venv .venv
  if errorlevel 1 goto fail
)

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, jwt, cryptography, pypdf" >nul 2>nul
if errorlevel 1 (
  echo  Installing the packages Learnly needs...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 goto fail
)

".venv\Scripts\python.exe" run.py %*
if errorlevel 1 (
  echo.
  echo  Learnly stopped with an error. Read the messages above.
  pause
  exit /b 1
)
exit /b 0

:fail
echo.
%PY% -c "import sys; sys.exit(0 if sys.version_info < (3, 14) else 1)" >nul 2>nul
if errorlevel 1 (
  echo  Your Python is very new, and some packages Learnly needs aren't ready for it yet.
  echo  Install Python 3.13 from https://www.python.org/downloads/ ^(keep your current one if you like^),
  echo  delete the .venv folder inside the Learnly folder, then run this file again.
  echo.
)
echo  Setup didn't finish. Read the messages above, check your internet connection, and try again.
pause
exit /b 1
