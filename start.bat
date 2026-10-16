@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo 没有找到 Python，请先安装 Python 3.10 或更新版本，安装时勾选 Add python.exe to PATH & pause & exit /b)
if not exist config.json (copy config.example.json config.json >nul & echo 已生成 config.json，未填 API Key 时以演示模式运行。)
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8000"
python server.py
pause
