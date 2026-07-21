Option Explicit

Dim shell, fileSystem, scriptsDirectory, root, scriptPath
Dim command, argument, exitCode, errorText, failurePath, failureText

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptsDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
root = fileSystem.GetParentFolderName(scriptsDirectory)
scriptPath = fileSystem.BuildPath(scriptsDirectory, "start-dev.ps1")
failurePath = fileSystem.BuildPath(fileSystem.GetSpecialFolder(2), fileSystem.GetTempName)
command = "pwsh.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden" _
    & " -ExecutionPolicy Bypass -File " & QuoteArgument(scriptPath) _
    & " -FailurePath " & QuoteArgument(failurePath)

For Each argument In WScript.Arguments
    command = command & " " & QuoteArgument(CStr(argument))
Next

On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    errorText = Err.Description
    Err.Clear
    On Error GoTo 0
    DeleteFailureFile failurePath
    MsgBox "Dataset Studio 无法启动。" & vbCrLf & errorText, _
        vbCritical, "Dataset Studio"
    WScript.Quit 1
End If
On Error GoTo 0

If exitCode <> 0 Then
    failureText = ReadFailureFile(failurePath)
    If Len(failureText) = 0 Then
        failureText = "请在终端运行 scripts\start-dev.ps1 查看详细信息。"
    End If
    MsgBox "Dataset Studio 启动失败（退出码 " & CStr(exitCode) & "）。" _
        & vbCrLf & vbCrLf & failureText, _
        vbExclamation, "Dataset Studio"
End If

DeleteFailureFile failurePath
WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Function ReadFailureFile(path)
    Dim stream
    ReadFailureFile = ""
    On Error Resume Next
    If fileSystem.FileExists(path) Then
        Set stream = fileSystem.OpenTextFile(path, 1, False, -1)
        ReadFailureFile = Trim(stream.ReadAll)
        stream.Close
    End If
    On Error GoTo 0
End Function

Sub DeleteFailureFile(path)
    On Error Resume Next
    If fileSystem.FileExists(path) Then
        fileSystem.DeleteFile path, True
    End If
    On Error GoTo 0
End Sub
