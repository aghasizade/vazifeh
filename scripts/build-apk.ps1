# Builds the signed Android APK and copies it to release\ with the android.json the server offers for updates.
# Needs ANDROID_HOME (or ANDROID_SDK_ROOT) set, and android/keystore.properties for signing.
# Gradle fails in folders whose path has non-ASCII characters; set VAZIFEH_BUILD_LINK to an ASCII path
# (for example C:\dev\vazifeh-build) and the script builds through a junction there.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = $root
if ($env:VAZIFEH_BUILD_LINK) {
  $work = $env:VAZIFEH_BUILD_LINK
  if (-not (Test-Path $work)) { New-Item -ItemType Junction -Path $work -Target $root | Out-Null }
}

Set-Location $work
npx vite build
npx cap sync android

Set-Location "$work\android"
# google-mirror.init.gradle swaps in Google's own Maven mirror for networks where the main host is blocked.
& .\gradlew.bat -I google-mirror.init.gradle assembleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)" }

$version = (Get-Content "$work\package.json" -Raw | ConvertFrom-Json).version
$out = Join-Path $work 'release'
New-Item -ItemType Directory -Force $out | Out-Null
$apk = "Vazifeh-$version.apk"
Copy-Item "$work\android\app\build\outputs\apk\release\app-release.apk" (Join-Path $out $apk) -Force
# Written without a byte-order mark (Windows PowerShell's utf8 adds one).
$json = @{ version = $version; file = $apk; notes = '' } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $out 'android.json'), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "APK ready: release\$apk  (copy it and android.json to the server's downloads folder)"
