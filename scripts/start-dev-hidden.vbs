Option Explicit

Dim shell, fileSystem, scriptsDirectory, root, scriptPath
Dim command, argument, exitCode, errorText

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptsDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
root = fileSystem.GetParentFolderName(scriptsDirectory)
scriptPath = fileSystem.BuildPath(scriptsDirectory, "start-dev.ps1")
command = "pwsh.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden" _
    & " -ExecutionPolicy Bypass -File " & QuoteArgument(scriptPath)

For Each argument In WScript.Arguments
    command = command & " " & QuoteArgument(CStr(argument))
Next

On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    errorText = Err.Description
    Err.Clear
    On Error GoTo 0
    MsgBox "Dataset Studio could not start." & vbCrLf & errorText, _
        vbCritical, "Dataset Studio"
    WScript.Quit 1
End If
On Error GoTo 0

If exitCode <> 0 Then
    MsgBox "Dataset Studio exited unexpectedly (code " & CStr(exitCode) & ")." _
        & vbCrLf & "Run scripts\start-dev.ps1 in a terminal for details.", _
        vbExclamation, "Dataset Studio"
End If

WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
