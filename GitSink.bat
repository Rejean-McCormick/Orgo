@echo off
REM Check if a commit message was provided as an argument
if "%1"=="" (
    set /p "commit_message=Enter commit message (e.g., 'Minor fix'): "
) else (
    set commit_message=%1
)

echo.
echo =================================
echo Starting Git Commit and Push...
echo Commit Message: "%commit_message%"
echo =================================
echo.

REM Add all changes to the staging area
echo Running: git add .
call git add .

REM Commit the changes
echo Running: git commit -m "%commit_message%"
call git commit -m "%commit_message%"

REM Push the changes to the remote repository
echo Running: git push
call git push

echo.
echo =================================
echo Git process complete!
echo =================================

pause