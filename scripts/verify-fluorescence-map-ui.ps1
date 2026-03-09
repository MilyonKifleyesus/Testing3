[CmdletBinding()]
param(
  [int]$Port = 4200,
  [string]$HostName = "127.0.0.1",
  [string]$RoutePath = "/_dev/fluorescence-map",
  [string]$OutputDir = "output/playwright",
  [switch]$SkipBuild,
  [switch]$SkipVideo,
  [switch]$SkipMobile
)

$ErrorActionPreference = "Stop"

function Get-RequiredEnv {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value
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

function Initialize-NpmExecutionEnvironment {
  $proxyVars = @(
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "GIT_HTTP_PROXY",
    "GIT_HTTPS_PROXY",
    "NPM_CONFIG_PROXY",
    "NPM_CONFIG_HTTPS_PROXY"
  )

  foreach ($name in $proxyVars) {
    $item = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($item -and $item.Value -and ($item.Value -match "127\\.0\\.0\\.1:9")) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
  }

  $env:npm_config_offline = "false"
  $cacheStamp = (Get-Date -Format "yyyyMMdd-HHmmss")
  $cacheRoot = if ($env:TEMP) { Join-Path $env:TEMP "playwright-npm-cache" } else { Join-Path $projectPath ".tmp" }
  $npmCache = Join-Path $cacheRoot "npm-cache-playwright-$cacheStamp-$PID"
  New-Item -ItemType Directory -Force -Path $npmCache | Out-Null
  $env:npm_config_cache = $npmCache
}

function Invoke-PlaywrightCli {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )

  $cmdArgs = @('-y', '@playwright/cli@latest') + $Arguments
  $previousErrorPreference = $global:ErrorActionPreference
  $global:ErrorActionPreference = "Continue"
  try {
    $lines = & npx.cmd @cmdArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $global:ErrorActionPreference = $previousErrorPreference
  }
  $output = ($lines | ForEach-Object { "$_" }) -join "`n"

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "playwright-cli failed (exit=$exitCode) with args [$($Arguments -join ' ')]:`n$output"
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    output   = $output
  }
}

function Parse-PlaywrightResultJson {
  param([Parameter(Mandatory = $true)][string]$Output)

  $lines = $Output -split "`r`n|`n|`r"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Trim() -ne '### Result') {
      continue
    }

    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
      $candidate = $lines[$j].Trim()
      if ([string]::IsNullOrWhiteSpace($candidate)) {
        continue
      }
      if ($candidate.StartsWith('{') -or $candidate.StartsWith('[') -or $candidate.StartsWith('"')) {
        return $candidate | ConvertFrom-Json -Depth 100
      }
      break
    }
  }

  throw "Unable to parse playwright-cli result payload.`n$Output"
}

function Get-PlaywrightErrorPayload {
  param([Parameter(Mandatory = $true)][string]$Output)

  $lines = $Output -split "`r`n|`n|`r"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Trim() -ne '### Error') {
      continue
    }

    $errorLines = New-Object System.Collections.Generic.List[string]
    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
      $line = $lines[$j]
      if ($line.Trim().StartsWith('### ')) {
        break
      }
      $errorLines.Add($line)
    }

    $payload = ($errorLines | ForEach-Object { "$_" }) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($payload)) {
      return $payload.Trim()
    }

    return "playwright-cli returned an error with no payload."
  }

  return $null
}

function Invoke-RunCode {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$Code
  )

  $singleLineCode = ($Code -replace "`r`n", " " -replace "`n", " ").Trim()
  $result = Invoke-PlaywrightCli -Arguments @("-s=$SessionId", "run-code", $singleLineCode) -AllowFailure
  if ($result.exitCode -ne 0) {
    throw "run-code failed:`n$($result.output)"
  }

  $playwrightError = Get-PlaywrightErrorPayload -Output $result.output
  if (-not [string]::IsNullOrWhiteSpace($playwrightError)) {
    throw "run-code returned an error:`n$playwrightError"
  }

  return Parse-PlaywrightResultJson -Output $result.output
}

function Convert-ToJsStringLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)

  $escaped = $Value -replace "\\", "\\\\" -replace "'", "\\'"
  return "'$escaped'"
}

function Start-DevServerIfNeeded {
  if (Test-TcpPort -ComputerName $HostName -Port $Port -TimeoutMs 500) {
    Write-Host "[verify:fluorescence-map:ui] Dev server already running on $HostName`:$Port"
    return $null
  }

  $outLogPath = Join-Path $projectPath ".tmp\\fluorescence-map-ng-serve.out.log"
  $errLogPath = Join-Path $projectPath ".tmp\\fluorescence-map-ng-serve.err.log"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outLogPath) | Out-Null

  $serveProc = Start-Process -FilePath "npm.cmd" -ArgumentList @(
    "start",
    "--",
    "--host", $HostName,
    "--port", "$Port"
  ) -WorkingDirectory $projectPath -PassThru -NoNewWindow -RedirectStandardOutput $outLogPath -RedirectStandardError $errLogPath

  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -ComputerName $HostName -Port $Port -TimeoutMs 500) {
      Write-Host "[verify:fluorescence-map:ui] Started Angular dev server PID $($serveProc.Id)"
      return $serveProc
    }
    Start-Sleep -Seconds 2
  }

  throw "Dev server did not become ready on $HostName`:$Port within 3 minutes. See $outLogPath and $errLogPath"
}

function Invoke-ViewportVerification {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$ViewportName,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [Parameter(Mandatory = $true)][string]$ScreenshotPath
  )

  $routeUrlJs = Convert-ToJsStringLiteral -Value $routeUrl
  $routePathJs = Convert-ToJsStringLiteral -Value $RoutePath
  $usernameJs = Convert-ToJsStringLiteral -Value $username
  $passwordJs = Convert-ToJsStringLiteral -Value $password
  $screenshotPathJs = Convert-ToJsStringLiteral -Value $ScreenshotPath
  $viewportNameJs = Convert-ToJsStringLiteral -Value $ViewportName

  $verifyCode = @"
async (page) => {
  const routeUrl = __ROUTE_URL__;
  const routePath = __ROUTE_PATH__;
  const username = __USERNAME__;
  const password = __PASSWORD__;
  const screenshotPath = __SCREENSHOT_PATH__;
  const viewportName = __VIEWPORT_NAME__;

  await page.setViewportSize({ width: __WIDTH__, height: __HEIGHT__ });

  if (!page.__bpVerifyState || !page.__bpVerifyState.attached) {
    const state = {
      attached: true,
      consoleMessages: [],
      requestFailures: [],
      badResponses: [],
    };
    page.__bpVerifyState = state;
    page.on('console', (message) => {
      state.consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
      if (state.consoleMessages.length > 50) {
        state.consoleMessages.shift();
      }
    });
    page.on('requestfailed', (request) => {
      state.requestFailures.push({
        url: request.url(),
        method: request.method(),
        errorText: request.failure()?.errorText || 'requestfailed',
      });
      if (state.requestFailures.length > 50) {
        state.requestFailures.shift();
      }
    });
    page.on('response', (response) => {
      if (response.status() < 400) {
        return;
      }
      state.badResponses.push({
        url: response.url(),
        status: response.status(),
      });
      if (state.badResponses.length > 50) {
        state.badResponses.shift();
      }
    });
  }

  const ensureAuthenticated = async () => {
    const hasLoginForm =
      (await page.locator('input[formcontrolname="username"]').count()) > 0 &&
      (await page.locator('input[formcontrolname="password"]').count()) > 0;

    if (!hasLoginForm && !page.url().includes('/custom/sign-in')) {
      return { didLogin: false };
    }

    await page.fill('input[formcontrolname="username"]', username);
    await page.fill('input[formcontrolname="password"]', password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('button[type="submit"]'),
    ]);
    return { didLogin: true };
  };

  await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const loginResult = await ensureAuthenticated();
  if (loginResult.didLogin) {
    await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  }

  await page.waitForSelector('app-fluorescence-map', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('#war-room-map', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Zoom in"]', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Zoom out"]', { state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);

  const projectButton = page.locator('.fleet-mode-tabs button', { hasText: 'Projects' }).first();
  const clientButton = page.locator('.fleet-mode-tabs button', { hasText: 'Clients' }).first();
  const manufacturerButton = page.locator('.fleet-mode-tabs button', { hasText: 'Manufacturers' }).first();

  await projectButton.hover();
  if (await manufacturerButton.isVisible().catch(() => false)) {
    await manufacturerButton.click();
    await page.waitForTimeout(300);
  }
  if (await clientButton.isVisible().catch(() => false)) {
    await clientButton.click();
    await page.waitForTimeout(300);
  }
  await projectButton.click();
  await page.waitForTimeout(300);

  const tableButton = page.locator('button[aria-label="Toggle table"]').first();
  await tableButton.click();
  await page.waitForTimeout(300);
  const tableActivated = await tableButton.evaluate((button) => button.classList.contains('active'));
  await tableButton.click();
  await page.waitForTimeout(300);

  const filtersButton = page.locator('button[aria-label="Toggle filters"]').first();
  await filtersButton.click();
  await page.waitForSelector('#war-room-filters-panel', { state: 'visible', timeout: 30000 });
  const filterPanelProbe = await page.locator('#war-room-filters-panel .fleet-filter-overlay-body').evaluate((element) => {
    const styles = getComputedStyle(element);
    const before = element.scrollTop;
    element.scrollTop = before + 120;
    const after = element.scrollTop;
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: styles.overflowY,
      moved: after > before,
    };
  });
  await page.locator('#war-room-filters-panel .btn-close').click();
  await page.waitForSelector('#war-room-filters-panel', { state: 'hidden', timeout: 30000 });

  await page.locator('button[aria-label="Zoom in"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="Zoom out"]').first().click();
  await page.waitForTimeout(800);
  const markerStatusVisible = await page.locator('[data-testid="marker-stability-status"]').isVisible().catch(() => false);

  const domSummary = await page.evaluate(({ routePathValue, viewportLabel, markerStatus }) => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const mapModeButtons = Array.from(document.querySelectorAll('.fleet-mode-tabs button')).map((button) => ({
      label: (button.textContent || '').trim(),
      active: button.classList.contains('active'),
      visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
    }));

    return {
      viewport: viewportLabel,
      routePath: routePathValue,
      currentUrl: location.pathname + location.search,
      shellVisible: !!document.querySelector('.fleet-shell'),
      mapVisible: !!document.querySelector('#war-room-map'),
      zoomInVisible: !!document.querySelector('button[aria-label="Zoom in"]'),
      zoomOutVisible: !!document.querySelector('button[aria-label="Zoom out"]'),
      markerStatusVisible: markerStatus,
      mapModeButtons,
      tableZoneRect: rectFor('.fleet-shell-table-zone'),
      mapStageRect: rectFor('.fleet-shell-map-stage'),
      filtersButtonRect: rectFor('button[aria-label="Toggle filters"]'),
      tableButtonRect: rectFor('button[aria-label="Toggle table"]'),
      overlapDetected: (() => {
        const mapStage = document.querySelector('.fleet-shell-map-stage');
        const tableZone = document.querySelector('.fleet-shell-table-zone');
        if (!mapStage || !tableZone) {
          return false;
        }
        const mapRect = mapStage.getBoundingClientRect();
        const tableRect = tableZone.getBoundingClientRect();
        return !(mapRect.bottom <= tableRect.top || tableRect.bottom <= mapRect.top);
      })(),
    };
  }, { routePathValue: routePath, viewportLabel: viewportName, markerStatus: markerStatusVisible });

  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    viewport: viewportName,
    didLogin: loginResult.didLogin,
    tableActivated,
    filterPanelProbe,
    domSummary,
    consoleMessages: page.__bpVerifyState.consoleMessages,
    requestFailures: page.__bpVerifyState.requestFailures,
    badResponses: page.__bpVerifyState.badResponses,
  };
}
"@

  $verifyCode = $verifyCode.
    Replace('__ROUTE_URL__', $routeUrlJs).
    Replace('__ROUTE_PATH__', $routePathJs).
    Replace('__USERNAME__', $usernameJs).
    Replace('__PASSWORD__', $passwordJs).
    Replace('__SCREENSHOT_PATH__', $screenshotPathJs).
    Replace('__VIEWPORT_NAME__', $viewportNameJs).
    Replace('__WIDTH__', [string]$Width).
    Replace('__HEIGHT__', [string]$Height)

  return Invoke-RunCode -SessionId $SessionId -Code $verifyCode
}

$projectPath = (Resolve-Path ".").Path
$outputDirPath = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $projectPath $OutputDir }
New-Item -ItemType Directory -Force -Path $outputDirPath | Out-Null

$username = Get-RequiredEnv -Name "BP_TEST_USERNAME"
$password = Get-RequiredEnv -Name "BP_TEST_PASSWORD"
$baseUrl = (Get-OptionalEnv -Name "BP_BASE_URL" -DefaultValue "http://localhost:4200").TrimEnd("/")
$routeUrl = "$baseUrl$RoutePath"

$desktopScreenshotPath = Join-Path $outputDirPath "verification.png"
$mobileScreenshotPath = Join-Path $outputDirPath "verification-mobile.png"
$domPath = Join-Path $outputDirPath "verification-dom.json"
$consolePath = Join-Path $outputDirPath "verification-console.json"
$networkPath = Join-Path $outputDirPath "verification-network.json"
$summaryPath = Join-Path $outputDirPath "verification-summary.json"
$videoUrlPath = Join-Path $outputDirPath "verification-video.url.txt"

if (-not $SkipBuild) {
  Write-Host "[verify:fluorescence-map:ui] Running local build..."
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }
}

$startedServer = $null
Initialize-NpmExecutionEnvironment

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  throw "npx is required but was not found in PATH."
}

try {
  $startedServer = Start-DevServerIfNeeded

  $desktopSessionId = "bp-fm-desktop-$([Guid]::NewGuid().ToString('N'))"
  $openResult = Invoke-PlaywrightCli -Arguments @("-s=$desktopSessionId", "open", $routeUrl) -AllowFailure
  if ($openResult.exitCode -ne 0) {
    if ($openResult.output -match 'install-browser|executable') {
      Write-Host "[verify:fluorescence-map:ui] Browser binary missing; installing Playwright browser..."
      Invoke-PlaywrightCli -Arguments @("install-browser") | Out-Null
      Invoke-PlaywrightCli -Arguments @("-s=$desktopSessionId", "open", $routeUrl) | Out-Null
    } else {
      throw "Failed to open Fluorescence Map in playwright-cli:`n$($openResult.output)"
    }
  }

  $desktopResult = Invoke-ViewportVerification -SessionId $desktopSessionId -ViewportName "desktop" -Width 1440 -Height 1200 -ScreenshotPath $desktopScreenshotPath
  Invoke-PlaywrightCli -Arguments @("-s=$desktopSessionId", "close") -AllowFailure | Out-Null

  $mobileResult = $null
  if (-not $SkipMobile) {
    $mobileSessionId = "bp-fm-mobile-$([Guid]::NewGuid().ToString('N'))"
    Invoke-PlaywrightCli -Arguments @("-s=$mobileSessionId", "open", $routeUrl) | Out-Null
    $mobileResult = Invoke-ViewportVerification -SessionId $mobileSessionId -ViewportName "mobile" -Width 390 -Height 844 -ScreenshotPath $mobileScreenshotPath
    Invoke-PlaywrightCli -Arguments @("-s=$mobileSessionId", "close") -AllowFailure | Out-Null
  }

  $domSummary = [ordered]@{
    desktop = $desktopResult.domSummary
    mobile  = if ($mobileResult) { $mobileResult.domSummary } else { $null }
  }
  $consoleSummary = [ordered]@{
    desktop = $desktopResult.consoleMessages
    mobile  = if ($mobileResult) { $mobileResult.consoleMessages } else { @() }
  }
  $networkSummary = [ordered]@{
    desktop = [ordered]@{
      requestFailures = $desktopResult.requestFailures
      badResponses    = $desktopResult.badResponses
    }
    mobile = if ($mobileResult) {
      [ordered]@{
        requestFailures = $mobileResult.requestFailures
        badResponses    = $mobileResult.badResponses
      }
    } else {
      $null
    }
  }

  $summary = [ordered]@{
    routeUrl = $routeUrl
    desktopScreenshot = $desktopScreenshotPath
    mobileScreenshot = if ($mobileResult) { $mobileScreenshotPath } else { $null }
    desktop = [ordered]@{
      didLogin = $desktopResult.didLogin
      tableActivated = $desktopResult.tableActivated
      markerStatusVisible = $desktopResult.domSummary.markerStatusVisible
      filterPanelProbe = $desktopResult.filterPanelProbe
      overlapDetected = $desktopResult.domSummary.overlapDetected
    }
    mobile = if ($mobileResult) {
      [ordered]@{
        didLogin = $mobileResult.didLogin
        tableActivated = $mobileResult.tableActivated
        markerStatusVisible = $mobileResult.domSummary.markerStatusVisible
        filterPanelProbe = $mobileResult.filterPanelProbe
        overlapDetected = $mobileResult.domSummary.overlapDetected
      }
    } else {
      $null
    }
  }

  $domSummary | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path $domPath
  $consoleSummary | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path $consolePath
  $networkSummary | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path $networkPath
  $summary | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path $summaryPath

  if ($desktopResult.requestFailures.Count -gt 0 -or $desktopResult.badResponses.Count -gt 0) {
    throw "Desktop verification captured failed network requests or 4xx/5xx responses. See $networkPath"
  }
  if ($desktopResult.domSummary.overlapDetected) {
    throw "Desktop verification detected overlap between the map stage and table zone. See $domPath"
  }
  if (-not $desktopResult.domSummary.mapVisible -or -not $desktopResult.domSummary.zoomInVisible -or -not $desktopResult.domSummary.zoomOutVisible) {
    throw "Desktop verification did not find required map controls. See $domPath"
  }

  if ($mobileResult) {
    if ($mobileResult.requestFailures.Count -gt 0 -or $mobileResult.badResponses.Count -gt 0) {
      throw "Mobile verification captured failed network requests or 4xx/5xx responses. See $networkPath"
    }
    if ($mobileResult.domSummary.overlapDetected) {
      throw "Mobile verification detected overlap between the map stage and table zone. See $domPath"
    }
  }

  if (-not $SkipVideo) {
    Write-Host "[verify:fluorescence-map:ui] Running TestSprite interaction video capture..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\\run-testsprite-fluorescence-map.ps1") `
      -Port $Port `
      -HostName $HostName `
      -VideoUrlOutputPath $videoUrlPath
    if ($LASTEXITCODE -ne 0) {
      throw "TestSprite verification failed with exit code $LASTEXITCODE"
    }
    $summary.videoUrlArtifact = $videoUrlPath
    $summary | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path $summaryPath
  }

  Write-Host "[verify:fluorescence-map:ui] Screenshot: $desktopScreenshotPath"
  if ($mobileResult) {
    Write-Host "[verify:fluorescence-map:ui] Mobile screenshot: $mobileScreenshotPath"
  }
  Write-Host "[verify:fluorescence-map:ui] DOM summary: $domPath"
  Write-Host "[verify:fluorescence-map:ui] Console summary: $consolePath"
  Write-Host "[verify:fluorescence-map:ui] Network summary: $networkPath"
  if ((Test-Path $videoUrlPath)) {
    Write-Host "[verify:fluorescence-map:ui] Video URL artifact: $videoUrlPath"
  }
} finally {
  if ($startedServer -and -not $startedServer.HasExited) {
    Stop-Process -Id $startedServer.Id -Force
  }
}
