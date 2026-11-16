@echo off
setlocal DisableDelayedExpansion
"C:\Program Files\Git\bin\bash.exe" --login "%~dp0Strata-Panel.sh" %*
exit /b %ERRORLEVEL%
