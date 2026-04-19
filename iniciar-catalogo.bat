@echo off
setlocal
cd /d "%~dp0"

echo Liberando puerto 7788...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":7788 "') do (
  taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 >nul

echo Iniciando servidor desde: %~dp0
start "Catalogo Mayorista · Servidor" cmd /k "node server-catalogo.js"
timeout /t 2 >nul

echo Abriendo catalogo-mayorista.html...
start "" "http://localhost:7788"
endlocal
