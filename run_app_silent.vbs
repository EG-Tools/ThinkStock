Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
cur = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run chr(34) & cur & "\run_app.bat" & chr(34), 0
