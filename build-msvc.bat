@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: CTR Native MSVC Build Script (Windows x86)
:: Requires Visual Studio 2022 or newer with the Desktop C++ workload.
:: Usage: build-msvc.bat [Debug|Release] (defaults to Release).

set "CTR_CONFIGURATION=Release"
set "CTR_BUILD_PRESET=windows-msvc-x86-release"
if "%~1"=="" goto configuration_ready
if /i "%~1"=="Release" goto configuration_ready
if /i "%~1"=="Debug" (
    set "CTR_CONFIGURATION=Debug"
    set "CTR_BUILD_PRESET=windows-msvc-x86-debug"
    goto configuration_ready
)
echo Usage: build-msvc.bat [Debug^|Release]
exit /b 1

:configuration_ready

pushd "%~dp0"
if errorlevel 1 (
    echo ERROR: Cannot open the source directory.
    exit /b 1
)

:: Prefer PATH, then the CMake bundled with Visual Studio, then a standalone install.
set "CTR_CMAKE="
for /f "delims=" %%I in ('where cmake.exe 2^>nul') do if not defined CTR_CMAKE set "CTR_CMAKE=%%I"
if defined CTR_CMAKE goto cmake_found

set "CTR_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%CTR_VSWHERE%" goto standalone_cmake
for /f "usebackq delims=" %%I in (`"%CTR_VSWHERE%" -latest -products * -find Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe`) do set "CTR_CMAKE=%%I"
if defined CTR_CMAKE goto cmake_found

:standalone_cmake
if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "CTR_CMAKE=%ProgramFiles%\CMake\bin\cmake.exe"
if defined CTR_CMAKE goto cmake_found
echo ERROR: CMake was not found on PATH or in Visual Studio.
echo Install CMake 3.21 or newer, or the Visual Studio C++ CMake tools component.
goto failed

:cmake_found
for %%I in ("%CTR_CMAKE%") do set "CTR_CTEST=%%~dpIctest.exe"
if not exist "%CTR_CTEST%" (
    echo ERROR: ctest.exe was not found alongside CMake.
    echo Repair the CMake installation at "%CTR_CMAKE%".
    goto failed
)

echo Using CMake: "%CTR_CMAKE%"
"%CTR_CMAKE%" --preset windows-msvc-x86
if errorlevel 1 (
    echo ERROR: CMake configure failed
    goto failed
)

"%CTR_CMAKE%" --build --preset %CTR_BUILD_PRESET% --parallel
if errorlevel 1 (
    echo ERROR: Build failed
    goto failed
)

"%CTR_CTEST%" --preset %CTR_BUILD_PRESET% --no-tests=error
if errorlevel 1 (
    echo ERROR: Tests failed
    goto failed
)

echo.
echo Build and tests succeeded: build-msvc-x86\%CTR_CONFIGURATION%\ctr_native.exe
popd
exit /b 0

:failed
popd
exit /b 1
