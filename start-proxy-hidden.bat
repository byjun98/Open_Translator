@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-openai-oauth-hidden.ps1" -StopDuplicatePorts
