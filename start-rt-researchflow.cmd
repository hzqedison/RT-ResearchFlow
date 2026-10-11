@echo off
setlocal
set "APP=%~dp0..\RT-ResearchFlow-App\RT-ResearchFlow.exe"
if not exist "%APP%" (
  echo RT-ResearchFlow is not installed next to this source folder.
  pause
  exit /b 1
)
start "" "%APP%"
