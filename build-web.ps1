$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    # Prefer the activated SDK; also support an ignored project-local SDK.
    $ctrSdk = $env:EMSDK
    if (-not $ctrSdk -and (Test-Path ".cache/emsdk/emsdk_env.ps1")) {
        $ctrSdk = Join-Path $PSScriptRoot ".cache/emsdk"
    }
    if (-not $ctrSdk) { throw "Install and activate Emscripten, then run its emsdk_env.ps1 first." }
    . (Join-Path $ctrSdk "emsdk_env.ps1")

    $ctrCmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue
    if ($ctrCmakeCommand) {
        $ctrCmake = $ctrCmakeCommand.Source
    } else {
        $ctrVswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
        if (Test-Path $ctrVswhere) {
            $ctrCmake = & $ctrVswhere -latest -products "*" -find "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe" | Select-Object -First 1
        }
        if (-not $ctrCmake) { throw "Install CMake 3.21+ and Ninja, or the Visual Studio CMake tools." }
    }
    # Visual Studio ships Ninja alongside CMake.
    $ctrNinja = [IO.Path]::GetFullPath((Join-Path (Split-Path $ctrCmake) "../../Ninja"))
    if (Test-Path $ctrNinja) { $env:PATH = "$ctrNinja;$env:PATH" }
    & npm.cmd --prefix web ci --ignore-scripts
    if ($LASTEXITCODE) { throw "Tailwind dependency installation failed." }
    & $ctrCmake --preset web-release
    if ($LASTEXITCODE) { throw "Web configuration failed." }
    & $ctrCmake --build --preset web-release --parallel
    if ($LASTEXITCODE) { throw "Web build failed." }
    Write-Host "Built build-web. Start local and online play with: npm --prefix web start"
} finally {
    Pop-Location
}
