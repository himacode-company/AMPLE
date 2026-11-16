@echo off
rem AMPLE command line. Usage: ample start ^| stop ^| restart ^| status ^| help
rem Uses AMPLE's portable Node.js (control\runtime) if present, else Node.js from PATH.
setlocal
set "AMPLE_NODE=node"
if exist "%~dp0control\runtime\node.exe" set "AMPLE_NODE=%~dp0control\runtime\node.exe"
"%AMPLE_NODE%" "%~dp0control\cli\ample.js" %*
