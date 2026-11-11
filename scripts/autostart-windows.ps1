# Y웹 서버 자동 시작 켜기/끄기 (autostart.cmd가 실행).
# Windows에 로그인할 때 start.cmd를 최소화 창으로 실행하는 바로 가기를 이 사용자의 시작프로그램 폴더에 만들거나 지웁니다.
# 관리자 권한·레지스트리·예약 작업은 쓰지 않습니다. 바로 가기 하나가 전부라서 지우면 원래대로 돌아갑니다.
param(
  [ValidateSet('toggle', 'on', 'off', 'status')][string]$Mode = 'toggle',
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [switch]$NoPause
)
$root = Split-Path -Parent $PSScriptRoot
# ASCII file name: WScript.Shell cannot save a shortcut whose name is outside the system code page.
$link = Join-Path $StartupDir 'YWeb server.lnk'
$exists = Test-Path -LiteralPath $link
function Done([string]$message, [int]$code = 0) {
  Write-Host $message
  if (-not $NoPause) { Read-Host '엔터를 누르면 창을 닫습니다' | Out-Null }
  exit $code
}
if ($Mode -eq 'status') { if ($exists) { Done '자동 시작: 켜짐' } else { Done '자동 시작: 꺼짐' } }
if ($Mode -eq 'toggle') { if ($exists) { $Mode = 'off' } else { $Mode = 'on' } }
if ($Mode -eq 'off') {
  if ($exists) { Remove-Item -LiteralPath $link }
  Done '자동 시작을 껐습니다. 이제 Windows에 로그인해도 서버가 저절로 켜지지 않습니다. 다시 켜려면 autostart.cmd를 한 번 더 실행하세요.'
}
# 처음 실행(패키지 설치·첫 계정 만들기)은 창에서 직접 답해야 하므로, 설정을 마친 뒤에만 켭니다.
if (-not (Test-Path (Join-Path $root '.env'))) { Done '아직 설정 전입니다. start.cmd를 먼저 한 번 실행해 첫 계정까지 만든 뒤 다시 실행하세요.' 1 }
if (-not (Test-Path -LiteralPath $StartupDir)) { Done "시작프로그램 폴더를 찾을 수 없습니다: $StartupDir" 1 }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = Join-Path $root 'start.cmd'
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7 # 최소화
$shortcut.Description = 'YWeb server autostart'
$shortcut.Save()
Done '자동 시작을 켰습니다. 이 PC를 켜고 Windows에 로그인하면 서버가 최소화된 창으로 켜집니다(로그인 전에는 켜지지 않습니다). 끄려면 autostart.cmd를 한 번 더 실행하세요.'
