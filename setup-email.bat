@echo off
REM Remindate: turn on the email reminders on GitHub.
REM GitHub only runs workflows from the .github\workflows folder, so this puts the
REM workflow file there and pushes it.
cd /d "%~dp0"
if not exist "scripts\email-reminders.yml" (
  if exist ".github\workflows\email-reminders.yml" (
    echo The email workflow is already in place.
  ) else (
    echo Could not find scripts\email-reminders.yml
  )
  pause
  exit /b
)
if not exist ".github\workflows" mkdir ".github\workflows"
move /Y "scripts\email-reminders.yml" ".github\workflows\email-reminders.yml" >nul
echo Workflow moved to .github\workflows\email-reminders.yml
git add ".github/workflows/email-reminders.yml" "scripts/email-reminders.yml"
git commit -m "Turn on Remindate email reminders"
git push
echo.
echo Done. Now check the secrets in EMAIL-SETUP.md (step 3) and test with "Run workflow".
pause
