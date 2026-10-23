import { _electron as electron, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

delete process.env.ELECTRON_RUN_AS_NODE
const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-native-dialog-'))
await mkdir('.artifacts/implementation', { recursive: true })
const script = `param([int]$ApplicationPid, [string]$Destination, [string]$Screenshot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ApplicationPid)
$chooser = $null
for ($attempt = 0; $attempt -lt 50 -and $null -eq $chooser; $attempt++) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  foreach ($candidate in $windows) {
    if ($candidate.Current.Name -eq 'Save project as a new file') { $chooser = $candidate; break }
    $chooser = $candidate.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Save project as a new file'))
    if ($null -ne $chooser) { break }
  }
  if ($null -eq $chooser) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $chooser) { $windows | ForEach-Object { $_.Current.Name }; throw 'The native Save project dialog was not found in this application.' }
$elements = $chooser.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$filename = $null
$save = $null
foreach ($element in $elements) {
  if ($element.Current.AutomationId -eq '1001' -and $element.Current.Name -eq 'Native checked.deepfryer') { $filename = $element }
  if ($element.Current.AutomationId -eq '1' -and $element.Current.Name -eq 'Save') { $save = $element }
}
if ($null -eq $filename -or $null -eq $save) { throw 'Native dialog controls did not match the observed Windows file chooser.' }
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeChooser {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, string text);
}
"@
$filenameHandle = [IntPtr]$filename.Current.NativeWindowHandle
$saveHandle = [IntPtr]$save.Current.NativeWindowHandle
foreach ($control in @(@($filenameHandle, 'Edit'), @($saveHandle, 'Button'))) {
  $class = [System.Text.StringBuilder]::new(256)
  [void][NativeChooser]::GetClassName($control[0], $class, $class.Capacity)
  if ($class.ToString() -ne $control[1]) { throw 'Native control class changed.' }
}
$suggested = $filename.Current.Name
$rectangle = $chooser.Current.BoundingRectangle
$bitmap = [System.Drawing.Bitmap]::new([int]$rectangle.Width, [int]$rectangle.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try { $graphics.CopyFromScreen([int]$rectangle.X, [int]$rectangle.Y, 0, 0, $bitmap.Size); $bitmap.Save($Screenshot, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bitmap.Dispose() }
[void][NativeChooser]::SendMessage($filenameHandle, 0x000C, [IntPtr]::Zero, $Destination)
$title = $chooser.Current.Name
[void][NativeChooser]::SendMessage($saveHandle, 0x00F5, [IntPtr]::Zero, $null)
[pscustomobject]@{ title=$title; suggested=$suggested; destination=$Destination } | ConvertTo-Json -Compress
`
await writeFile('.artifacts/implementation/native-chooser.ps1', script)
const app = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v1/baseline.deepfryer'))
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Save project as…' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Native checked')
  await page.getByRole('button', { name: 'Save as…', exact: true }).click()
  const destination = join(folder, 'Native checked.deepfryer')
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('.artifacts/implementation/native-chooser.ps1'), String(await app.evaluate(() => process.pid)), destination, resolve('.artifacts/implementation/native-save-dialog.png')], { windowsHide: true, timeout: 20000 })
  await expect(page.locator('.notice')).toContainText('Saved Native checked.deepfryer')
  const saved = JSON.parse(await readFile(destination, 'utf8'))
  assert.equal(saved.version, 2)
  assert.equal(saved.source.base64, JSON.parse(await readFile('tests/fixtures/v1/baseline.deepfryer', 'utf8')).source.base64)
  assert.equal(JSON.parse(result.stdout).suggested, 'Native checked.deepfryer')
  await writeFile('.artifacts/implementation/native-dialog-result.json', result.stdout)
  console.log(result.stdout.trim())
} finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
