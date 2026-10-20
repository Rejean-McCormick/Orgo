@echo off
py -3 "%~dp0tools\tandem_education_p3\manager.py" ROLLBACK
exit /b %ERRORLEVEL%
