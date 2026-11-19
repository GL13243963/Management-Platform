param([Parameter(Mandatory=$true)][string]$Dist,[Parameter(Mandatory=$true)][string]$Version,[Parameter(Mandatory=$true)][string]$DestinationZip)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$distPath=(Resolve-Path -LiteralPath $Dist).Path
$target=[IO.Path]::GetFullPath($DestinationZip)
if(Test-Path -LiteralPath $target){throw '目标文件已存在，不覆盖'}
$taskParent=[IO.Path]::GetFullPath((Join-Path $root 'validation-runs'))
New-Item -ItemType Directory -Path $taskParent -Force | Out-Null
$taskPath=Join-Path $taskParent ('package-tool-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskPath | Out-Null
try{
 & (Join-Path $root '.runtime/node-v24.22.1-win-x64/node.exe') (Join-Path $root 'tools/stage-tool-matrix-frontend.cjs') --dist $distPath --asset-root $taskPath --version $Version
 if($LASTEXITCODE -ne 0){throw '工具前端校验失败'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $taskPath "releases/$Version"),$target)
 Write-Output "Created: $target"
}finally{
 $resolved=[IO.Path]::GetFullPath($taskPath)
 if(!$resolved.StartsWith($taskParent+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '临时清理目录越界'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
