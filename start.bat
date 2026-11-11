@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   造声 VOICEFORGE
echo   ----------------------------------------
echo.

if "%DASHSCOPE_API_KEY%"=="" (
  echo   [!] 没检测到 DASHSCOPE_API_KEY
  echo       程序会自动去 Windows 用户环境变量里再读一次。
  echo       如果还是不行，请先设置：
  echo       set DASHSCOPE_API_KEY=sk-xxxxxxxx
  echo.
)

if not exist ".venv" (
  echo   首次运行，正在装依赖...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install -q --upgrade pip
  python -m pip install -q -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

echo   本机访问：  http://127.0.0.1:8000
echo.

if exist "bin\cloudflared.exe" (
  echo   正在开公网隧道，稍等几秒会打印一个 https://xxx.trycloudflare.com
  start "" /min bin\cloudflared.exe tunnel --url http://127.0.0.1:8000 --no-autoupdate
)

python run.py
pause
