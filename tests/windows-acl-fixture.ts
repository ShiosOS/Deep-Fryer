import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execute = promisify(execFile)

export async function aclFixture(path: string, action: 'private' | 'deny' | 'read' | 'broaden-directory' | 'inherit' | 'change' | 'deny-create' | 'deny-read'): Promise<string> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:DF_ACL_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$isDirectory = [IO.Directory]::Exists($p)
$a = if ($isDirectory) { [IO.Directory]::GetAccessControl($p, 'Access') } else { [IO.File]::GetAccessControl($p, 'Access') }
switch ($env:DF_ACL_ACTION) {
  'broaden-directory' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')) }
  'private' { $a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)) { $a.RemoveAccessRuleSpecific($r) }; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')) }
  'deny' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'ReadData','Deny')) }
  'inherit' { $a.SetAccessRuleProtection($false,$true) }
  'change' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'WriteData','Deny')) }
  'deny-create' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'CreateFiles','Deny')) }
  'deny-read' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-3-4'),'ReadPermissions','Deny')) }
}
if ($env:DF_ACL_ACTION -ne 'read') {
  if ($isDirectory) { [IO.Directory]::SetAccessControl($p,$a) } else { [IO.File]::SetAccessControl($p,$a) }
}
if ($env:DF_ACL_ACTION -eq 'deny-read') { [Console]::Write('acl-read-denied'); exit }
$result = if ($isDirectory) { [IO.Directory]::GetAccessControl($p, 'Access,Owner,Group') } else { [IO.File]::GetAccessControl($p, 'Access,Owner,Group') }
[Console]::Write($result.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Access,Owner,Group'))
`
  const { stdout } = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), DF_ACL_PATH: path, DF_ACL_ACTION: action } })
  return stdout.trim().replace(/D:(P?)(AI|AR)+/g, 'D:$1')
}
