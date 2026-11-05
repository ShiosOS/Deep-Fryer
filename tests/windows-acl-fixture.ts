import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execute = promisify(execFile)

export async function aclFixture(path: string, action: 'private' | 'deny' | 'read' | 'broaden-directory' | 'inherit' | 'change'): Promise<string> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:DF_ACL_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$a = Get-Acl -LiteralPath $p
switch ($env:DF_ACL_ACTION) {
  'broaden-directory' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')) }
  'private' { $a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)) { $a.RemoveAccessRuleSpecific($r) }; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')) }
  'deny' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'ReadData','Deny')) }
  'inherit' { $a.SetAccessRuleProtection($false,$true) }
  'change' { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'WriteData','Deny')) }
}
if ($env:DF_ACL_ACTION -ne 'read') { Set-Acl -LiteralPath $p -AclObject $a }
[Console]::Write((Get-Acl -LiteralPath $p).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Access,Owner,Group'))
`
  const { stdout } = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), DF_ACL_PATH: path, DF_ACL_ACTION: action } })
  return stdout.trim()
}
