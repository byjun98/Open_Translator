@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title 로컬 자막 번역 - 프록시 설정 도구

REM === 전역 경로 ===
set "LAUNCHER_DIR=%LOCALAPPDATA%\LocalSubtitleTranslator"
set "LAUNCHER_VBS=%LAUNCHER_DIR%\openai-oauth-launcher.vbs"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_VBS=%STARTUP_DIR%\OpenAI OAuth Proxy.vbs"
set "TASK_NAME=OpenAI OAuth Proxy"

:menu
cls
echo ================================================================
echo            로컬 자막 번역 - OpenAI 프록시 설정 도구
echo ================================================================
echo.
echo   이 도구는 YouTube 자막 번역에 필요한 로컬 프록시
echo   (openai-oauth)를 설치하고 Windows 로그온 시 자동으로
echo   기동되도록 설정합니다.
echo.
echo   권장 순서: [1] -^> [2] -^> [3] 또는 [4]
echo.
echo   현재 상태:
call :status_show
echo.
echo ----------------------------------------------------------------
echo   [1] openai-oauth 전역 설치 / 업데이트
echo   [2] 최초 로그인 (브라우저 인증 - 1회만)
echo.
echo   --- 자동 실행 등록 (A 또는 B 중 선택) ---
echo   [3] 옵션 A: Startup 폴더 등록 (간단, 추천)
echo   [4] 옵션 B: 작업 스케줄러 등록 (크래시 시 자동 재시작)
echo.
echo   [5] 지금 수동 실행 (새 창에서 테스트용으로 기동)
echo   [6] 자동 실행 해제 (A/B 모두)
echo   [7] 전체 초기화 (패키지 + 자동실행 + 토큰 캐시 모두 삭제)
echo   [0] 종료
echo ----------------------------------------------------------------
echo.
set "CHOICE="
set /p "CHOICE=번호 입력: "

if "!CHOICE!"=="1" call :install_global
if "!CHOICE!"=="2" call :first_login
if "!CHOICE!"=="3" call :register_startup
if "!CHOICE!"=="4" call :register_task
if "!CHOICE!"=="5" call :run_manual
if "!CHOICE!"=="6" call :unregister_all
if "!CHOICE!"=="7" call :full_reset
if "!CHOICE!"=="0" goto :end

echo.
pause
goto :menu

REM ================================================================
:status_show
  where openai-oauth >nul 2>&1
  if !errorlevel! equ 0 (
    echo     [O] openai-oauth 전역 설치됨
  ) else (
    echo     [X] openai-oauth 전역 설치 안 됨  ^-- [1]을 먼저 실행하세요
  )

  if exist "%STARTUP_VBS%" (
    echo     [O] 자동 실행 A ^(Startup 폴더^) 활성
  ) else (
    echo     [ ] 자동 실행 A 비활성
  )

  schtasks /query /tn "%TASK_NAME%" >nul 2>&1
  if !errorlevel! equ 0 (
    echo     [O] 자동 실행 B ^(작업 스케줄러^) 활성
  ) else (
    echo     [ ] 자동 실행 B 비활성
  )

  netstat -ano | findstr ":10531" | findstr "LISTENING" >nul 2>&1
  if !errorlevel! equ 0 (
    echo     [O] 프록시 실행 중 ^(포트 10531 수신 대기^)
  ) else (
    echo     [ ] 프록시 미실행
  )
  exit /b

REM ================================================================
:install_global
  echo.
  echo ----------------------------------------------------------------
  echo   [1] openai-oauth 전역 설치
  echo ----------------------------------------------------------------
  echo.
  where npm >nul 2>&1
  if !errorlevel! neq 0 (
    echo [실패] npm 을 찾을 수 없습니다. Node.js 가 설치되어 있는지
    echo        https://nodejs.org/ 에서 확인하세요.
    exit /b 1
  )

  echo  npm i -g openai-oauth 를 실행합니다...
  echo.
  call npm i -g openai-oauth
  if !errorlevel! neq 0 (
    echo.
    echo [실패] 설치에 실패했습니다. 위 오류 메시지를 확인하세요.
    exit /b 1
  )
  echo.
  echo [성공] openai-oauth 설치 완료.
  where openai-oauth >nul 2>&1
  if !errorlevel! neq 0 (
    echo.
    echo [참고] 현재 창의 PATH가 아직 갱신되지 않았을 수 있습니다.
    echo        이 창을 닫고 새 명령 프롬프트에서 본 스크립트를
    echo        다시 실행한 뒤 [2]로 진행하세요.
  )
  exit /b

REM ================================================================
:first_login
  echo.
  echo ----------------------------------------------------------------
  echo   [2] 최초 로그인
  echo ----------------------------------------------------------------
  where openai-oauth >nul 2>&1
  if !errorlevel! neq 0 (
    echo.
    echo [경고] 먼저 [1]로 openai-oauth 를 설치하세요.
    exit /b 1
  )
  echo.
  echo   새 창에서 openai-oauth 를 실행합니다.
  echo.
  echo   1. 브라우저가 열리면 로그인을 완료하세요.
  echo   2. "listening on 10531" 같은 메시지가 뜨면 토큰이 캐시된 것입니다.
  echo   3. 그 창은 그대로 두거나 Ctrl+C 로 종료 후 이 메뉴로 돌아와
  echo      [3] 또는 [4] 로 자동 실행을 등록하세요.
  echo.
  pause
  start "OpenAI OAuth - 최초 로그인" cmd /k openai-oauth
  exit /b

REM ================================================================
:ensure_launcher
  REM 창을 띄우지 않고 프록시를 실행할 공용 VBS 런처 생성
  if not exist "%LAUNCHER_DIR%" mkdir "%LAUNCHER_DIR%" >nul 2>&1
  > "%LAUNCHER_VBS%" echo Set Shell = CreateObject("WScript.Shell"^)
  >>"%LAUNCHER_VBS%" echo Shell.Run "cmd /c openai-oauth", 0, False
  exit /b

REM ================================================================
:register_startup
  echo.
  echo ----------------------------------------------------------------
  echo   [3] 옵션 A: Startup 폴더 등록
  echo ----------------------------------------------------------------
  where openai-oauth >nul 2>&1
  if !errorlevel! neq 0 (
    echo.
    echo [경고] 먼저 [1]로 openai-oauth 를 설치하세요.
    exit /b 1
  )

  if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%" >nul 2>&1
  > "%STARTUP_VBS%" echo Set Shell = CreateObject("WScript.Shell"^)
  >>"%STARTUP_VBS%" echo Shell.Run "cmd /c openai-oauth", 0, False

  echo.
  echo [완료] Startup 폴더에 VBS 런처를 등록했습니다.
  echo        위치: %STARTUP_VBS%
  echo.
  echo   - 다음 Windows 로그온부터 백그라운드로 자동 기동됩니다.
  echo   - 지금 바로 기동하려면 [5]를 실행하세요.
  echo   - 해제하려면 [6], 전체 초기화는 [7].
  exit /b

REM ================================================================
:register_task
  echo.
  echo ----------------------------------------------------------------
  echo   [4] 옵션 B: 작업 스케줄러 등록
  echo ----------------------------------------------------------------
  where openai-oauth >nul 2>&1
  if !errorlevel! neq 0 (
    echo.
    echo [경고] 먼저 [1]로 openai-oauth 를 설치하세요.
    exit /b 1
  )

  call :ensure_launcher

  echo.
  echo   작업 이름: "%TASK_NAME%"
  echo   동작:      wscript "%LAUNCHER_VBS%"
  echo   트리거:    로그온 시
  echo.

  schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%LAUNCHER_VBS%\"" /sc onlogon /rl LIMITED /f >nul
  if !errorlevel! neq 0 (
    echo [실패] 작업 스케줄러 등록에 실패했습니다.
    echo        관리자 권한으로 다시 시도해 보세요.
    exit /b 1
  )

  REM 크래시 시 자동 재시작 설정을 PowerShell 로 추가
  powershell -NoProfile -Command "$s = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName '%TASK_NAME%' -Settings $s | Out-Null" 2>nul

  echo [완료] 작업 스케줄러 등록 성공.
  echo   - 로그온 시 자동 실행
  echo   - 프록시가 중단되면 1분 간격으로 최대 3회 자동 재시작
  echo.
  echo   지금 바로 기동하려면:
  echo     schtasks /run /tn "%TASK_NAME%"
  echo   또는 본 메뉴 [5] 를 사용하세요.
  exit /b

REM ================================================================
:run_manual
  where openai-oauth >nul 2>&1
  if !errorlevel! neq 0 (
    echo.
    echo [경고] 먼저 [1]로 openai-oauth 를 설치하세요.
    exit /b 1
  )
  echo.
  echo [실행] 새 창에서 프록시를 시작합니다.
  echo        창을 닫으면 프로세스도 함께 종료됩니다.
  start "OpenAI OAuth Proxy" cmd /k openai-oauth
  exit /b

REM ================================================================
:unregister_all
  echo.
  echo ----------------------------------------------------------------
  echo   [6] 자동 실행 해제
  echo ----------------------------------------------------------------
  set "REMOVED=0"

  if exist "%STARTUP_VBS%" (
    del /q "%STARTUP_VBS%" 2>nul
    set "REMOVED=1"
    echo [해제] 옵션 A ^(Startup VBS^) 삭제
  )

  schtasks /query /tn "%TASK_NAME%" >nul 2>&1
  if !errorlevel! equ 0 (
    schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
    set "REMOVED=1"
    echo [해제] 옵션 B ^(작업 스케줄러^) 삭제
  )

  if "!REMOVED!"=="0" (
    echo [정보] 등록된 자동 실행 항목이 없습니다.
  ) else (
    echo.
    echo   기동 중인 프록시는 그대로 유지됩니다.
    echo   지금 즉시 종료하려면 전체 초기화 ^([7]^) 또는 작업 관리자에서 종료하세요.
  )
  exit /b

REM ================================================================
:full_reset
  echo.
  echo ================================================================
  echo   [7] 전체 초기화 (주의!)
  echo ================================================================
  echo   다음 항목이 모두 제거됩니다:
  echo.
  echo     - 자동 실행 등록 ^(A, B 모두^)
  echo     - VBS 런처 파일 ^(%LAUNCHER_DIR%^)
  echo     - 실행 중인 프록시 프로세스 ^(포트 10531 LISTEN 중인 것^)
  echo     - 전역 패키지 openai-oauth
  echo     - 토큰 캐시 ^(%%USERPROFILE%%\.openai-oauth 등^)
  echo.
  echo ================================================================
  echo.
  set "CONFIRM="
  set /p "CONFIRM=계속하려면 yes 를 입력하세요: "
  if /i not "!CONFIRM!"=="yes" (
    echo.
    echo [취소] 초기화를 중단했습니다.
    exit /b
  )

  echo.
  echo [1/5] 자동 실행 해제 중...
  call :unregister_all

  echo.
  echo [2/5] VBS 런처 제거 중...
  if exist "%LAUNCHER_DIR%" (
    rd /s /q "%LAUNCHER_DIR%" 2>nul
    echo        - %LAUNCHER_DIR% 제거됨
  ) else (
    echo        - 런처 디렉터리 없음 ^(건너뜀^)
  )

  echo.
  echo [3/5] 실행 중 프록시 프로세스 종료 중 ^(포트 10531^)...
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 10531 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }" 2>nul
  echo        - 완료

  echo.
  echo [4/5] 전역 패키지 제거 중...
  where npm >nul 2>&1
  if !errorlevel! equ 0 (
    call npm uninstall -g openai-oauth
  ) else (
    echo        - npm 이 없어 제거를 건너뜁니다.
  )

  echo.
  echo [5/5] 토큰 캐시 제거 중...
  set "REMOVED_CACHE=0"
  if exist "%USERPROFILE%\.openai-oauth" (
    rd /s /q "%USERPROFILE%\.openai-oauth" 2>nul
    echo        - %%USERPROFILE%%\.openai-oauth 제거됨
    set "REMOVED_CACHE=1"
  )
  if exist "%APPDATA%\openai-oauth" (
    rd /s /q "%APPDATA%\openai-oauth" 2>nul
    echo        - %%APPDATA%%\openai-oauth 제거됨
    set "REMOVED_CACHE=1"
  )
  if exist "%LOCALAPPDATA%\openai-oauth" (
    rd /s /q "%LOCALAPPDATA%\openai-oauth" 2>nul
    echo        - %%LOCALAPPDATA%%\openai-oauth 제거됨
    set "REMOVED_CACHE=1"
  )
  if "!REMOVED_CACHE!"=="0" echo        - 발견된 캐시 없음

  echo.
  echo ================================================================
  echo   [완료] 전체 초기화가 끝났습니다.
  echo ================================================================
  exit /b

REM ================================================================
:end
endlocal
exit /b 0
