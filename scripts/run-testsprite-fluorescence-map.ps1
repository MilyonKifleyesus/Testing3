param(
  [int]$Port = 4200,
  [string]$HostName = "127.0.0.1",
  [switch]$MobileOnly,
  [string]$VideoUrlOutputPath
)

$ErrorActionPreference = "Stop"

function Test-TcpPort {
  param(
    [string]$ComputerName,
    [int]$Port,
    [int]$TimeoutMs = 500
  )
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($ComputerName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar) | Out-Null
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Get-OptionalEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }

  return $value
}

function Write-LatestVisualizationUrls {
  param(
    [Parameter(Mandatory = $true)][string]$ResultsPath,
    [Parameter(Mandatory = $true)][bool]$MobileRun,
    [string]$DestinationPath
  )

  if ([string]::IsNullOrWhiteSpace($DestinationPath) -or -not (Test-Path $ResultsPath)) {
    return
  }

  $raw = Get-Content $ResultsPath -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return
  }

  $results = $raw | ConvertFrom-Json
  $prefixes = if ($MobileRun) { @('TC004', 'TC005', 'TC006') } else { @('TC001', 'TC002', 'TC003') }
  $urls = @(
    $results |
      Where-Object {
        $_.testVisualization -and
        ($prefixes | Where-Object { $_ -and [string]$_.Length -gt 0 -and [string]$_.title -like "$_*" })
      } |
      ForEach-Object { [string]$_.testVisualization } |
      Select-Object -Unique
  )

  if ($urls.Count -eq 0) {
    return
  }

  $parent = Split-Path -Parent $DestinationPath
  if (-not [string]::IsNullOrWhiteSpace($parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  Set-Content -Encoding UTF8 -Path $DestinationPath -Value ($urls -join [Environment]::NewLine)
  Write-Host "Wrote TestSprite visualization URLs: $DestinationPath"
}

$projectPath = (Resolve-Path ".").Path
$projectName = Split-Path -Leaf $projectPath
$baseUrl = "http://$HostName`:$Port"
$testspriteResultsPath = Join-Path $projectPath "testsprite_tests\\tmp\\test_results.json"
$testUsername = Get-OptionalEnv -Name "BP_TEST_USERNAME" -DefaultValue "Naeem"
$testPassword = Get-OptionalEnv -Name "BP_TEST_PASSWORD" -DefaultValue "Admin123"

Write-Host "Project: $projectName"
Write-Host "Base URL: $baseUrl"

# Ensure TestSprite config path exists (ignored by git)
$testspriteTmp = Join-Path $projectPath "testsprite_tests\\tmp"
New-Item -ItemType Directory -Force -Path $testspriteTmp | Out-Null

# Prefer API key from env; fallback to Cursor MCP config if present.
if (-not $env:API_KEY) {
  $cursorMcpPath = Join-Path $env:USERPROFILE ".cursor\\mcp.json"
  if (Test-Path $cursorMcpPath) {
    try {
      $mcp = Get-Content $cursorMcpPath -Raw | ConvertFrom-Json
      $env:API_KEY = $mcp.mcpServers."testsprite-mcp".env.API_KEY
    } catch {
      # ignore
    }
  }
}
if (-not $env:API_KEY) {
  throw "Missing TestSprite API key. Set environment variable API_KEY before running."
}

# Write config.json used by TestSprite CLI runner (no secrets committed; file is ignored)
$configPath = Join-Path $testspriteTmp "config.json"
$testIds = if ($MobileOnly) { @("TC004", "TC005", "TC006") } else { @("TC001", "TC002", "TC003") }
$additionalInstruction = if ($MobileOnly) {
  "Mobile device only: run tests TC004, TC005, TC006. IMPORTANT: (1) Use Playwright viewport for mobile: create the browser context with viewport={'width': 375, 'height': 667} (e.g. context = await browser.new_context(viewport={'width': 375, height: 667})). Do NOT use window resize. (2) If the app shows a sign-in page, log in with username '$testUsername' and password '$testPassword'; click the submit button (button[type='submit'] or button with text 'Sign In'); wait for navigation to URL containing 'fluorescence-map' before any map assertions. (3) Target /_dev/fluorescence-map?testsprite=1. Verify: no grey gap between map and panel, Activity Log bottom sheet off-screen when closed, view toggle and Filter tappable, Panels button opens/closes bottom sheet. Stable selectors: #war-room-overlay-panel, button[aria-label*='panels'], button[aria-label*='Switch to'], button[title*='Filter'], #war-room-map."
} else {
  "Target the Fluorescence Map module via /_dev/fluorescence-map?testsprite=1 and prioritize stable selectors (#war-room-map, button[aria-label='Zoom in'], button[aria-label='Zoom out'], data-testid=marker-stability-status, aria-label view radios). If a sign-in page appears, authenticate using username '$testUsername' and password '$testPassword' before asserting on the map."
}
$config = @{
  status = "init"
  type = "frontend"
  localEndpoint = $baseUrl
  scope = "codebase"
  executionArgs = @{
    projectName = $projectName
    projectPath = $projectPath
    testIds = $testIds
    additionalInstruction = $additionalInstruction
    envs = @{}
  }
}
$config | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $configPath
if ($MobileOnly) { Write-Host "Mobile-only mode: running TC004, TC005, TC006" }
Write-Host "Wrote TestSprite config: $configPath"

# Clear any stale TestSprite execution lock (can block subsequent runs)
$lockPath = Join-Path $testspriteTmp "execution.lock"
if (Test-Path $lockPath) {
  try {
    Remove-Item -Force $lockPath
    Write-Host "Removed stale TestSprite lock: $lockPath"
  } catch {
    Write-Warning "Found lock file but could not remove it: $lockPath. Try re-running in an elevated shell."
  }
}

# Start dev server if not already running
$startedServer = $false
$serveProc = $null

if (-not (Test-TcpPort -ComputerName $HostName -Port $Port -TimeoutMs 500)) {
  Write-Host "Starting Angular dev server..."
  $outLogPath = Join-Path $projectPath ".tmp\\testsprite-ng-serve.out.log"
  $errLogPath = Join-Path $projectPath ".tmp\\testsprite-ng-serve.err.log"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outLogPath) | Out-Null

  $serveProc = Start-Process -FilePath "npm.cmd" -ArgumentList @(
    "start",
    "--",
    "--host", $HostName,
    "--port", "$Port"
  ) -WorkingDirectory $projectPath -PassThru -NoNewWindow -RedirectStandardOutput $outLogPath -RedirectStandardError $errLogPath

  $startedServer = $true
  $pidPath = Join-Path $projectPath ".tmp\\testsprite-ng-serve.pid"
  Set-Content -Encoding ASCII -Path $pidPath -Value "$($serveProc.Id)"
  Write-Host "ng serve PID file: $pidPath"
  Write-Host "ng serve PID: $($serveProc.Id) (stdout: $outLogPath)"
  Write-Host "ng serve PID: $($serveProc.Id) (stderr: $errLogPath)"

  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -ComputerName $HostName -Port $Port -TimeoutMs 500) { break }
    Start-Sleep -Seconds 2
  }
  if (-not (Test-TcpPort -ComputerName $HostName -Port $Port -TimeoutMs 500)) {
    throw "Dev server did not become ready on $HostName`:$Port within 3 minutes. See $outLogPath and $errLogPath"
  }
} else {
  Write-Host "Dev server already running on $HostName`:$Port"
}

try {
  # Some locked-down environments set proxy env vars to a local blackhole (e.g. 127.0.0.1:9),
  # which breaks `npx` package downloads. Clear those known-bad proxy settings for this run.
  $proxyVars = @(
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "GIT_HTTP_PROXY",
    "GIT_HTTPS_PROXY",
    "NPM_CONFIG_PROXY",
    "NPM_CONFIG_HTTPS_PROXY"
  )
  $clearedProxyVars = @()
  foreach ($name in $proxyVars) {
    $item = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($item -and $item.Value -and ($item.Value -match "127\\.0\\.0\\.1:9")) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
      $clearedProxyVars += $name
    }
  }
  if ($clearedProxyVars.Count -gt 0) {
    Write-Host "Cleared proxy env vars for npm/npx: $($clearedProxyVars -join ', ')"
  }

  # Ensure npx can download packages (repo machines often have npm offline=true)
  $env:npm_config_offline = "false"
  # Use a unique cache directory per run to reduce EPERM/unlink issues from file locks/AV scanners.
  # Prefer the user temp directory (OneDrive-backed workspaces can block npm cache unlink operations).
  $cacheStamp = (Get-Date -Format "yyyyMMdd-HHmmss")
  $cacheRoot = if ($env:TEMP) { Join-Path $env:TEMP "testsprite-npm-cache" } else { Join-Path $projectPath ".tmp" }
  $npmCache = Join-Path $cacheRoot "npm-cache-testsprite-$cacheStamp-$PID"
  New-Item -ItemType Directory -Force -Path $npmCache | Out-Null
  $env:npm_config_cache = $npmCache

  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Write-Host "Running TestSprite (cloud execution) (attempt $attempt/$maxAttempts)..."
    npx.cmd -y @testsprite/testsprite-mcp@latest generateCodeAndExecute

    if ($LASTEXITCODE -eq 0) {
      Write-Host "TestSprite finished. Reports (if generated): testsprite_tests/testsprite-mcp-test-report.md"
      break
    }

    if ($attempt -lt $maxAttempts) {
      Write-Warning "TestSprite failed with exit code $LASTEXITCODE. Retrying shortly..."
      Start-Sleep -Seconds (2 * $attempt)
    }
  }

  if ($LASTEXITCODE -ne 0) {
    throw "TestSprite failed with exit code $LASTEXITCODE. See npm logs under: $npmCache\\_logs"
  }

  Write-LatestVisualizationUrls -ResultsPath $testspriteResultsPath -MobileRun:$MobileOnly -DestinationPath $VideoUrlOutputPath
} finally {
  if ($startedServer -and $serveProc -and -not $serveProc.HasExited) {
    Write-Host "Stopping dev server PID $($serveProc.Id)..."
    Stop-Process -Id $serveProc.Id -Force
  }
  if ($startedServer -and $pidPath -and (Test-Path $pidPath)) {
    Remove-Item -Force $pidPath -ErrorAction SilentlyContinue
  }
  if ($lockPath -and (Test-Path $lockPath)) {
    Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
  }
}
