@echo off
setlocal DisableDelayedExpansion
node "%~dp0launcher.mjs" %*
exit /b %ERRORLEVEL%
