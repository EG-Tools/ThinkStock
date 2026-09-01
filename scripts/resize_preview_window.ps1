param(
  [int]$Width = 1109,
  [int]$Height = 1990,
  [int]$Left = 0,
  [int]$Top = 0,
  [int]$TimeoutSeconds = 12,
  [string]$ProfileMarker = "iPhonePreviewProfile"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ThinkStockPreviewWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@

try {
  [ThinkStockPreviewWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
} catch {}

$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(2, $TimeoutSeconds))
do {
  $script:targetWindow = [IntPtr]::Zero
  $callback = [ThinkStockPreviewWindow+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$parameter)
    if (-not [ThinkStockPreviewWindow]::IsWindowVisible($window)) { return $true }
    $title = New-Object System.Text.StringBuilder 256
    [ThinkStockPreviewWindow]::GetWindowText($window, $title, $title.Capacity) | Out-Null
    if ($title.ToString() -eq "Think Stock") {
      [uint32]$windowProcessId = 0
      [ThinkStockPreviewWindow]::GetWindowThreadProcessId($window, [ref]$windowProcessId) | Out-Null
      $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$windowProcessId" -ErrorAction SilentlyContinue).CommandLine
      if ($commandLine -notlike "*$ProfileMarker*") { return $true }
      $script:targetWindow = $window
      return $false
    }
    return $true
  }
  [ThinkStockPreviewWindow]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  if ($script:targetWindow -ne [IntPtr]::Zero) {
    if (-not [ThinkStockPreviewWindow]::MoveWindow(
      $script:targetWindow,
      $Left,
      $Top,
      [Math]::Max(320, $Width),
      [Math]::Max(480, $Height),
      $true
    )) {
      throw "Think Stock preview window resize failed."
    }
    exit 0
  }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

throw "Think Stock preview window was not found."
