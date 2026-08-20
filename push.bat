@echo off
REM Auto add + commit + push for rooc-guild-manager.
REM Usage: double-click this file, or run `push.bat "your commit message"`
REM        from a terminal in this same folder. If you don't pass a
REM        message, it'll ask you for one.

cd /d "%~dp0"

git add -A

if "%~1"=="" (
    set /p MSG="Commit message: "
) else (
    set "MSG=%~1"
)

if "%MSG%"=="" (
    echo No commit message entered - aborting.
    pause
    exit /b 1
)

git commit -m "%MSG%"
if errorlevel 1 (
    echo.
    echo Nothing to commit, or commit failed - skipping push.
    pause
    exit /b 0
)

git push

echo.
echo Done.
pause
