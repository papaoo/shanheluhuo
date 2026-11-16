param(
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SigningConfig = (Join-Path $env:USERPROFILE '.codex\signing\oldgold-zh-cn\signing.json'),
    [string]$ProxyHost = '',
    [int]$ProxyPort = 0
)
$ErrorActionPreference = 'Stop'
$mobileRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SdkPath)) { throw 'Set -SdkPath or ANDROID_HOME to an installed Android SDK.' }
if ([string]::IsNullOrWhiteSpace($JavaHome)) { throw 'Set -JavaHome or JAVA_HOME to an installed JDK 21.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platform-tools\adb.exe'))) { throw 'Set -SdkPath to an installed Android SDK.' }
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Set -JavaHome to JDK 21 or newer.' }
if (-not (Test-Path -LiteralPath $SigningConfig)) { throw 'A private signing.json is required; see README.zh-CN.md.' }
$signing = Get-Content -LiteralPath $SigningConfig -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $signing.keystore)) { throw 'Signing keystore is missing.' }
$names = @('JAVA_HOME','ANDROID_HOME','JAVA_OPTS','OLDGOLD_KEYSTORE_PATH','OLDGOLD_KEY_ALIAS','OLDGOLD_STORE_PASSWORD','OLDGOLD_KEY_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $SdkPath
    $env:OLDGOLD_KEYSTORE_PATH = $signing.keystore
    $env:OLDGOLD_KEY_ALIAS = $signing.alias
    $env:OLDGOLD_STORE_PASSWORD = $signing.storePassword
    $env:OLDGOLD_KEY_PASSWORD = $signing.keyPassword
    if ($ProxyHost) {
        if ($ProxyHost -notmatch '^[a-zA-Z0-9.-]+$' -or $ProxyPort -lt 1 -or $ProxyPort -gt 65535) { throw 'Invalid proxy host/port.' }
        $env:JAVA_OPTS = "$env:JAVA_OPTS -Dhttp.proxyHost=$ProxyHost -Dhttp.proxyPort=$ProxyPort -Dhttps.proxyHost=$ProxyHost -Dhttps.proxyPort=$ProxyPort"
    }
    $sdkAbsolute = (Resolve-Path -LiteralPath $SdkPath).Path.Replace('\','/')
    # Java Properties.load reads ISO-8859-1. Keep paths with Chinese or other
    # non-ASCII characters intact by encoding each UTF-16 unit as \uXXXX.
    $sdkProperty = [regex]::Replace($sdkAbsolute, '[^\x20-\x7e]', {
        param($match)
        '\u{0:x4}' -f [int][char]$match.Value
    })
    Set-Content -LiteralPath (Join-Path $mobileRoot 'android\local.properties') -Value "sdk.dir=$sdkProperty" -Encoding ascii
    Push-Location $mobileRoot
    try {
        & npm.cmd run sync
        if ($LASTEXITCODE -ne 0) { throw 'Web asset build / Capacitor sync failed.' }
        Push-Location (Join-Path $mobileRoot 'android')
        try {
            & .\gradlew.bat "assemble$Configuration" --no-daemon
            if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
        } finally { Pop-Location }
    } finally { Pop-Location }
    $variant = $Configuration.ToLowerInvariant()
    $apk = Join-Path $mobileRoot "android\app\build\outputs\apk\$variant\app-$variant.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Missing APK: $apk" }
    $report = Join-Path $mobileRoot "out\apk-contents-$variant.json"
    & node (Join-Path $mobileRoot '..\tools\check-apk.js') $apk --web-root (Join-Path $mobileRoot 'www') --write $report
    if ($LASTEXITCODE -ne 0) { throw 'APK content verification failed; refusing to copy it as a deliverable.' }
    $verification = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ($Configuration -eq 'Release' -and $verification.native.debuggable) { throw 'Release APK must not be debuggable.' }
    $destination = Join-Path $mobileRoot "OldGold-zh-CN-0.12.5-1-$variant.apk"
    Copy-Item -LiteralPath $apk -Destination $destination -Force
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($destination + '.sha256') -Value "$hash  $(Split-Path $destination -Leaf)" -Encoding ascii
    Write-Output "APK: $destination"
    Write-Output "SHA-256: $hash"
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
