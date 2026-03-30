/**
 * GPU Preference Launcher for Serenity Blocks
 *
 * This launcher exports symbols that tell NVIDIA/AMD drivers to use
 * the high-performance discrete GPU instead of integrated graphics.
 *
 * Compile with: x86_64-w64-mingw32-gcc -o launcher.exe gpu-preference-launcher.c -mwindows
 */

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// NVIDIA Optimus - request high-performance GPU
__declspec(dllexport) DWORD NvOptimusEnablement = 0x00000001;

// AMD PowerXpress - request high-performance GPU
__declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;

static const char* skipLauncherExecutable(const char* commandLine) {
    const char* cursor = commandLine;
    if (!cursor) {
        return "";
    }

    if (*cursor == '"') {
        cursor += 1;
        while (*cursor && *cursor != '"') {
            cursor += 1;
        }
        if (*cursor == '"') {
            cursor += 1;
        }
    } else {
        while (*cursor && *cursor != ' ' && *cursor != '\t') {
            cursor += 1;
        }
    }

    while (*cursor == ' ' || *cursor == '\t') {
        cursor += 1;
    }

    return cursor;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // Get the directory where this launcher is located
    char exePath[MAX_PATH];
    GetModuleFileNameA(NULL, exePath, MAX_PATH);

    // Find the last backslash to get directory
    char *lastSlash = strrchr(exePath, '\\');
    if (lastSlash) {
        *lastSlash = '\0';
    }

    // Build path to the actual Electron executable (core app)
    char electronPath[MAX_PATH];
    snprintf(electronPath, MAX_PATH, "%s\\SerenityBlocks-core.exe", exePath);

    const char* originalCommandLine = GetCommandLineA();
    const char* forwardedArgs = skipLauncherExecutable(originalCommandLine);
    char processCommandLine[32768];

    if (forwardedArgs && *forwardedArgs) {
        snprintf(processCommandLine, sizeof(processCommandLine), "\"%s\" %s", electronPath, forwardedArgs);
    } else {
        snprintf(processCommandLine, sizeof(processCommandLine), "\"%s\"", electronPath);
    }

    // Launch the Electron app
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    // Create the process
    if (CreateProcessA(
        electronPath,         // Application path
        processCommandLine,   // Preserve diagnostic flags and other args
        NULL,            // Process security attributes
        NULL,            // Thread security attributes
        FALSE,           // Inherit handles
        0,               // Creation flags
        NULL,            // Environment (inherit)
        exePath,         // Working directory
        &si,
        &pi
    )) {
        // Close handles - we don't need to wait for the process
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return 0;
    }

    // If launch failed, show error
    MessageBoxA(NULL, "Failed to launch Serenity Blocks.exe", "Launch Error", MB_OK | MB_ICONERROR);
    return 1;
}
