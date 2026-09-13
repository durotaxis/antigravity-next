Option Explicit

' WScript has no console; window style 0 keeps PowerShell hidden from creation.
' Wait for completion so Task Scheduler retains the watchdog's real exit code.
Dim shell, files, watchdogPath, powershellPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
watchdogPath = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "coros_sync_watchdog.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = Chr(34) & powershellPath & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & watchdogPath & Chr(34)
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
