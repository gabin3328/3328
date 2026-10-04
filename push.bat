@echo off
chcp 65001 >nul
title 推送代碼至 GitHub: gabin3328/3328

echo ===================================================================
echo   正在推送 CYBERPUMP 5M 至 GitHub (gabin3328/3328)
echo ===================================================================
echo.

set "GIT_CMD=C:\Users\jimmy\AppData\Local\Programs\MinGit\cmd\git.exe"
if not exist "%GIT_CMD%" set "GIT_CMD=git"

echo 執行遠端推送...
"%GIT_CMD%" push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================================
    echo   [成功] 代碼已成功推送到 https://github.com/gabin3328/3328
    echo.
    echo   啟用 GitHub Pages 步驟:
    echo   1. 前往 https://github.com/gabin3328/3328/settings/pages
    echo   2. Branch 選擇 main，資料夾選擇 / (root)，點擊 Save
    echo   3. 幾分鐘後即可透過 https://gabin3328.github.io/3328/ 線上使用！
    echo ===================================================================
) else (
    echo.
    echo [提示] 若需要登入驗證，請依照上方 GitHub 提示完成瀏覽器授權或輸入 Personal Access Token (PAT)。
)

echo.
pause
