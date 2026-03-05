@echo off
echo ========================================
echo 3D Scene Plane Extraction System
echo ========================================
echo.
echo Installing dependencies...
cd /d %~dp0
pip install -r backend/requirements.txt
echo.
echo Starting server...
echo Access the application at: http://localhost:8000
echo.
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
pause
